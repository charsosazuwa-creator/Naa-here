import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DatabaseService } from '../../database/database.service';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';
import type { AuthenticatedRequest } from './jwt-auth.guard';

export interface TenantScopedRequest extends AuthenticatedRequest {
  tenantId: string;
  membershipRole: string;
}

/**
 * Steps 2 and 3 of the five-step authorization check (design section
 * 10): given a signed-in user (JwtAuthGuard has already run) and a
 * :tenantId route param, confirms the user is an active member of that
 * tenant AND that their role carries the permission the route
 * declares with @RequirePermission(). Object-level and field-level
 * rules (steps 4 and 5) stay in each module's own service methods,
 * closest to the data they protect.
 *
 * On success, sets req.tenantId and req.membershipRole so downstream
 * handlers and DatabaseService.withTenant() never have to re-derive
 * them, and RLS gets the same tenant id the guard just verified.
 */
@Injectable()
export class TenantRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<TenantScopedRequest>();
    const tenantId = request.params.tenantId;

    if (!tenantId) {
      throw new ForbiddenException('This route requires a tenant in its path.');
    }

    // membership carries an RLS policy scoped to app.tenant_id.
    // this.db.query() runs on whatever connection the pool hands it,
    // with no tenant context set on it at all — so under real RLS
    // enforcement this SELECT can never see ANY row, including the
    // legitimate one, and every request would be wrongly denied. Only
    // real execution against a database with RLS actually turned on
    // caught this: every fake-DB-backed test stubs this query directly
    // and never RLS-filters it, so a guard that could never actually
    // pass under RLS still "worked" in every test. tenantId here comes
    // straight from the URL and is exactly what this query needs to
    // verify — scoping the read to it doesn't grant anything by itself,
    // since the WHERE clause below still requires a real, active
    // membership row for this specific user in it.
    const { membership, grant } = await this.db.withTenant(tenantId, async (client) => {
      const [membership] = await client.query<{ role_code: string; status: string }>(
        `SELECT r.code AS role_code, m.status
         FROM membership m
         JOIN role r ON r.id = m.role_id
         WHERE m.tenant_id = $1 AND m.user_id = $2`,
        [tenantId, request.userId],
      ).then((r) => r.rows);

      if (!membership || membership.status !== 'active') {
        return { membership: null, grant: null };
      }

      const requiredPermission = this.reflector.get<string | undefined>(PERMISSION_KEY, context.getHandler());
      if (!requiredPermission) {
        return { membership, grant: true };
      }

      const [grantRow] = await client.query<{ code: string }>(
        `SELECT p.code
         FROM role_permission rp
         JOIN permission p ON p.id = rp.permission_id
         JOIN role r ON r.id = rp.role_id
         WHERE r.code = $1 AND p.code = $2`,
        [membership.role_code, requiredPermission],
      ).then((r) => r.rows);

      return { membership, grant: grantRow ?? null };
    });

    if (!membership) {
      // Deliberately the same shape whether the tenant doesn't exist,
      // the user was never a member, or membership was suspended —
      // does not confirm the tenant's existence to a non-member.
      throw new ForbiddenException('You do not have access to this business.');
    }

    if (!grant) {
      throw new ForbiddenException(`Your role (${membership.role_code}) cannot do this.`);
    }

    request.tenantId = tenantId;
    request.membershipRole = membership.role_code;
    return true;
  }
}

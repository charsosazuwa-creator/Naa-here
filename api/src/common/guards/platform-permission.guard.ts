import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DatabaseService } from '../../database/database.service';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';
import type { AuthenticatedRequest } from './jwt-auth.guard';

/**
 * Phase 5's "fuller admin/permission model" (design section 11),
 * replacing Milestone 2's placeholder `app_user.is_platform_admin`
 * boolean (see that column's own comment in 002_provider_crm.sql, and
 * platform-admin.guard.ts's docstring, which both said this was coming).
 *
 * Platform staff — administrators, finance administrators, support
 * agents — act across every tenant, so (like TenantRoleGuard's
 * `membership` table) they need their own tenant-independent
 * assignment table: `platform_role_assignment`. This guard is the
 * platform-wide mirror of TenantRoleGuard's steps 2 and 3: does this
 * user hold a platform role, and does that role carry the permission
 * the route declares with @RequirePermission()? Reuses the same
 * decorator and the same `role_permission` table tenant roles use —
 * one permission model, two kinds of membership.
 */
@Injectable()
export class PlatformPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const requiredPermission = this.reflector.get<string | undefined>(PERMISSION_KEY, context.getHandler());

    if (!requiredPermission) {
      // A route that forgot @RequirePermission() is a programming
      // error, not an access decision — fail closed rather than
      // silently admitting every platform-role holder.
      throw new ForbiddenException('This route has no declared permission to check.');
    }

    const [grant] = await this.db.query<{ code: string }>(
      `SELECT p.code
       FROM platform_role_assignment pra
       JOIN role_permission rp ON rp.role_id = pra.role_id
       JOIN permission p ON p.id = rp.permission_id
       WHERE pra.user_id = $1 AND p.code = $2
       LIMIT 1`,
      [request.userId, requiredPermission],
    );

    if (!grant) {
      throw new ForbiddenException('This action requires a platform role that carries this permission.');
    }

    return true;
  }
}

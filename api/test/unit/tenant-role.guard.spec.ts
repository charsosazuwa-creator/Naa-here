import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantRoleGuard } from '../../src/common/guards/tenant-role.guard';
import { DatabaseService } from '../../src/database/database.service';

function makeContext(params: Record<string, string>, userId: string): ExecutionContext {
  const request = { params, userId };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
  } as unknown as ExecutionContext;
}

/**
 * The guard's real membership/permission checks now run inside
 * `db.withTenant(tenantId, fn)` (see tenant-role.guard.ts's own comment
 * for why: membership carries an RLS policy, so an unscoped connection
 * could never see a legitimate row once RLS is actually enforced — a
 * real-execution-only bug this test file did not model before that fix,
 * and would have kept not modeling if this fake `db` still exposed only
 * `query()`). This fake mirrors withTenant()'s real shape: it hands the
 * callback a `client` whose `query` returns the queued results, in the
 * same order the guard's own two queries run.
 */
function fakeDb(...clientQueryResults: unknown[][]): DatabaseService {
  const clientQuery = jest.fn();
  for (const rows of clientQueryResults) {
    clientQuery.mockResolvedValueOnce({ rows });
  }
  const client = { query: clientQuery };
  return {
    withTenant: jest.fn((_tenantId: string, fn: (c: typeof client) => unknown) => fn(client)),
    query: jest.fn(),
  } as unknown as DatabaseService;
}

describe('TenantRoleGuard', () => {
  it('rejects when the route has no :tenantId param', async () => {
    const db = { query: jest.fn(), withTenant: jest.fn() } as unknown as DatabaseService;
    const reflector = { get: () => undefined } as unknown as Reflector;
    const guard = new TenantRoleGuard(reflector, db);

    await expect(guard.canActivate(makeContext({}, 'user-1'))).rejects.toThrow('requires a tenant');
  });

  it('rejects a user who is not an active member of the tenant', async () => {
    const db = fakeDb([]);
    const reflector = { get: () => undefined } as unknown as Reflector;
    const guard = new TenantRoleGuard(reflector, db);

    await expect(guard.canActivate(makeContext({ tenantId: 't-1' }, 'user-1'))).rejects.toThrow(ForbiddenException);
  });

  it('rejects a suspended member even though a membership row exists', async () => {
    const db = fakeDb([{ role_code: 'staff', status: 'suspended' }]);
    const reflector = { get: () => undefined } as unknown as Reflector;
    const guard = new TenantRoleGuard(reflector, db);

    await expect(guard.canActivate(makeContext({ tenantId: 't-1' }, 'user-1'))).rejects.toThrow(ForbiddenException);
  });

  it('rejects an active member whose role lacks the required permission', async () => {
    const db = fakeDb(
      [{ role_code: 'staff', status: 'active' }], // membership lookup
      [], // permission lookup: no grant found
    );
    const reflector = { get: () => 'staff.manage' } as unknown as Reflector;
    const guard = new TenantRoleGuard(reflector, db);

    await expect(guard.canActivate(makeContext({ tenantId: 't-1' }, 'user-1'))).rejects.toThrow('cannot do this');
  });

  it('allows an active member whose role has the required permission, and sets tenantId/role on the request', async () => {
    const request = { params: { tenantId: 't-1' }, userId: 'user-1' } as any;
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
    } as unknown as ExecutionContext;

    const db = fakeDb([{ role_code: 'owner', status: 'active' }], [{ code: 'service.manage' }]);
    const reflector = { get: () => 'service.manage' } as unknown as Reflector;
    const guard = new TenantRoleGuard(reflector, db);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.tenantId).toBe('t-1');
    expect(request.membershipRole).toBe('owner');
  });

  it('allows an active member when the route declares no required permission', async () => {
    const db = fakeDb([{ role_code: 'staff', status: 'active' }]);
    const reflector = { get: () => undefined } as unknown as Reflector;
    const guard = new TenantRoleGuard(reflector, db);

    await expect(guard.canActivate(makeContext({ tenantId: 't-1' }, 'user-1'))).resolves.toBe(true);
  });
});

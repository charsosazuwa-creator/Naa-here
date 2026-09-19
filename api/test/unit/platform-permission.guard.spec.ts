import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlatformPermissionGuard } from '../../src/common/guards/platform-permission.guard';
import { DatabaseService } from '../../src/database/database.service';

function makeContext(userId: string): ExecutionContext {
  const request = { userId };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
  } as unknown as ExecutionContext;
}

/**
 * Mirrors tenant-role.guard.spec.ts's shape: this is the platform-wide
 * equivalent of TenantRoleGuard, checking platform_role_assignment +
 * role_permission instead of membership + role_permission (see
 * platform-permission.guard.ts and migration 005).
 */
describe('PlatformPermissionGuard', () => {
  it('fails closed when the route declares no required permission', async () => {
    const db = { query: jest.fn() } as unknown as DatabaseService;
    const reflector = { get: () => undefined } as unknown as Reflector;
    const guard = new PlatformPermissionGuard(reflector, db);

    await expect(guard.canActivate(makeContext('user-1'))).rejects.toThrow('no declared permission');
    expect((db.query as jest.Mock).mock.calls.length).toBe(0);
  });

  it('rejects a user with no platform role assignment at all', async () => {
    const db = { query: jest.fn().mockResolvedValue([]) } as unknown as DatabaseService;
    const reflector = { get: () => 'verification.decide' } as unknown as Reflector;
    const guard = new PlatformPermissionGuard(reflector, db);

    await expect(guard.canActivate(makeContext('user-1'))).rejects.toThrow(ForbiddenException);
  });

  it("rejects a platform role holder whose role doesn't carry the required permission", async () => {
    // e.g. a support_agent (dispute.view only) hitting a dispute.resolve route.
    const db = { query: jest.fn().mockResolvedValue([]) } as unknown as DatabaseService;
    const reflector = { get: () => 'dispute.resolve' } as unknown as Reflector;
    const guard = new PlatformPermissionGuard(reflector, db);

    await expect(guard.canActivate(makeContext('support-agent-1'))).rejects.toThrow('platform role that carries this permission');
  });

  it('allows a platform role holder whose role carries the required permission', async () => {
    const db = {
      query: jest.fn().mockResolvedValue([{ code: 'payout.decide' }]),
    } as unknown as DatabaseService;
    const reflector = { get: () => 'payout.decide' } as unknown as Reflector;
    const guard = new PlatformPermissionGuard(reflector, db);

    await expect(guard.canActivate(makeContext('finance-admin-1'))).resolves.toBe(true);
    expect((db.query as jest.Mock).mock.calls[0][1]).toEqual(['finance-admin-1', 'payout.decide']);
  });
});

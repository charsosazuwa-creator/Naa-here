import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { TenantScopedRequest } from '../guards/tenant-role.guard';

/** Reads the tenantId set by TenantRoleGuard. Use only on routes behind that guard. */
export const CurrentTenantId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<TenantScopedRequest>();
  return request.tenantId;
});

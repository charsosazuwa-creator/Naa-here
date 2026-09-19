import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'requiredPermission';

/**
 * Marks a route as needing a specific permission code within the
 * tenant named by its :tenantId route param. Read by TenantRoleGuard.
 * This is steps 2 and 3 of the five-step authorization check in
 * design section 10: tenant membership, then role permission.
 */
export const RequirePermission = (permissionCode: string) => SetMetadata(PERMISSION_KEY, permissionCode);

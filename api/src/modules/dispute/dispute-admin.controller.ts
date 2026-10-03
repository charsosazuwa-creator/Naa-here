import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformPermissionGuard } from '../../common/guards/platform-permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { DisputeService } from './dispute.service';

/**
 * The platform-wide dispute queue for support_agent/administrator/
 * finance_administrator (anyone holding dispute.view — see migration
 * 005's role_permission grants). Same "platform queue list, tenant-
 * scoped decide action" split as VerificationAdminController: each row
 * carries its own tenantId, and the admin UI calls the existing
 * POST /tenants/:tenantId/disputes/:disputeId/resolve with it.
 *
 * @RequirePermission sat at the class level here until this fix: found
 * while building the reports feature, since ReportsAdminController
 * started out with the same (copied) shape. PlatformPermissionGuard
 * reads this metadata off `context.getHandler()` only, never
 * `context.getClass()`, so a class-level @RequirePermission is
 * invisible to it — the guard's own fail-closed branch for "no
 * declared permission" then threw on every request. This route has
 * been unconditionally 403ing in every environment, including
 * production, since it was written: the Admin Console's Disputes tab
 * has never actually been able to load its queue. See
 * crm.controller.ts for the fuller writeup; fixed the same way here.
 */
@Controller('admin/disputes')
@UseGuards(JwtAuthGuard, PlatformPermissionGuard)
export class DisputeAdminController {
  constructor(private readonly disputes: DisputeService) {}

  @Get()
  @RequirePermission('dispute.view')
  listAll(@CurrentUserId() userId: string) {
    return this.disputes.listForAdmin(userId);
  }
}

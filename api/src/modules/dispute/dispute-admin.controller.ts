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
 */
@Controller('admin/disputes')
@UseGuards(JwtAuthGuard, PlatformPermissionGuard)
@RequirePermission('dispute.view')
export class DisputeAdminController {
  constructor(private readonly disputes: DisputeService) {}

  @Get()
  listAll(@CurrentUserId() userId: string) {
    return this.disputes.listForAdmin(userId);
  }
}

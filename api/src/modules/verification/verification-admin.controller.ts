import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformPermissionGuard } from '../../common/guards/platform-permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { VerificationService } from './verification.service';

/**
 * Platform-wide counterpart to VerificationController, which is
 * mounted under /tenants/:tenantId/verification and so can only ever
 * list one tenant at a time — no use to a reviewer who doesn't already
 * know which tenants have pending submissions. This is the "queue"
 * half of the admin/verification console: list what needs review.
 * Deciding still goes through VerificationController's existing
 * POST /tenants/:tenantId/verification/:submissionId/decide (already
 * PlatformPermissionGuard-protected and already tenant-context-correct
 * via DatabaseService.withTenant) — the admin console's frontend calls
 * that directly using the tenantId this listing returns per row.
 */
@Controller('admin/verification')
@UseGuards(JwtAuthGuard)
export class VerificationAdminController {
  constructor(private readonly verification: VerificationService) {}

  @Get('pending')
  @UseGuards(PlatformPermissionGuard)
  @RequirePermission('verification.decide')
  listPending(@CurrentUserId() userId: string, @Query('includeDecided') includeDecided?: string) {
    return this.verification.listForReview(userId, includeDecided === 'true');
  }
}

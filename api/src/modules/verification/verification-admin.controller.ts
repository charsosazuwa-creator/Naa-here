import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformPermissionGuard } from '../../common/guards/platform-permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { VerificationService } from './verification.service';
import { ModerationAssistService } from '../moderation-assist/moderation-assist.service';

/**
 * Platform-wide counterpart to VerificationController, which is
 * mounted under /tenants/:tenantId/verification and so can only ever
 * list one tenant at a time — no use to a reviewer who doesn't already
 * know which tenants have pending submissions. This is the "queue"
 * half of the admin/verification console: list what needs review, and
 * (once real file storage is configured -- see media.service.ts) get
 * a signed URL to actually view a submitted document. Deciding still
 * goes through VerificationController's existing
 * POST /tenants/:tenantId/verification/:submissionId/decide (already
 * PlatformPermissionGuard-protected and already tenant-context-correct
 * via DatabaseService.withTenant) — the admin console's frontend calls
 * that directly using the tenantId this listing returns per row.
 *
 * listPending() also attaches the reporting Agent's advisory review to
 * each submission (ModerationAssistService — see its own comment):
 * read-only, a recommendation plus reasons for a human to read before
 * deciding. The Agent never calls decide() itself.
 */
@Controller('admin/verification')
@UseGuards(JwtAuthGuard)
export class VerificationAdminController {
  constructor(
    private readonly verification: VerificationService,
    private readonly moderationAssist: ModerationAssistService,
  ) {}

  @Get('pending')
  @UseGuards(PlatformPermissionGuard)
  @RequirePermission('verification.decide')
  async listPending(@CurrentUserId() userId: string, @Query('includeDecided') includeDecided?: string) {
    const submissions = await this.verification.listForReview(userId, includeDecided === 'true');
    return submissions.map((submission) => ({
      ...submission,
      agentReview: this.moderationAssist.reviewVerificationSubmission(submission),
    }));
  }

  @Get(':submissionId/document-url')
  @UseGuards(PlatformPermissionGuard)
  @RequirePermission('verification.decide')
  getDocumentUrl(@CurrentUserId() userId: string, @Param('submissionId') submissionId: string) {
    return this.verification.getDocumentUrl(userId, submissionId);
  }
}

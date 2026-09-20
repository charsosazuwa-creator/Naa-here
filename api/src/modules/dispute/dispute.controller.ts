import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantRoleGuard } from '../../common/guards/tenant-role.guard';
import { PlatformPermissionGuard } from '../../common/guards/platform-permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { DisputeService } from './dispute.service';
import { CreateDisputeDto, ResolveDisputeDto } from './dto/dispute.dto';
import { UploadedDisputeFile } from './dispute-attachment.service';

@Controller('tenants/:tenantId')
@UseGuards(JwtAuthGuard)
export class DisputeController {
  constructor(private readonly disputes: DisputeService) {}

  /**
   * Customer or tenant-member facing: neither is necessarily the
   * other, so this is deliberately NOT behind TenantRoleGuard — the
   * service itself checks that the caller is either the booking's
   * customer or an active member of the tenant.
   */
  @Post('bookings/:bookingId/disputes')
  raise(
    @Param('tenantId') tenantId: string,
    @Param('bookingId') bookingId: string,
    @CurrentUserId() userId: string,
    @Body() dto: CreateDisputeDto,
  ) {
    return this.disputes.raise(tenantId, bookingId, userId, dto.reason, dto.details);
  }

  /** The provider's own view of disputes raised against their bookings. */
  @Get('disputes')
  @UseGuards(TenantRoleGuard)
  @RequirePermission('booking.manage')
  listForTenant(@Param('tenantId') tenantId: string) {
    return this.disputes.listForTenant(tenantId);
  }

  // Platform-level, not tenant-membership-based — see
  // PlatformPermissionGuard and the platform_role_assignment table
  // (migration 005), same pattern as verification.decide.
  @Post('disputes/:disputeId/resolve')
  @UseGuards(PlatformPermissionGuard)
  @RequirePermission('dispute.resolve')
  resolve(
    @Param('tenantId') tenantId: string,
    @Param('disputeId') disputeId: string,
    @CurrentUserId() userId: string,
    @Body() dto: ResolveDisputeDto,
  ) {
    return this.disputes.resolve(tenantId, disputeId, userId, dto.resolution, dto.notes);
  }

  // Evidence attachments (US-056 AC "supporting files may be
  // attached"). Not behind TenantRoleGuard/PlatformPermissionGuard —
  // DisputeService.assertParty allows the raiser, an active tenant
  // member, OR platform staff with dispute.view, same three-way
  // authorization the dispute row's own RLS policies encode.
  @Post('disputes/:disputeId/attachments')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  addAttachment(
    @Param('tenantId') tenantId: string,
    @Param('disputeId') disputeId: string,
    @CurrentUserId() userId: string,
    @UploadedFile() file: UploadedDisputeFile | undefined,
  ) {
    return this.disputes.addAttachment(tenantId, disputeId, userId, file);
  }

  @Delete('disputes/:disputeId/attachments/:attachmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeAttachment(
    @Param('tenantId') tenantId: string,
    @Param('disputeId') disputeId: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentUserId() userId: string,
  ) {
    await this.disputes.removeAttachment(tenantId, disputeId, userId, attachmentId);
  }
}

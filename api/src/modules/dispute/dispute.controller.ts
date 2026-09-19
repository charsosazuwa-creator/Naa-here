import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantRoleGuard } from '../../common/guards/tenant-role.guard';
import { PlatformPermissionGuard } from '../../common/guards/platform-permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { DisputeService } from './dispute.service';
import { CreateDisputeDto, ResolveDisputeDto } from './dto/dispute.dto';

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
    return this.disputes.raise(tenantId, bookingId, userId, dto.reason);
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
}

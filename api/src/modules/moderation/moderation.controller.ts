import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformPermissionGuard } from '../../common/guards/platform-permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { ModerationService } from './moderation.service';
import { ReinstateListingDto, SuspendListingDto } from './dto/moderation.dto';

// Platform-level throughout, not tenant-membership-based — see
// PlatformPermissionGuard and the platform_role_assignment table
// (migration 005), same pattern as verification.decide.
@Controller('tenants/:tenantId')
@UseGuards(JwtAuthGuard, PlatformPermissionGuard)
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  // @RequirePermission is read off the individual handler
  // (Reflector.get(..., context.getHandler())), never inherited from
  // the class, so every route below repeats it — see
  // PlatformPermissionGuard and TenantRoleGuard, which both read the
  // same way.
  @Post('services/:serviceId/moderation/suspend')
  @RequirePermission('listing.moderate')
  suspend(
    @Param('tenantId') tenantId: string,
    @Param('serviceId') serviceId: string,
    @CurrentUserId() userId: string,
    @Body() dto: SuspendListingDto,
  ) {
    return this.moderation.suspend(tenantId, serviceId, userId, dto.reason);
  }

  @Post('services/:serviceId/moderation/reinstate')
  @RequirePermission('listing.moderate')
  reinstate(
    @Param('tenantId') tenantId: string,
    @Param('serviceId') serviceId: string,
    @CurrentUserId() userId: string,
    @Body() dto: ReinstateListingDto,
  ) {
    return this.moderation.reinstate(tenantId, serviceId, userId, dto.reason);
  }

  @Get('moderation-history')
  @RequirePermission('listing.moderate')
  history(@Param('tenantId') tenantId: string) {
    return this.moderation.listForTenant(tenantId);
  }
}

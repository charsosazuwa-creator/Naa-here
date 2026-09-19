import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantRoleGuard } from '../../common/guards/tenant-role.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { CreateBusinessDto } from './dto/create-business.dto';
import { CreateLocationDto } from './dto/location.dto';
import { InviteStaffDto } from './dto/invite-staff.dto';
import { BusinessService } from './business.service';
import { LocationService } from './location.service';
import { StaffService } from './staff.service';

/**
 * Routes for Milestone 2's Phase-2 "Provider CRM" module: businesses,
 * locations, staff. A business is created by any signed-in user (they
 * become its owner); everything under /v1/tenants/:tenantId is then
 * behind TenantRoleGuard, which checks active membership and, where
 * declared, the specific permission the route needs.
 */
@Controller('tenants')
@UseGuards(JwtAuthGuard)
export class TenancyController {
  constructor(
    private readonly business: BusinessService,
    private readonly locations: LocationService,
    private readonly staff: StaffService,
  ) {}

  @Post()
  create(@CurrentUserId() userId: string, @Body() dto: CreateBusinessDto) {
    return this.business.create(userId, dto);
  }

  // Declared before the ':tenantId' route below so Nest/Express match
  // this literal path first — otherwise 'mine' would be parsed as a
  // tenantId. Not behind TenantRoleGuard: no single tenant is known
  // yet, this is exactly how a client finds out which ones exist.
  @Get('mine')
  listMine(@CurrentUserId() userId: string) {
    return this.business.listForUser(userId);
  }

  @Get(':tenantId')
  @UseGuards(TenantRoleGuard)
  get(@Param('tenantId') tenantId: string) {
    return this.business.findById(tenantId);
  }

  @Post(':tenantId/locations')
  @UseGuards(TenantRoleGuard)
  @RequirePermission('business.manage')
  createLocation(@Param('tenantId') tenantId: string, @Body() dto: CreateLocationDto) {
    return this.locations.create(tenantId, dto);
  }

  @Get(':tenantId/locations')
  @UseGuards(TenantRoleGuard)
  listLocations(@Param('tenantId') tenantId: string) {
    return this.locations.listForTenant(tenantId);
  }

  @Post(':tenantId/staff')
  @UseGuards(TenantRoleGuard)
  @RequirePermission('staff.manage')
  inviteStaff(@Param('tenantId') tenantId: string, @CurrentUserId() userId: string, @Body() dto: InviteStaffDto) {
    return this.staff.invite(tenantId, userId, dto.email, dto.roleCode);
  }

  // Deliberately NOT behind TenantRoleGuard: an invited user is not yet
  // an active member, so the guard would reject them before they could
  // ever accept. staff.accept() does its own check (a matching
  // 'invited' row must exist) instead.
  @Post(':tenantId/staff/accept')
  acceptInvite(@Param('tenantId') tenantId: string, @CurrentUserId() userId: string) {
    return this.staff.accept(tenantId, userId);
  }

  @Get(':tenantId/staff')
  @UseGuards(TenantRoleGuard)
  @RequirePermission('staff.manage')
  listStaff(@Param('tenantId') tenantId: string) {
    return this.staff.listForTenant(tenantId);
  }
}

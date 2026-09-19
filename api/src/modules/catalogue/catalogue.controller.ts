import { Body, Controller, Get, Param, Post, Patch, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantRoleGuard } from '../../common/guards/tenant-role.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { ServiceCatalogueService } from './service.service';
import { AvailabilityService } from './availability.service';
import { CreateServiceDto, UpdateServiceStatusDto } from './dto/service.dto';
import { CreateAvailabilityRuleDto, CreateBlockedTimeDto } from './dto/availability.dto';

/**
 * Every route here is tenant-member-only, including the service list —
 * this module is the provider's own CRM view of their catalogue, not
 * public discovery. Customers browsing published services by location
 * is a Phase 3 concern (design section 11, "Search and location"
 * belongs to the booking engine's customer-facing surface) and needs
 * its own unauthenticated route; it is intentionally not added here.
 */
@Controller('tenants/:tenantId')
@UseGuards(JwtAuthGuard, TenantRoleGuard)
export class CatalogueController {
  constructor(
    private readonly services: ServiceCatalogueService,
    private readonly availability: AvailabilityService,
  ) {}

  @Post('services')
  @RequirePermission('service.manage')
  createService(@Param('tenantId') tenantId: string, @CurrentUserId() userId: string, @Body() dto: CreateServiceDto) {
    return this.services.create(tenantId, userId, dto);
  }

  @Get('services')
  listServices(@Param('tenantId') tenantId: string, @Query('all') all?: string) {
    // ?all=true is for the owner/staff's own dashboard (drafts included);
    // the default (published only) is what a public listing would show.
    return this.services.listForTenant(tenantId, all === 'true');
  }

  @Patch('services/:serviceId/status')
  @RequirePermission('service.publish')
  setServiceStatus(
    @Param('tenantId') tenantId: string,
    @Param('serviceId') serviceId: string,
    @CurrentUserId() userId: string,
    @Body() dto: UpdateServiceStatusDto,
  ) {
    return this.services.setStatus(tenantId, serviceId, userId, dto.status);
  }

  @Post('availability-rules')
  @RequirePermission('availability.manage')
  addAvailabilityRule(@Param('tenantId') tenantId: string, @Body() dto: CreateAvailabilityRuleDto) {
    return this.availability.addRule(tenantId, dto);
  }

  @Get('availability-rules')
  listAvailabilityRules(@Param('tenantId') tenantId: string) {
    return this.availability.listRules(tenantId);
  }

  @Post('blocked-time')
  @RequirePermission('availability.manage')
  addBlockedTime(@Param('tenantId') tenantId: string, @Body() dto: CreateBlockedTimeDto) {
    return this.availability.addBlockedTime(tenantId, dto);
  }
}

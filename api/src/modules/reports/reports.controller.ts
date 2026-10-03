import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantRoleGuard } from '../../common/guards/tenant-role.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { ReportsService } from './reports.service';
import { GenerateReportDto } from './dto/reports.dto';

/**
 * Provider-facing side of reports: a business can generate and view
 * its own performance report, never any other tenant's and never the
 * cross-tenant platform summary (that one lives only under
 * ReportsAdminController). TenantRoleGuard enforces active membership
 * in :tenantId; report.view is now granted to every provider role
 * (owner/staff/artisan/host — migration 026), the same set
 * booking.manage already uses.
 *
 * @RequirePermission is applied per-handler, not once at the class
 * level — TenantRoleGuard only reads it off `context.getHandler()`,
 * so a class-level declaration is silently invisible to it and every
 * route 403s. See crm.controller.ts for the full writeup of this bug
 * (found and fixed alongside this feature, across every controller
 * that had it).
 */
@Controller('tenants/:tenantId/reports')
@UseGuards(JwtAuthGuard, TenantRoleGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @RequirePermission('report.view')
  listHistory(@Param('tenantId') tenantId: string) {
    return this.reports.listTenantHistory(tenantId);
  }

  @Post('business-performance')
  @RequirePermission('report.view')
  generateBusinessPerformance(
    @Param('tenantId') tenantId: string,
    @CurrentUserId() userId: string,
    @Body() dto: GenerateReportDto,
  ) {
    return this.reports.generateBusinessPerformance(tenantId, userId, dto.periodDays);
  }
}

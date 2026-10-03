import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformPermissionGuard } from '../../common/guards/platform-permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { ReportsService } from './reports.service';
import { GenerateReportDto } from './dto/reports.dto';

/**
 * Backend-user (platform staff) side of reports: a cross-tenant
 * platform summary nothing else can produce, business-performance for
 * any tenant (a provider gets the same report for their own tenant
 * only, via ReportsController), the tenant picker that drives the
 * Admin Console's dropdown, and the full cross-tenant report history.
 * Same guard pair as DisputeAdminController/FinanceController's
 * platform-level routes: signed in, and holding report.view via
 * platform_role_assignment (administrator and finance_administrator
 * both do, from migration 005).
 *
 * @RequirePermission is applied per-handler, not once at the class
 * level — PlatformPermissionGuard only reads it off
 * `context.getHandler()`, so a class-level declaration is silently
 * invisible to it and every route 403s. See crm.controller.ts and
 * dispute-admin.controller.ts, both of which had exactly this bug
 * (found and fixed alongside this feature).
 */
@Controller('admin/reports')
@UseGuards(JwtAuthGuard, PlatformPermissionGuard)
export class ReportsAdminController {
  constructor(private readonly reports: ReportsService) {}

  @Get('tenants')
  @RequirePermission('report.view')
  listTenants() {
    return this.reports.listTenantsForAdmin();
  }

  @Get()
  @RequirePermission('report.view')
  listHistory(@CurrentUserId() userId: string) {
    return this.reports.listPlatformHistory(userId);
  }

  @Post('platform-summary')
  @RequirePermission('report.view')
  generatePlatformSummary(@CurrentUserId() userId: string, @Body() dto: GenerateReportDto) {
    return this.reports.generatePlatformSummary(userId, dto.periodDays);
  }

  @Post('business-performance/:tenantId')
  @RequirePermission('report.view')
  generateBusinessPerformance(
    @Param('tenantId') tenantId: string,
    @CurrentUserId() userId: string,
    @Body() dto: GenerateReportDto,
  ) {
    return this.reports.generateBusinessPerformance(tenantId, userId, dto.periodDays);
  }
}

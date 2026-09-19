import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantRoleGuard } from '../../common/guards/tenant-role.guard';
import { PlatformPermissionGuard } from '../../common/guards/platform-permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { FinanceService } from './finance.service';
import { DecidePayoutDto, IssueRefundDto, RequestPayoutDto } from './dto/finance.dto';

@Controller('tenants/:tenantId')
@UseGuards(JwtAuthGuard)
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  /** A provider asking to be paid out of their own escrow balance. */
  @Post('payouts')
  @UseGuards(TenantRoleGuard)
  @RequirePermission('payout.request')
  requestPayout(@Param('tenantId') tenantId: string, @CurrentUserId() userId: string, @Body() dto: RequestPayoutDto) {
    return this.finance.requestPayout(tenantId, userId, dto);
  }

  /** A provider's own payout history — same permission as requesting one. */
  @Get('payouts')
  @UseGuards(TenantRoleGuard)
  @RequirePermission('payout.request')
  listPayouts(@Param('tenantId') tenantId: string) {
    return this.finance.listForTenant(tenantId);
  }

  // Platform-level (finance_administrator) — see PlatformPermissionGuard
  // and the platform_role_assignment table (migration 005).
  @Post('payouts/:payoutId/decide')
  @UseGuards(PlatformPermissionGuard)
  @RequirePermission('payout.decide')
  decidePayout(
    @Param('tenantId') tenantId: string,
    @Param('payoutId') payoutId: string,
    @CurrentUserId() userId: string,
    @Body() dto: DecidePayoutDto,
  ) {
    return this.finance.decidePayout(tenantId, payoutId, userId, dto.decision, dto.notes);
  }

  // Platform-level (finance_administrator): a direct refund, independent
  // of a dispute (see dispute.service.ts for the dispute-triggered kind).
  @Post('bookings/:bookingId/refund')
  @UseGuards(PlatformPermissionGuard)
  @RequirePermission('refund.issue')
  issueRefund(
    @Param('tenantId') tenantId: string,
    @Param('bookingId') bookingId: string,
    @CurrentUserId() userId: string,
    @Body() dto: IssueRefundDto,
  ) {
    return this.finance.issueRefund(tenantId, bookingId, userId, dto);
  }

  // Platform-level (administrator or finance_administrator, both carry
  // report.view) — the phase 5 "Done when" report.
  @Get('finance/reconciliation')
  @UseGuards(PlatformPermissionGuard)
  @RequirePermission('report.view')
  reconciliation(@Param('tenantId') tenantId: string) {
    return this.finance.reconciliationReport(tenantId);
  }
}

import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantRoleGuard } from '../../common/guards/tenant-role.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { CallService } from './call.service';
import { InitiateProviderCallDto } from './dto/call.dto';

/**
 * User Story 3: a Provider calling a Customer, plus this tenant's call
 * history. Same eligibility gate and 'customer.manage' permission as
 * provider-conversation.controller.ts's chat equivalent.
 */
@Controller('tenants/:tenantId/calls')
@UseGuards(JwtAuthGuard, TenantRoleGuard)
export class ProviderCallController {
  constructor(private readonly calls: CallService) {}

  @Post()
  @RequirePermission('customer.manage')
  startAsProvider(@Param('tenantId') tenantId: string, @CurrentUserId() userId: string, @Body() dto: InitiateProviderCallDto) {
    return this.calls.initiateProviderCall(userId, tenantId, dto.customerUserId);
  }

  @Get()
  @RequirePermission('customer.manage')
  listForTenant(@Param('tenantId') tenantId: string) {
    return this.calls.listForTenant(tenantId);
  }
}

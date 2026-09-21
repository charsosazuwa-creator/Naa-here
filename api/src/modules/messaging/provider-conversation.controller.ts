import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantRoleGuard } from '../../common/guards/tenant-role.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { DirectMessageService } from './direct-message.service';
import { StartConversationAsProviderDto } from './dto/messaging.dto';

/**
 * Provider-side conversation routes (User Story 3's chat half). Both
 * routes are tenant-member-only, reusing 'customer.manage' -- the same
 * permission customer-invitation.controller.ts reuses for the same
 * reason: talking to a business's customers is part of managing them.
 * The eligibility gate itself (an existing booking, job request,
 * accepted invitation, or the customer having messaged first) lives in
 * DirectMessageService.startAsProvider(), not here -- this guard only
 * confirms the caller is allowed to act as this tenant at all.
 */
@Controller('tenants/:tenantId/conversations')
@UseGuards(JwtAuthGuard, TenantRoleGuard)
export class ProviderConversationController {
  constructor(private readonly messages: DirectMessageService) {}

  @Post()
  @RequirePermission('customer.manage')
  startAsProvider(
    @Param('tenantId') tenantId: string,
    @CurrentUserId() userId: string,
    @Body() dto: StartConversationAsProviderDto,
  ) {
    return this.messages.startAsProvider(tenantId, userId, dto);
  }

  @Get()
  @RequirePermission('customer.manage')
  listForTenant(@Param('tenantId') tenantId: string) {
    return this.messages.listForTenant(tenantId);
  }
}

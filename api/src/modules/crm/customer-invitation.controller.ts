import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantRoleGuard } from '../../common/guards/tenant-role.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { CustomerInvitationService } from './customer-invitation.service';
import { InviteCustomerDto } from './dto/customer-invitation.dto';

/**
 * Provider-facing routes: sending and managing invitations for a
 * business the caller belongs to. Reuses 'customer.manage' (the same
 * permission CrmController's customer routes require) rather than a
 * new permission code — inviting a customer is part of managing them,
 * and AC13/AC24 just need SOME permission gate, not a new one.
 */
@Controller('tenants/:tenantId/customer-invitations')
@UseGuards(JwtAuthGuard, TenantRoleGuard)
@RequirePermission('customer.manage')
export class TenantCustomerInvitationController {
  constructor(private readonly invitations: CustomerInvitationService) {}

  @Post()
  invite(@Param('tenantId') tenantId: string, @CurrentUserId() userId: string, @Body() dto: InviteCustomerDto) {
    return this.invitations.invite(tenantId, userId, dto.email);
  }

  @Get()
  list(@Param('tenantId') tenantId: string) {
    return this.invitations.listForTenant(tenantId);
  }

  @Post(':invitationId/resend')
  resend(@Param('tenantId') tenantId: string, @Param('invitationId') invitationId: string, @CurrentUserId() userId: string) {
    return this.invitations.resend(tenantId, invitationId, userId);
  }

  @Post(':invitationId/cancel')
  cancel(@Param('tenantId') tenantId: string, @Param('invitationId') invitationId: string, @CurrentUserId() userId: string) {
    return this.invitations.cancel(tenantId, invitationId, userId);
  }
}

/**
 * Customer-facing routes, reached by the opaque token mailed to them --
 * never nested under a :tenantId the customer doesn't yet have any
 * relationship to. The preview route is intentionally public (no
 * guard): a not-yet-registered customer needs to see which business
 * invited them before they've signed up at all. Accept/decline need a
 * signed-in customer (any app_user works; the service itself checks
 * the invited email matches), same shape as StaffController's
 * deliberately-unguarded staff/accept route.
 */
@Controller('customer-invitations')
export class CustomerInvitationController {
  constructor(private readonly invitations: CustomerInvitationService) {}

  @Get(':token')
  preview(@Param('token') token: string) {
    return this.invitations.previewByToken(token);
  }

  @Post(':token/accept')
  @UseGuards(JwtAuthGuard)
  accept(@Param('token') token: string, @CurrentUserId() userId: string) {
    return this.invitations.accept(token, userId);
  }

  @Post(':token/decline')
  @UseGuards(JwtAuthGuard)
  decline(@Param('token') token: string, @CurrentUserId() userId: string) {
    return this.invitations.decline(token, userId);
  }
}

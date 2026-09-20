import { Module } from '@nestjs/common';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { TenantCustomerInvitationController, CustomerInvitationController } from './customer-invitation.controller';
import { CustomerInvitationService } from './customer-invitation.service';

@Module({
  controllers: [CrmController, TenantCustomerInvitationController, CustomerInvitationController],
  providers: [CrmService, CustomerInvitationService],
})
export class CrmModule {}

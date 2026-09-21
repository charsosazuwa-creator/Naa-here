import { IsUUID } from 'class-validator';

export class InitiateGroupCallDto {
  @IsUUID()
  calleeUserId!: string;
}

export class InitiateCustomerCallDto {
  @IsUUID()
  tenantId!: string;
}

export class InitiateProviderCallDto {
  @IsUUID()
  customerUserId!: string;
}

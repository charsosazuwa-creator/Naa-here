import { IsIn, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class StartConversationAsCustomerDto {
  @IsUUID()
  tenantId!: string;

  @IsString()
  @MinLength(1)
  body!: string;

  @IsOptional()
  @IsIn(['booking', 'job_request', 'general'])
  contextType?: 'booking' | 'job_request' | 'general';

  @IsOptional()
  @IsUUID()
  contextId?: string;
}

export class StartConversationAsProviderDto {
  @IsUUID()
  customerUserId!: string;

  @IsString()
  @MinLength(1)
  body!: string;

  @IsOptional()
  @IsIn(['booking', 'job_request', 'customer_invitation', 'general'])
  contextType?: 'booking' | 'job_request' | 'customer_invitation' | 'general';

  @IsOptional()
  @IsUUID()
  contextId?: string;
}

export class SendMessageDto {
  @IsString()
  @MinLength(1)
  body!: string;
}

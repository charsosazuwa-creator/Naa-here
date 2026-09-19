import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateDisputeDto {
  @IsString()
  @MinLength(1)
  reason!: string;
}

export class ResolveDisputeDto {
  @IsIn(['resolved_customer', 'resolved_provider', 'dismissed'])
  resolution!: 'resolved_customer' | 'resolved_provider' | 'dismissed';

  @IsOptional()
  @IsString()
  notes?: string;
}

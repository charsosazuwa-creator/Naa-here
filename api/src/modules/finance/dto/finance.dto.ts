import { IsIn, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class RequestPayoutDto {
  @IsInt()
  @Min(1)
  amountMinorUnits!: number;

  @IsString()
  currencyCode!: string;
}

export class DecidePayoutDto {
  @IsIn(['paid', 'rejected'])
  decision!: 'paid' | 'rejected';

  @IsOptional()
  @IsString()
  notes?: string;
}

export class IssueRefundDto {
  @IsInt()
  @Min(1)
  amountMinorUnits!: number;

  @IsString()
  currencyCode!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  reason?: string;
}

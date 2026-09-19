import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';

export class CreateJobRequestDto {
  @IsUUID()
  serviceId!: string;

  @IsString()
  @MinLength(1)
  description!: string;
}

export class CreateQuotationDto {
  @IsInt()
  @Min(0)
  amountMinorUnits!: number;

  @IsString()
  currencyCode!: string;

  @IsDateString()
  proposedStartsAt!: string;

  @IsDateString()
  proposedEndsAt!: string;

  @IsDateString()
  validUntil!: string;
}

export class DeclineJobRequestDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

import { IsIn, IsInt, IsOptional, IsPositive, IsString, IsUUID, Min, MinLength } from 'class-validator';

export class CreateServiceDto {
  @IsInt()
  @IsPositive()
  categoryId!: number;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  durationMinutes?: number;

  @IsInt()
  @Min(0)
  priceMinorUnits!: number;

  @IsIn(['NGN', 'KES', 'GHS', 'ZAR'])
  currencyCode!: string;
}

export class UpdateServiceStatusDto {
  @IsIn(['draft', 'published', 'archived'])
  status!: 'draft' | 'published' | 'archived';
}

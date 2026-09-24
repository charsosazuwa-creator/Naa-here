import { IsIn, IsInt, IsOptional, IsPositive, IsString, IsUUID, Min, MinLength, ValidateIf } from 'class-validator';

export class CreateServiceDto {
  // Pick an existing service_category by id, OR type a new/existing
  // one by name -- exactly one of the two is required. See
  // ServiceCatalogueService.resolveCategory().
  @ValidateIf((o) => !o.categoryName)
  @IsInt()
  @IsPositive()
  categoryId?: number;

  @ValidateIf((o) => !o.categoryId)
  @IsString()
  @MinLength(1)
  categoryName?: string;

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

/** Admin console's "add a service category" action -- see migration 023's 'category.manage' permission. */
export class CreateServiceCategoryDto {
  @IsString()
  @MinLength(1)
  name!: string;
}

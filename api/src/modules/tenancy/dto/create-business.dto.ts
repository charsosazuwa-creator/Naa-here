import { IsEmail, IsIn, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';

export class CreateBusinessDto {
  @IsString()
  @MinLength(1)
  name!: string;

  // What platform role the creator gets (owner/artisan/host) -- kept
  // separate from `category`/`categoryId` below since migration 018,
  // rather than inferred from category text. See business.service.ts.
  @IsIn(['provider', 'artisan', 'host'])
  businessType!: 'provider' | 'artisan' | 'host';

  // Pick an existing business_category by id, OR type a new/existing
  // one by name -- exactly one of the two is required. See
  // BusinessCategoryService.resolve().
  @ValidateIf((o) => !o.categoryName)
  @IsString()
  categoryId?: string;

  @ValidateIf((o) => !o.categoryId)
  @IsString()
  @MinLength(1)
  categoryName?: string;

  @IsIn(['NG', 'KE', 'GH', 'ZA'])
  countryCode!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;
}

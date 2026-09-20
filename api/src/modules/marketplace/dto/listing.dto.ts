import { IsIn, IsInt, IsOptional, IsString, Min, MinLength, ValidateIf } from 'class-validator';

const LISTING_TYPES = ['product', 'service', 'invention'] as const;
const PRICE_TYPES = ['fixed', 'contact', 'negotiable', 'starting_from'] as const;
const CONTACT_METHODS = ['phone', 'email', 'whatsapp'] as const;
const CURRENCIES = ['NGN', 'KES', 'GHS', 'ZAR'] as const;
const COUNTRIES = ['NG', 'KE', 'GH', 'ZA'] as const;

export class CreateListingDto {
  @IsIn(LISTING_TYPES)
  listingType!: 'product' | 'service' | 'invention';

  @IsString()
  @MinLength(1)
  title!: string;

  @IsString()
  @MinLength(1)
  category!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsIn(PRICE_TYPES)
  priceType!: 'fixed' | 'contact' | 'negotiable' | 'starting_from';

  // Required only for the two price types that actually carry a
  // number — 'contact'/'negotiable' listings have nothing to
  // validate here (enforced again in ListingService.assertPricing,
  // the same defence-in-depth split password.util.ts uses).
  @ValidateIf((o: CreateListingDto) => o.priceType === 'fixed' || o.priceType === 'starting_from')
  @IsInt()
  @Min(0)
  priceMinorUnits?: number;

  @ValidateIf((o: CreateListingDto) => o.priceType === 'fixed' || o.priceType === 'starting_from')
  @IsIn(CURRENCIES)
  currencyCode?: string;

  @IsOptional()
  @IsIn(COUNTRIES)
  countryCode?: string;

  @IsOptional()
  @IsString()
  locationText?: string;

  @IsIn(CONTACT_METHODS)
  contactMethod!: 'phone' | 'email' | 'whatsapp';

  @IsString()
  @MinLength(1)
  contactValue!: string;
}

/**
 * Same fields as CreateListingDto, all optional — a PATCH only
 * touches what's sent. No @nestjs/mapped-types dependency in this
 * project (CreateServiceDto/UpdateServiceStatusDto in the catalogue
 * module are hand-duplicated the same way), so this is written out
 * rather than derived.
 */
export class UpdateListingDto {
  @IsOptional()
  @IsIn(LISTING_TYPES)
  listingType?: 'product' | 'service' | 'invention';

  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  category?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(PRICE_TYPES)
  priceType?: 'fixed' | 'contact' | 'negotiable' | 'starting_from';

  @IsOptional()
  @IsInt()
  @Min(0)
  priceMinorUnits?: number;

  @IsOptional()
  @IsIn(CURRENCIES)
  currencyCode?: string;

  @IsOptional()
  @IsIn(COUNTRIES)
  countryCode?: string;

  @IsOptional()
  @IsString()
  locationText?: string;

  @IsOptional()
  @IsIn(CONTACT_METHODS)
  contactMethod?: 'phone' | 'email' | 'whatsapp';

  @IsOptional()
  @IsString()
  @MinLength(1)
  contactValue?: string;
}

export class DecideListingDto {
  @IsIn(['approved', 'rejected'])
  decision!: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  reason?: string;
}

export class DiscoverListingsQueryDto {
  @IsOptional()
  @IsIn(LISTING_TYPES)
  listingType?: 'product' | 'service' | 'invention';

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsIn(COUNTRIES)
  countryCode?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  search?: string;
}

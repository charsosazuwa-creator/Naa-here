import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min, MinLength, ValidateIf } from 'class-validator';

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

  // Optional pin for map/distance search (US-004/US-009). Filled in by
  // the "use my current location" button on the listing form (browser
  // geolocation), never required — a listing with no coordinates just
  // never appears in a distance-sorted or radius-limited search.
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

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
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

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

const SORT_OPTIONS = ['relevance', 'distance', 'price_asc', 'price_desc', 'newest'] as const;

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

  // US-008: price-range filter. Query params arrive as strings, so
  // @Type(() => Number) does the string->number conversion (ValidationPipe's
  // global transform:true alone doesn't do implicit primitive conversion).
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPrice?: number;

  // US-004/US-009: customer's current position, for distance filtering/
  // sorting. Both must be present together for either to take effect
  // (ListingService.search checks this, not the DTO).
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(500)
  radiusKm?: number;

  @IsOptional()
  @IsIn(SORT_OPTIONS)
  sort?: 'relevance' | 'distance' | 'price_asc' | 'price_desc' | 'newest';
}

// US-005: Google Places search, alongside (not instead of) platform
// listings. Query params, so numeric fields go through @Type(() =>
// Number) same as DiscoverListingsQueryDto above.
export class GooglePlacesQueryDto {
  @IsOptional()
  @IsString()
  query?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(500)
  radiusKm?: number;
}

// US-006: natural-language AI search. A POST body (not a GET query)
// since the free-text request can be long and shouldn't sit in a URL.
export class AiSearchQueryDto {
  @IsString()
  @MinLength(1)
  query!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(500)
  radiusKm?: number;
}

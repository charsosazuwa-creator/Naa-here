import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

const CATEGORY_CODES = ['barber_salon', 'accommodation', 'artisan'] as const;

/**
 * Every field is optional — an empty query is "browse everything
 * published". Filtering is done in SQL (discovery.service.ts), not
 * pulled into memory, since this route is unauthenticated and
 * unbounded by tenant.
 */
export class DiscoverServicesQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(2)
  countryCode?: string;

  @IsOptional()
  @IsIn(CATEGORY_CODES)
  category?: (typeof CATEGORY_CODES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}

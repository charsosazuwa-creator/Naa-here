import { Controller, Get, Param, Query } from '@nestjs/common';
import { DiscoverListingsQueryDto } from './dto/listing.dto';
import { ListingService } from './listing.service';

/**
 * Public, unauthenticated browse/search over PUBLISHED marketplace
 * listings (AC15-AC17) — the same `/discover` namespace
 * DiscoveryModule already uses for the tenant `service` catalogue,
 * just a different resource ('listings' vs 'services') in a
 * different module, since a marketplace listing isn't tenant-scoped
 * and doesn't belong in that module's RLS-driven query shape.
 */
@Controller('discover')
export class MarketplaceDiscoveryController {
  constructor(private readonly listings: ListingService) {}

  @Get('listings')
  search(@Query() query: DiscoverListingsQueryDto) {
    return this.listings.search(query);
  }

  @Get('listings/:listingId')
  getOne(@Param('listingId') listingId: string) {
    return this.listings.getPublished(listingId);
  }
}

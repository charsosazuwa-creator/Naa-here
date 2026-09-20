import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AiSearchQueryDto, DiscoverListingsQueryDto, GooglePlacesQueryDto } from './dto/listing.dto';
import { ListingService } from './listing.service';
import { GooglePlacesService } from './google-places.service';
import { AiSearchService } from './ai-search.service';

/**
 * Public, unauthenticated browse/search over PUBLISHED marketplace
 * listings (AC15-AC17) — the same `/discover` namespace
 * DiscoveryModule already uses for the tenant `service` catalogue,
 * just a different resource ('listings' vs 'services') in a
 * different module, since a marketplace listing isn't tenant-scoped
 * and doesn't belong in that module's RLS-driven query shape.
 *
 * Also hosts US-005 (Google Places) and US-006 (AI natural-language
 * search) here rather than as separate controllers, since both exist
 * only to feed the same listing search — a Google/AI result is never
 * a resource of its own with its own CRUD routes.
 */
@Controller('discover')
export class MarketplaceDiscoveryController {
  constructor(
    private readonly listings: ListingService,
    private readonly googlePlaces: GooglePlacesService,
    private readonly aiSearch: AiSearchService,
  ) {}

  @Get('listings')
  search(@Query() query: DiscoverListingsQueryDto) {
    return this.listings.search(query);
  }

  @Get('listings/:listingId')
  getOne(@Param('listingId') listingId: string) {
    return this.listings.getPublished(listingId);
  }

  // US-005: nearby businesses sourced from Google, shown as a separate,
  // clearly labeled section alongside platform listings — never merged
  // into or written back to the `listing` table (AC "a Google result
  // must not automatically become a verified platform provider").
  @Get('google')
  async searchGoogle(@Query() query: GooglePlacesQueryDto) {
    if (!this.googlePlaces.isConfigured()) {
      return { available: false, results: [] };
    }
    const results = await this.googlePlaces.search(query);
    return { available: true, results };
  }

  // US-006: interpret free text into structured filters, then run
  // those filters through the same search() everyone else uses — the
  // response's `interpreted` block is shown back to the customer so
  // they can correct it (AC "the customer must be able to correct the
  // interpreted criteria") before it's treated as final.
  @Post('ai-search')
  async aiInterpretedSearch(@Body() body: AiSearchQueryDto) {
    if (!this.aiSearch.isConfigured()) {
      const results = await this.listings.search({ search: body.query, lat: body.lat, lng: body.lng, radiusKm: body.radiusKm });
      return { available: false, interpreted: null, results };
    }

    const interpreted = await this.aiSearch.interpret(body.query);
    if (!interpreted) {
      const results = await this.listings.search({ search: body.query, lat: body.lat, lng: body.lng, radiusKm: body.radiusKm });
      return { available: false, interpreted: null, results };
    }

    const results = await this.listings.search({
      listingType: interpreted.listingType,
      category: interpreted.category,
      location: interpreted.location,
      search: interpreted.keywords ?? (interpreted.category ? undefined : body.query),
      lat: body.lat,
      lng: body.lng,
      radiusKm: body.radiusKm,
    });
    return { available: true, interpreted, results };
  }
}

import { Module } from '@nestjs/common';
import { ListingController } from './listing.controller';
import { ListingImageController } from './listing-image.controller';
import { ListingAdminController } from './listing-admin.controller';
import { MarketplaceDiscoveryController } from './marketplace-discovery.controller';
import { ListingService } from './listing.service';
import { ListingImageService } from './listing-image.service';
import { GooglePlacesService } from './google-places.service';
import { AiSearchService } from './ai-search.service';

@Module({
  controllers: [ListingController, ListingImageController, ListingAdminController, MarketplaceDiscoveryController],
  providers: [ListingService, ListingImageService, GooglePlacesService, AiSearchService],
})
export class MarketplaceModule {}

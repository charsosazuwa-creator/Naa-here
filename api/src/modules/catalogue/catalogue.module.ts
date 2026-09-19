import { Module } from '@nestjs/common';
import { CatalogueController } from './catalogue.controller';
import { ServiceCatalogueService } from './service.service';
import { AvailabilityService } from './availability.service';

@Module({
  controllers: [CatalogueController],
  providers: [ServiceCatalogueService, AvailabilityService],
})
export class CatalogueModule {}

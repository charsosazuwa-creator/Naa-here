import { Module } from '@nestjs/common';
import { CatalogueController } from './catalogue.controller';
import { ServiceCategoryController } from './service-category.controller';
import { ServiceCatalogueService } from './service.service';
import { AvailabilityService } from './availability.service';

@Module({
  controllers: [CatalogueController, ServiceCategoryController],
  providers: [ServiceCatalogueService, AvailabilityService],
})
export class CatalogueModule {}

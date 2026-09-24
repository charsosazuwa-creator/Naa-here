import { Module } from '@nestjs/common';
import { CatalogueController } from './catalogue.controller';
import { ServiceCategoryController } from './service-category.controller';
import { ServiceImageController } from './service-image.controller';
import { ServiceCatalogueService } from './service.service';
import { AvailabilityService } from './availability.service';
import { ServiceImageService } from './service-image.service';

@Module({
  controllers: [CatalogueController, ServiceCategoryController, ServiceImageController],
  providers: [ServiceCatalogueService, AvailabilityService, ServiceImageService],
  exports: [ServiceImageService],
})
export class CatalogueModule {}

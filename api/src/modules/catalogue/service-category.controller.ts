import { Controller, Get } from '@nestjs/common';
import { ServiceCatalogueService } from './service.service';

/**
 * Separate from CatalogueController (which is tenant-scoped, see its
 * own comment) because this is the shared, cross-tenant category list
 * a "create service" form autocompletes against -- the same shape as
 * BusinessCategoryController for business categories.
 */
@Controller('service-categories')
export class ServiceCategoryController {
  constructor(private readonly services: ServiceCatalogueService) {}

  @Get()
  list() {
    return this.services.listCategories();
  }
}

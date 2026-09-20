import { Controller, Get } from '@nestjs/common';
import { BusinessCategoryService } from './business-category.service';

/**
 * A separate controller (rather than a route on TenancyController)
 * because it isn't nested under /tenants/:tenantId at all -- this is
 * the shared, cross-tenant category list a "create business" form
 * autocompletes against.
 */
@Controller('business-categories')
export class BusinessCategoryController {
  constructor(private readonly categories: BusinessCategoryService) {}

  @Get()
  list() {
    return this.categories.list();
  }
}

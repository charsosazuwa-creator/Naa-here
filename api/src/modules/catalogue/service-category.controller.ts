import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformPermissionGuard } from '../../common/guards/platform-permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { CreateServiceCategoryDto } from './dto/service.dto';
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

  // Admin console's direct "add a category" action -- see migration
  // 023's 'category.manage' permission. A provider still creates one
  // on the fly by typing a new name into the "create service" form
  // (ServiceCatalogueService.resolveCategory(), used by
  // CatalogueController); this is the separate, explicit admin path
  // onto the same table.
  @Post()
  @UseGuards(JwtAuthGuard, PlatformPermissionGuard)
  @RequirePermission('category.manage')
  create(@CurrentUserId() userId: string, @Body() dto: CreateServiceCategoryDto) {
    return this.services.createCategory(userId, dto.name);
  }
}

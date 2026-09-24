import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformPermissionGuard } from '../../common/guards/platform-permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { CreateCategoryDto } from './dto/create-category.dto';
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

  // Admin console's direct "add a category" action -- see migration
  // 023's 'category.manage' permission. A provider still creates one
  // on the fly by typing a new name into the "create business" form
  // (BusinessCategoryService.resolve(), used by TenancyController);
  // this is the separate, explicit admin path onto the same table.
  @Post()
  @UseGuards(JwtAuthGuard, PlatformPermissionGuard)
  @RequirePermission('category.manage')
  create(@CurrentUserId() userId: string, @Body() dto: CreateCategoryDto) {
    return this.categories.create(userId, dto.name);
  }
}

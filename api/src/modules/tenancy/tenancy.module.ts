import { Module } from '@nestjs/common';
import { TenancyService } from './tenancy.service';
import { TenancyController } from './tenancy.controller';
import { BusinessCategoryController } from './business-category.controller';
import { BusinessService } from './business.service';
import { BusinessCategoryService } from './business-category.service';
import { LocationService } from './location.service';
import { StaffService } from './staff.service';

@Module({
  controllers: [TenancyController, BusinessCategoryController],
  providers: [TenancyService, BusinessService, BusinessCategoryService, LocationService, StaffService],
  // BusinessService is also exported: OAuthService (identity module)
  // reuses it to create a tenant when a Google/Facebook sign-in carries
  // provider-signup business details, the same way
  // TenancyController.create() does for the password flow.
  exports: [TenancyService, BusinessService],
})
export class TenancyModule {}

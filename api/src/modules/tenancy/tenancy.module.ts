import { Module } from '@nestjs/common';
import { TenancyService } from './tenancy.service';
import { TenancyController } from './tenancy.controller';
import { BusinessService } from './business.service';
import { LocationService } from './location.service';
import { StaffService } from './staff.service';

@Module({
  controllers: [TenancyController],
  providers: [TenancyService, BusinessService, LocationService, StaffService],
  // BusinessService is also exported: OAuthService (identity module)
  // reuses it to create a tenant when a Google/Facebook sign-in carries
  // provider-signup business details, the same way
  // TenancyController.create() does for the password flow.
  exports: [TenancyService, BusinessService],
})
export class TenancyModule {}

import { Module } from '@nestjs/common';
import { TenancyService } from './tenancy.service';
import { TenancyController } from './tenancy.controller';
import { BusinessService } from './business.service';
import { LocationService } from './location.service';
import { StaffService } from './staff.service';

@Module({
  controllers: [TenancyController],
  providers: [TenancyService, BusinessService, LocationService, StaffService],
  exports: [TenancyService],
})
export class TenancyModule {}

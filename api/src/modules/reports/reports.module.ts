import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsAdminController } from './reports-admin.controller';
import { ReportsService } from './reports.service';

@Module({
  controllers: [ReportsController, ReportsAdminController],
  providers: [ReportsService],
})
export class ReportsModule {}

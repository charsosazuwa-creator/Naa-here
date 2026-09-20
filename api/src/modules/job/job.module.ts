import { Module } from '@nestjs/common';
import { JobController, JobRequestsMineController } from './job.controller';
import { JobService } from './job.service';

@Module({
  controllers: [JobController, JobRequestsMineController],
  providers: [JobService],
})
export class JobModule {}

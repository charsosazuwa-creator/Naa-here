import { Module } from '@nestjs/common';
import { DisputeController } from './dispute.controller';
import { DisputeMineController } from './dispute-mine.controller';
import { DisputeAdminController } from './dispute-admin.controller';
import { DisputeService } from './dispute.service';
import { DisputeAttachmentService } from './dispute-attachment.service';

@Module({
  controllers: [DisputeController, DisputeMineController, DisputeAdminController],
  providers: [DisputeService, DisputeAttachmentService],
})
export class DisputeModule {}

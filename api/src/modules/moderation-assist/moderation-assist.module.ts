import { Module } from '@nestjs/common';
import { ModerationAssistService } from './moderation-assist.service';

@Module({
  providers: [ModerationAssistService],
  exports: [ModerationAssistService],
})
export class ModerationAssistModule {}

import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { CallController } from './call.controller';
import { GroupCallController } from './group-call.controller';
import { ProviderCallController } from './provider-call.controller';
import { CallService } from './call.service';

/**
 * Phase 2 of the voice-call/chat user stories: WebRTC voice calling
 * (User Story 1's group-member calls, and Stories 2 & 3's calling
 * halves). Imports MessagingModule to reuse DirectMessageService's
 * Provider-eligibility and blocking checks rather than duplicating
 * that business rule.
 */
@Module({
  imports: [MessagingModule],
  controllers: [CallController, GroupCallController, ProviderCallController],
  providers: [CallService],
})
export class CallsModule {}

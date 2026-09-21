import { Module } from '@nestjs/common';
import { DirectMessageController } from './direct-message.controller';
import { ProviderConversationController } from './provider-conversation.controller';
import { DirectMessageService } from './direct-message.service';

/**
 * Phase 1 of the voice-call/chat user stories: direct messaging
 * between Customers and Provider tenants (User Stories 2 & 3's chat
 * halves). Voice calling (WebRTC signaling over RealtimeGateway,
 * Phase 2) is not part of this module yet.
 */
@Module({
  controllers: [DirectMessageController, ProviderConversationController],
  providers: [DirectMessageService],
  exports: [DirectMessageService],
})
export class MessagingModule {}

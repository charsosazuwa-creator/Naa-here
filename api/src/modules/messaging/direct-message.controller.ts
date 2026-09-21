import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { DirectMessageService } from './direct-message.service';
import { SendMessageDto, StartConversationAsCustomerDto } from './dto/messaging.dto';

/**
 * Customer-facing + party-agnostic conversation routes (User Stories 2
 * & 3's chat half). Every route here is JwtAuthGuard only -- unlike
 * the provider-side routes in provider-conversation.controller.ts,
 * there's no single :tenantId to hang a TenantRoleGuard check on for
 * most of these (a conversation's tenant is looked up from the
 * conversation itself), so DirectMessageService enforces who may act
 * on a given conversation, the same pattern GroupController uses.
 */
@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class DirectMessageController {
  constructor(private readonly messages: DirectMessageService) {}

  @Post()
  startAsCustomer(@CurrentUserId() userId: string, @Body() dto: StartConversationAsCustomerDto) {
    return this.messages.startAsCustomer(userId, dto);
  }

  @Get('mine')
  listMine(@CurrentUserId() userId: string) {
    return this.messages.listForCustomer(userId);
  }

  @Post(':conversationId/messages')
  reply(@CurrentUserId() userId: string, @Param('conversationId') conversationId: string, @Body() dto: SendMessageDto) {
    return this.messages.reply(conversationId, userId, dto.body);
  }

  @Get(':conversationId/messages')
  listMessages(@CurrentUserId() userId: string, @Param('conversationId') conversationId: string) {
    return this.messages.listMessages(conversationId, userId);
  }

  @Post(':conversationId/block')
  block(@CurrentUserId() userId: string, @Param('conversationId') conversationId: string) {
    return this.messages.block(conversationId, userId);
  }

  @Delete(':conversationId/block')
  unblock(@CurrentUserId() userId: string, @Param('conversationId') conversationId: string) {
    return this.messages.unblock(conversationId, userId);
  }
}

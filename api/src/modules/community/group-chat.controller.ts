import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { GroupChatService } from './group-chat.service';
import { ListGroupMessagesQueryDto, SendGroupMessageDto } from './dto/group-chat.dto';

/** Group chat -- polled by the client (see group-chat.service.ts's header comment for why there's no push channel). */
@Controller('groups/:groupId/messages')
@UseGuards(JwtAuthGuard)
export class GroupChatController {
  constructor(private readonly chat: GroupChatService) {}

  @Post()
  send(@CurrentUserId() userId: string, @Param('groupId') groupId: string, @Body() dto: SendGroupMessageDto) {
    return this.chat.send(groupId, userId, dto.body);
  }

  @Get()
  list(@CurrentUserId() userId: string, @Param('groupId') groupId: string, @Query() query: ListGroupMessagesQueryDto) {
    return this.chat.list(groupId, userId, query.after);
  }

  @Delete(':messageId')
  async remove(@CurrentUserId() userId: string, @Param('groupId') groupId: string, @Param('messageId') messageId: string) {
    await this.chat.delete(groupId, messageId, userId);
  }
}

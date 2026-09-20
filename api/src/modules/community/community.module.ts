import { Module } from '@nestjs/common';
import { GroupController } from './group.controller';
import { GroupService } from './group.service';
import { GroupPostController } from './group-post.controller';
import { GroupPostService } from './group-post.service';
import { GroupModerationController } from './group-moderation.controller';
import { GroupModerationService } from './group-moderation.service';
import { GroupChatController } from './group-chat.controller';
import { GroupChatService } from './group-chat.service';

/** User Story 5: Service Provider / Business Owner community groups. */
@Module({
  controllers: [GroupController, GroupPostController, GroupModerationController, GroupChatController],
  providers: [GroupService, GroupPostService, GroupModerationService, GroupChatService],
})
export class CommunityModule {}

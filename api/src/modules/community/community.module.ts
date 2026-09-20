import { Module } from '@nestjs/common';
import { GroupController } from './group.controller';
import { GroupService } from './group.service';
import { GroupPostController } from './group-post.controller';
import { GroupPostService } from './group-post.service';
import { GroupModerationController } from './group-moderation.controller';
import { GroupModerationService } from './group-moderation.service';

/** User Story 5: Service Provider / Business Owner community groups. */
@Module({
  controllers: [GroupController, GroupPostController, GroupModerationController],
  providers: [GroupService, GroupPostService, GroupModerationService],
})
export class CommunityModule {}

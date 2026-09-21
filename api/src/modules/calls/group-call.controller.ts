import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { CallService } from './call.service';
import { InitiateGroupCallDto } from './dto/call.dto';

/**
 * User Story 1: voice calls between two members of the same group.
 * JwtAuthGuard only -- a group has no single owning tenant (same
 * reasoning as GroupController), so CallService itself validates both
 * users are active members of :groupId.
 */
@Controller('groups/:groupId/calls')
@UseGuards(JwtAuthGuard)
export class GroupCallController {
  constructor(private readonly calls: CallService) {}

  @Post()
  initiate(@Param('groupId') groupId: string, @CurrentUserId() userId: string, @Body() dto: InitiateGroupCallDto) {
    return this.calls.initiateGroupCall(userId, groupId, dto.calleeUserId);
  }
}

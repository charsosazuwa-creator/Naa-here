import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { GroupService } from './group.service';
import {
  ChangeRoleDto,
  CreateGroupDto,
  DiscoverGroupsQueryDto,
  InviteMemberDto,
  ModerateMemberDto,
  TransferOwnershipDto,
  UpdateGroupDto,
} from './dto/group.dto';

/**
 * Groups + membership. Every route is behind JwtAuthGuard only -- a
 * group has no single owning tenant (see group.service.ts's header
 * comment), so there's no :tenantId for TenantRoleGuard to check;
 * role/eligibility checks live in the service instead.
 */
@Controller('groups')
@UseGuards(JwtAuthGuard)
export class GroupController {
  constructor(private readonly groups: GroupService) {}

  @Post()
  create(@CurrentUserId() userId: string, @Body() dto: CreateGroupDto) {
    return this.groups.create(userId, dto);
  }

  @Get()
  discover(@CurrentUserId() userId: string, @Query() query: DiscoverGroupsQueryDto) {
    return this.groups.discover(userId, query);
  }

  // Before ':groupId' so Nest/Express matches this literal segment first.
  @Get('invitations/mine')
  myInvitations(@CurrentUserId() userId: string) {
    return this.groups.myInvitations(userId);
  }

  @Get(':groupId')
  get(@CurrentUserId() userId: string, @Param('groupId') groupId: string) {
    return this.groups.get(groupId, userId);
  }

  @Patch(':groupId')
  update(@CurrentUserId() userId: string, @Param('groupId') groupId: string, @Body() dto: UpdateGroupDto) {
    return this.groups.update(groupId, userId, dto);
  }

  @Post(':groupId/join')
  join(@CurrentUserId() userId: string, @Param('groupId') groupId: string) {
    return this.groups.join(groupId, userId);
  }

  @Post(':groupId/leave')
  leave(@CurrentUserId() userId: string, @Param('groupId') groupId: string) {
    return this.groups.leave(groupId, userId);
  }

  @Post(':groupId/close')
  close(@CurrentUserId() userId: string, @Param('groupId') groupId: string) {
    return this.groups.close(groupId, userId);
  }

  @Post(':groupId/transfer-ownership')
  transferOwnership(@CurrentUserId() userId: string, @Param('groupId') groupId: string, @Body() dto: TransferOwnershipDto) {
    return this.groups.transferOwnership(groupId, userId, dto);
  }

  @Get(':groupId/members')
  listMembers(@CurrentUserId() userId: string, @Param('groupId') groupId: string) {
    return this.groups.listMembers(groupId, userId);
  }

  @Get(':groupId/join-requests')
  listPendingRequests(@CurrentUserId() userId: string, @Param('groupId') groupId: string) {
    return this.groups.listPendingRequests(groupId, userId);
  }

  @Post(':groupId/join-requests/:memberId/approve')
  approveJoinRequest(@CurrentUserId() userId: string, @Param('groupId') groupId: string, @Param('memberId') memberId: string) {
    return this.groups.decideJoinRequest(groupId, memberId, userId, true);
  }

  @Post(':groupId/join-requests/:memberId/decline')
  declineJoinRequest(@CurrentUserId() userId: string, @Param('groupId') groupId: string, @Param('memberId') memberId: string) {
    return this.groups.decideJoinRequest(groupId, memberId, userId, false);
  }

  @Post(':groupId/invitations')
  invite(@CurrentUserId() userId: string, @Param('groupId') groupId: string, @Body() dto: InviteMemberDto) {
    return this.groups.invite(groupId, userId, dto.email);
  }

  @Post(':groupId/invitations/accept')
  acceptInvitation(@CurrentUserId() userId: string, @Param('groupId') groupId: string) {
    return this.groups.decideInvitation(groupId, userId, true);
  }

  @Post(':groupId/invitations/decline')
  declineInvitation(@CurrentUserId() userId: string, @Param('groupId') groupId: string) {
    return this.groups.decideInvitation(groupId, userId, false);
  }

  @Patch(':groupId/members/:memberId/role')
  changeRole(
    @CurrentUserId() userId: string,
    @Param('groupId') groupId: string,
    @Param('memberId') memberId: string,
    @Body() dto: ChangeRoleDto,
  ) {
    return this.groups.changeRole(groupId, memberId, userId, dto);
  }

  @Post(':groupId/members/:memberId/moderate')
  moderateMember(
    @CurrentUserId() userId: string,
    @Param('groupId') groupId: string,
    @Param('memberId') memberId: string,
    @Body() dto: ModerateMemberDto,
  ) {
    return this.groups.moderateMember(groupId, memberId, userId, dto);
  }
}

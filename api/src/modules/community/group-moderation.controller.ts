import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { GroupModerationService } from './group-moderation.service';
import { CreateReportDto, DecideReportDto } from './dto/group-moderation.dto';

@Controller('groups/:groupId/moderation')
@UseGuards(JwtAuthGuard)
export class GroupModerationController {
  constructor(private readonly moderation: GroupModerationService) {}

  @Post('reports')
  report(@CurrentUserId() userId: string, @Param('groupId') groupId: string, @Body() dto: CreateReportDto) {
    return this.moderation.report(groupId, userId, dto);
  }

  @Get('reports')
  listOpen(@CurrentUserId() userId: string, @Param('groupId') groupId: string) {
    return this.moderation.listOpen(groupId, userId);
  }

  @Post('reports/:reportId/decide')
  decide(
    @CurrentUserId() userId: string,
    @Param('groupId') groupId: string,
    @Param('reportId') reportId: string,
    @Body() dto: DecideReportDto,
  ) {
    return this.moderation.decide(groupId, reportId, userId, dto);
  }
}

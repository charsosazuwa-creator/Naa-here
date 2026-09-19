import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantRoleGuard } from '../../common/guards/tenant-role.guard';
import { PlatformPermissionGuard } from '../../common/guards/platform-permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { VerificationService } from './verification.service';
import { SubmitVerificationDto, DecideVerificationDto } from './dto/submit-verification.dto';

@Controller('tenants/:tenantId/verification')
@UseGuards(JwtAuthGuard)
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Post()
  @UseGuards(TenantRoleGuard)
  @RequirePermission('verification.submit')
  submit(@Param('tenantId') tenantId: string, @CurrentUserId() userId: string, @Body() dto: SubmitVerificationDto) {
    return this.verification.submit(tenantId, userId, dto.documentType, dto.attachmentId);
  }

  @Get()
  @UseGuards(TenantRoleGuard)
  list(@Param('tenantId') tenantId: string) {
    return this.verification.listForTenant(tenantId);
  }

  // Platform-level, not tenant-membership-based — see
  // PlatformPermissionGuard and the platform_role_assignment table
  // (migration 005) it checks.
  @Post(':submissionId/decide')
  @UseGuards(PlatformPermissionGuard)
  @RequirePermission('verification.decide')
  decide(
    @Param('tenantId') tenantId: string,
    @Param('submissionId') submissionId: string,
    @CurrentUserId() userId: string,
    @Body() dto: DecideVerificationDto,
  ) {
    return this.verification.decide(tenantId, submissionId, userId, dto.decision, dto.note);
  }
}

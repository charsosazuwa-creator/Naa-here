import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantRoleGuard } from '../../common/guards/tenant-role.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { JobService } from './job.service';
import { CreateJobRequestDto, CreateQuotationDto, DeclineJobRequestDto } from './dto/job-request.dto';

@Controller('tenants/:tenantId/job-requests')
@UseGuards(JwtAuthGuard)
export class JobController {
  constructor(private readonly jobs: JobService) {}

  /** Customer-facing: not behind TenantRoleGuard, same as booking creation. */
  @Post()
  createRequest(@Param('tenantId') tenantId: string, @CurrentUserId() userId: string, @Body() dto: CreateJobRequestDto) {
    return this.jobs.createRequest(tenantId, userId, dto);
  }

  /** Customer-facing: accepting your own quotation needs no tenant membership either. */
  @Post(':jobRequestId/accept')
  accept(@Param('tenantId') tenantId: string, @Param('jobRequestId') jobRequestId: string, @CurrentUserId() userId: string) {
    return this.jobs.accept(tenantId, jobRequestId, userId);
  }

  @Get()
  @UseGuards(TenantRoleGuard)
  @RequirePermission('job.manage')
  listForTenant(@Param('tenantId') tenantId: string) {
    return this.jobs.listForTenant(tenantId);
  }

  @Post(':jobRequestId/quote')
  @UseGuards(TenantRoleGuard)
  @RequirePermission('job.manage')
  quote(
    @Param('tenantId') tenantId: string,
    @Param('jobRequestId') jobRequestId: string,
    @CurrentUserId() userId: string,
    @Body() dto: CreateQuotationDto,
  ) {
    return this.jobs.quote(tenantId, jobRequestId, userId, dto);
  }

  @Post(':jobRequestId/decline')
  @UseGuards(TenantRoleGuard)
  @RequirePermission('job.manage')
  decline(@Param('tenantId') tenantId: string, @Param('jobRequestId') jobRequestId: string, @Body() dto: DeclineJobRequestDto) {
    return this.jobs.decline(tenantId, jobRequestId, dto.reason);
  }
}

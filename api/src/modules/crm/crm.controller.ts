import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantRoleGuard } from '../../common/guards/tenant-role.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { CrmService } from './crm.service';
import { CreateCustomerDto, CreateNoteDto, CreateTaskDto, UpdateTaskStatusDto } from './dto/customer.dto';

// NOTE (found while building the reports feature, fixed alongside it):
// @RequirePermission used to sit here at the class level. Both
// TenantRoleGuard and PlatformPermissionGuard read the permission
// metadata off `context.getHandler()` only (the specific route
// method) -- never `context.getClass()` -- so a class-level
// @RequirePermission is invisible to them. The guard's own "fail
// closed" branch for a route with no declared permission then throws
// on every request: every route below has been unconditionally
// returning 403 "This route has no declared permission to check." in
// every environment, including production. moderation.controller.ts
// already carries a comment flagging this exact requirement
// ("@RequirePermission is read off the individual handler"); this
// controller just didn't follow it. Fixed by moving the same
// 'customer.manage' permission onto each handler below, matching
// every other controller in this codebase.
@Controller('tenants/:tenantId')
@UseGuards(JwtAuthGuard, TenantRoleGuard)
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  @Post('customers')
  @RequirePermission('customer.manage')
  createCustomer(@Param('tenantId') tenantId: string, @CurrentUserId() userId: string, @Body() dto: CreateCustomerDto) {
    return this.crm.createCustomer(tenantId, userId, dto);
  }

  @Get('customers')
  @RequirePermission('customer.manage')
  listCustomers(@Param('tenantId') tenantId: string) {
    return this.crm.listCustomers(tenantId);
  }

  @Post('customers/:customerId/notes')
  @RequirePermission('customer.manage')
  addNote(
    @Param('tenantId') tenantId: string,
    @Param('customerId') customerId: string,
    @CurrentUserId() userId: string,
    @Body() dto: CreateNoteDto,
  ) {
    return this.crm.addNote(tenantId, customerId, userId, dto);
  }

  @Get('customers/:customerId/notes')
  @RequirePermission('customer.manage')
  listNotes(@Param('tenantId') tenantId: string, @Param('customerId') customerId: string) {
    return this.crm.listNotes(tenantId, customerId);
  }

  @Post('tasks')
  @RequirePermission('customer.manage')
  createTask(@Param('tenantId') tenantId: string, @CurrentUserId() userId: string, @Body() dto: CreateTaskDto) {
    return this.crm.createTask(tenantId, userId, dto);
  }

  @Get('tasks')
  @RequirePermission('customer.manage')
  listTasks(@Param('tenantId') tenantId: string) {
    return this.crm.listTasks(tenantId);
  }

  @Patch('tasks/:taskId/status')
  @RequirePermission('customer.manage')
  setTaskStatus(@Param('tenantId') tenantId: string, @Param('taskId') taskId: string, @Body() dto: UpdateTaskStatusDto) {
    return this.crm.setTaskStatus(tenantId, taskId, dto.status);
  }
}

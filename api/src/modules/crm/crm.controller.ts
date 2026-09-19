import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantRoleGuard } from '../../common/guards/tenant-role.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { CrmService } from './crm.service';
import { CreateCustomerDto, CreateNoteDto, CreateTaskDto, UpdateTaskStatusDto } from './dto/customer.dto';

@Controller('tenants/:tenantId')
@UseGuards(JwtAuthGuard, TenantRoleGuard)
@RequirePermission('customer.manage')
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  @Post('customers')
  createCustomer(@Param('tenantId') tenantId: string, @CurrentUserId() userId: string, @Body() dto: CreateCustomerDto) {
    return this.crm.createCustomer(tenantId, userId, dto);
  }

  @Get('customers')
  listCustomers(@Param('tenantId') tenantId: string) {
    return this.crm.listCustomers(tenantId);
  }

  @Post('customers/:customerId/notes')
  addNote(
    @Param('tenantId') tenantId: string,
    @Param('customerId') customerId: string,
    @CurrentUserId() userId: string,
    @Body() dto: CreateNoteDto,
  ) {
    return this.crm.addNote(tenantId, customerId, userId, dto);
  }

  @Get('customers/:customerId/notes')
  listNotes(@Param('tenantId') tenantId: string, @Param('customerId') customerId: string) {
    return this.crm.listNotes(tenantId, customerId);
  }

  @Post('tasks')
  createTask(@Param('tenantId') tenantId: string, @CurrentUserId() userId: string, @Body() dto: CreateTaskDto) {
    return this.crm.createTask(tenantId, userId, dto);
  }

  @Get('tasks')
  listTasks(@Param('tenantId') tenantId: string) {
    return this.crm.listTasks(tenantId);
  }

  @Patch('tasks/:taskId/status')
  setTaskStatus(@Param('tenantId') tenantId: string, @Param('taskId') taskId: string, @Body() dto: UpdateTaskStatusDto) {
    return this.crm.setTaskStatus(tenantId, taskId, dto.status);
  }
}

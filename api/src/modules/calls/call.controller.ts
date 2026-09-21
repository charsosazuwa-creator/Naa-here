import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { CallService } from './call.service';
import { InitiateCustomerCallDto } from './dto/call.dto';

/**
 * Party-agnostic call routes (User Stories 1, 2 & 3's calling halves):
 * a Customer calling a business, and every call's accept/decline/end/
 * timeout, whichever side is acting. JwtAuthGuard only -- CallService
 * enforces who may act on a given call, the same pattern
 * DirectMessageController and GroupController already use.
 */
@Controller('calls')
@UseGuards(JwtAuthGuard)
export class CallController {
  constructor(private readonly calls: CallService) {}

  @Post()
  startAsCustomer(@CurrentUserId() userId: string, @Body() dto: InitiateCustomerCallDto) {
    return this.calls.initiateCustomerCall(userId, dto.tenantId);
  }

  @Get('mine')
  listMine(@CurrentUserId() userId: string) {
    return this.calls.listMine(userId);
  }

  @Post(':callId/accept')
  accept(@CurrentUserId() userId: string, @Param('callId') callId: string) {
    return this.calls.accept(callId, userId);
  }

  @Post(':callId/decline')
  decline(@CurrentUserId() userId: string, @Param('callId') callId: string) {
    return this.calls.decline(callId, userId);
  }

  @Post(':callId/end')
  end(@CurrentUserId() userId: string, @Param('callId') callId: string) {
    return this.calls.end(callId, userId);
  }

  @Post(':callId/timeout')
  timeout(@CurrentUserId() userId: string, @Param('callId') callId: string) {
    return this.calls.timeout(callId, userId);
  }
}

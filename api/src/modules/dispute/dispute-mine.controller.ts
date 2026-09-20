import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { DisputeService } from './dispute.service';

/**
 * Any signed-in user's own disputes, cross-tenant — same "a customer
 * is just a signed-in user" shape as booking.controller.ts's
 * /bookings/mine. Backs the customer portal's My Disputes list/track
 * view (US-056's "both parties must receive relevant status updates" —
 * this is the pull side of that; DisputeService also emails a
 * best-effort push update).
 */
@Controller('disputes')
@UseGuards(JwtAuthGuard)
export class DisputeMineController {
  constructor(private readonly disputes: DisputeService) {}

  @Get('mine')
  listMine(@CurrentUserId() userId: string) {
    return this.disputes.listMine(userId);
  }
}

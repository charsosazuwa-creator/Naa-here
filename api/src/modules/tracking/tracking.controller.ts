import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { TrackingService } from './tracking.service';

/**
 * Read-only status check for live location tracking on a booking --
 * "am I allowed to track, and who's the other side". The location
 * pings themselves never touch REST; they're relayed entirely over
 * RealtimeGateway (see TrackingService).
 */
@Controller('bookings')
@UseGuards(JwtAuthGuard)
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Get(':bookingId/tracking-status')
  getStatus(@Param('bookingId') bookingId: string, @CurrentUserId() userId: string) {
    return this.tracking.getStatus(bookingId, userId);
  }
}

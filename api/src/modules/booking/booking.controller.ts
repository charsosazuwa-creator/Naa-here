import { Body, Controller, Get, Param, Patch, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantRoleGuard } from '../../common/guards/tenant-role.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { IdempotencyInterceptor } from '../../common/interceptors/idempotency.interceptor';
import { BookingService } from './booking.service';
import { CreateBookingDto, RescheduleBookingDto, CancelBookingDto } from './dto/create-booking.dto';
import { TransitionBookingDto } from './dto/transition-booking.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class BookingController {
  constructor(private readonly bookings: BookingService) {}

  /**
   * Customer-facing: any signed-in user may book a published service.
   * Deliberately NOT behind TenantRoleGuard (a customer isn't a
   * tenant member) and requires an Idempotency-Key header so a
   * retried request can never double-book a customer into two slots.
   */
  @Post('tenants/:tenantId/bookings')
  @UseInterceptors(IdempotencyInterceptor)
  create(@Param('tenantId') tenantId: string, @CurrentUserId() userId: string, @Body() dto: CreateBookingDto) {
    return this.bookings.create(tenantId, userId, dto);
  }

  @Get('bookings/mine')
  listMine(@CurrentUserId() userId: string) {
    return this.bookings.listMine(userId);
  }

  @Patch('bookings/:bookingId/cancel')
  cancelOwn(@Param('bookingId') bookingId: string, @CurrentUserId() userId: string, @Body() dto: CancelBookingDto) {
    return this.bookings.cancelOwnBooking(bookingId, userId, dto.reason);
  }

  @Get('tenants/:tenantId/bookings')
  @UseGuards(TenantRoleGuard)
  @RequirePermission('booking.manage')
  listForTenant(@Param('tenantId') tenantId: string) {
    return this.bookings.listForTenant(tenantId);
  }

  @Patch('tenants/:tenantId/bookings/:bookingId/reschedule')
  @UseGuards(TenantRoleGuard)
  @RequirePermission('booking.manage')
  reschedule(
    @Param('tenantId') tenantId: string,
    @Param('bookingId') bookingId: string,
    @Body() dto: RescheduleBookingDto,
  ) {
    return this.bookings.reschedule(tenantId, bookingId, dto.startsAt, dto.endsAt);
  }

  @Patch('tenants/:tenantId/bookings/:bookingId/status')
  @UseGuards(TenantRoleGuard)
  @RequirePermission('booking.manage')
  transition(
    @Param('tenantId') tenantId: string,
    @Param('bookingId') bookingId: string,
    @CurrentUserId() userId: string,
    @Body() dto: TransitionBookingDto,
  ) {
    return this.bookings.transition(tenantId, bookingId, userId, dto.status, dto.reason);
  }
}

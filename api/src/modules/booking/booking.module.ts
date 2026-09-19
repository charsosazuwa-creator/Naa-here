import { Module } from '@nestjs/common';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { IdempotencyInterceptor } from '../../common/interceptors/idempotency.interceptor';

@Module({
  controllers: [BookingController],
  providers: [BookingService, IdempotencyInterceptor],
})
export class BookingModule {}

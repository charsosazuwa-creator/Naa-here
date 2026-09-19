import { Global, Module } from '@nestjs/common';
import { PAYMENT_PROVIDER } from './payment-provider.interface';
import { MockPaymentProvider } from './mock-payment.provider';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';

/**
 * The only file a real Phase 4 integration should need to touch to go
 * live: replace `useClass: MockPaymentProvider` with a real provider
 * class implementing the same PaymentProvider interface. Every other
 * module that moves money (booking, job, finance, dispute) depends on
 * PaymentsService, never on this binding directly.
 *
 * @Global(), matching DatabaseModule and AuditModule's own pattern —
 * booking/job/finance/dispute all need PaymentsService and none of
 * them should need to import PaymentsModule individually just to get
 * it, the same reasoning those two modules already established.
 */
@Global()
@Module({
  providers: [{ provide: PAYMENT_PROVIDER, useClass: MockPaymentProvider }, PaymentsService],
  controllers: [PaymentsController],
  exports: [PaymentsService],
})
export class PaymentsModule {}

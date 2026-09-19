import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import {
  ChargeRequest,
  PaymentAttemptResult,
  PaymentProvider,
  PayoutRequest,
  RefundRequest,
  WebhookEvent,
} from './payment-provider.interface';

/**
 * Stands in for a real PSP (Paystack, Flutterwave, or similar — the
 * launch markets are Nigeria, Kenya, Ghana, South Africa) since this
 * sandbox has no network access to reach one. Every charge, refund and
 * payout resolves synchronously to 'succeeded' — this is a deliberate
 * choice, not a shortcut: it preserves the exact ledger timing
 * Milestone 4 already built and tested (a booking's charge lands in
 * the same transaction as the booking itself), so this migration adds
 * a real payment-provider boundary without changing when money is
 * assumed to move. A provider that confirms asynchronously (a real
 * PSP's checkout redirect + webhook, rather than an instant capture
 * API) would return 'pending' from these methods instead and rely on
 * PaymentsService.handleWebhook to complete the attempt later — the
 * webhook signature/parsing methods below are implemented and tested
 * for exactly that case, even though this provider's own happy path
 * never needs them.
 */
@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  async initiateCharge(req: ChargeRequest): Promise<PaymentAttemptResult> {
    void req;
    return { providerReference: `mock_charge_${randomUUID()}`, status: 'succeeded' };
  }

  async initiateRefund(req: RefundRequest): Promise<PaymentAttemptResult> {
    void req;
    return { providerReference: `mock_refund_${randomUUID()}`, status: 'succeeded' };
  }

  async initiatePayout(req: PayoutRequest): Promise<PaymentAttemptResult> {
    void req;
    return { providerReference: `mock_payout_${randomUUID()}`, status: 'succeeded' };
  }

  /**
   * HMAC-SHA256 over the raw request body with a shared secret
   * (PAYMENT_WEBHOOK_SECRET) — the same family of scheme real
   * providers use (Stripe's signed-payload header, Paystack's
   * x-paystack-signature). `timingSafeEqual` avoids leaking the
   * expected signature one byte at a time through response-time
   * differences.
   */
  verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined): boolean {
    if (!signatureHeader) return false;
    const secret = this.config.get('payments', { infer: true }).webhookSecret;
    if (!secret) return false;

    const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
    const expectedBuf = Buffer.from(expected, 'utf8');
    const actualBuf = Buffer.from(signatureHeader, 'utf8');
    if (expectedBuf.length !== actualBuf.length) return false;
    return timingSafeEqual(expectedBuf, actualBuf);
  }

  parseWebhookEvent(rawBody: string): WebhookEvent {
    const parsed = JSON.parse(rawBody) as Partial<WebhookEvent>;
    if (!parsed.tenantId || !parsed.providerReference || !parsed.status) {
      throw new Error('Malformed mock webhook event: tenantId, providerReference and status are all required.');
    }
    return { tenantId: parsed.tenantId, providerReference: parsed.providerReference, status: parsed.status };
  }
}

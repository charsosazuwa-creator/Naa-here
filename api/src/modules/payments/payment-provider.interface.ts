/**
 * Phase 4 (Payments): the boundary a real payment-service-provider
 * integration implements. Everything in booking.service.ts,
 * job.service.ts, finance.service.ts and dispute.service.ts talks to
 * PaymentsService, never to a provider directly — so swapping
 * MockPaymentProvider for a real one (Paystack, Flutterwave, or
 * whichever the launch decision picks) means writing one new class
 * against this interface and changing one binding in
 * payments.module.ts, not touching any of that application code.
 *
 * Deliberately amount + currency + a small set of identifiers, not a
 * card number or bank account: PCI-scope details (card capture,
 * mobile-money PIN entry, etc.) belong to whatever hosted checkout or
 * SDK a real provider gives the front end — the API never sees them.
 */

export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';

export interface ChargeRequest {
  tenantId: string;
  bookingId: string;
  amountMinorUnits: number;
  currencyCode: string;
}

export interface RefundRequest {
  tenantId: string;
  bookingId: string | null;
  amountMinorUnits: number;
  currencyCode: string;
}

export interface PayoutRequest {
  tenantId: string;
  payoutId: string;
  amountMinorUnits: number;
  currencyCode: string;
}

export type PaymentAttemptStatus = 'pending' | 'succeeded' | 'failed';

export interface PaymentAttemptResult {
  /** This provider's own id for the attempt — the key a later webhook event references it by. */
  providerReference: string;
  status: PaymentAttemptStatus;
}

/**
 * What a provider's webhook body decodes to, once verified. `tenantId`
 * travels in the event itself (round-tripped through the provider as
 * metadata attached when the charge/refund/payout was initiated)
 * rather than being looked up from provider_reference first — the same
 * pattern real providers use (Stripe's metadata, Paystack's metadata
 * field), and it means confirming a webhook never needs a
 * cross-tenant, RLS-defeating lookup to find out which tenant it
 * belongs to before `DatabaseService.withTenant()` can even open.
 */
export interface WebhookEvent {
  tenantId: string;
  providerReference: string;
  status: PaymentAttemptStatus;
}

export interface PaymentProvider {
  /** Short identifier stored in payment_intent.provider (e.g. 'mock', 'paystack'). */
  readonly name: string;

  initiateCharge(req: ChargeRequest): Promise<PaymentAttemptResult>;
  initiateRefund(req: RefundRequest): Promise<PaymentAttemptResult>;
  initiatePayout(req: PayoutRequest): Promise<PaymentAttemptResult>;

  /** Verifies a webhook body against this provider's signature scheme. Never trust an unverified body. */
  verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined): boolean;

  /** Only called after verifyWebhookSignature has returned true. */
  parseWebhookEvent(rawBody: string): WebhookEvent;
}

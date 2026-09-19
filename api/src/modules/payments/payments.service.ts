import { Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import { LedgerEntry, recordLedgerEntry } from '../finance/ledger.repository';
import { PAYMENT_PROVIDER, PaymentProvider } from './payment-provider.interface';

export interface ChargeAndRecordInput {
  tenantId: string;
  bookingId: string;
  amountMinorUnits: number;
  currencyCode: string;
  createdBy?: string | null;
}

export interface RefundAndRecordInput {
  tenantId: string;
  bookingId: string | null;
  amountMinorUnits: number;
  currencyCode: string;
  createdBy?: string | null;
}

export interface PayoutAndRecordInput {
  tenantId: string;
  payoutId: string;
  amountMinorUnits: number;
  currencyCode: string;
  createdBy?: string | null;
}

export interface PaymentAttemptOutcome {
  paymentIntentId: string;
  /** Present only when the attempt settled 'succeeded' inside this same call — the mock provider's default. */
  ledgerEntry: LedgerEntry | null;
}

/**
 * The one thing booking.service.ts, job.service.ts, finance.service.ts
 * and dispute.service.ts call to move money — they never call
 * ledger.repository.ts's recordLedgerEntry directly for a
 * charge/refund/payout any more, and never talk to a PaymentProvider
 * directly either. That indirection is the whole point of phase 4
 * being "generic": swapping the mock provider for a real one changes
 * payments.module.ts's DI binding and nothing in those four services.
 *
 * Every method here runs on the caller's own open `client` (the same
 * transaction as the booking/refund/payout being created), so a
 * successful charge and its ledger entry commit or roll back together
 * — exactly the guarantee ledger.repository.ts's callers already
 * relied on before this module existed.
 */
@Injectable()
export class PaymentsService {
  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly db: DatabaseService,
  ) {}

  async chargeAndRecord(client: PoolClient, input: ChargeAndRecordInput): Promise<PaymentAttemptOutcome> {
    const attempt = await this.provider.initiateCharge({
      tenantId: input.tenantId,
      bookingId: input.bookingId,
      amountMinorUnits: input.amountMinorUnits,
      currencyCode: input.currencyCode,
    });
    return this.recordAttempt(client, {
      tenantId: input.tenantId,
      bookingId: input.bookingId,
      payoutId: null,
      kind: 'charge',
      amountMinorUnits: input.amountMinorUnits,
      currencyCode: input.currencyCode,
      createdBy: input.createdBy ?? null,
      attempt,
    });
  }

  async refundAndRecord(client: PoolClient, input: RefundAndRecordInput): Promise<PaymentAttemptOutcome> {
    const attempt = await this.provider.initiateRefund({
      tenantId: input.tenantId,
      bookingId: input.bookingId,
      amountMinorUnits: input.amountMinorUnits,
      currencyCode: input.currencyCode,
    });
    return this.recordAttempt(client, {
      tenantId: input.tenantId,
      bookingId: input.bookingId,
      payoutId: null,
      kind: 'refund',
      amountMinorUnits: input.amountMinorUnits,
      currencyCode: input.currencyCode,
      createdBy: input.createdBy ?? null,
      attempt,
    });
  }

  async payoutAndRecord(client: PoolClient, input: PayoutAndRecordInput): Promise<PaymentAttemptOutcome> {
    const attempt = await this.provider.initiatePayout({
      tenantId: input.tenantId,
      payoutId: input.payoutId,
      amountMinorUnits: input.amountMinorUnits,
      currencyCode: input.currencyCode,
    });
    return this.recordAttempt(client, {
      tenantId: input.tenantId,
      bookingId: null,
      payoutId: input.payoutId,
      kind: 'payout',
      amountMinorUnits: input.amountMinorUnits,
      currencyCode: input.currencyCode,
      createdBy: input.createdBy ?? null,
      attempt,
    });
  }

  /**
   * Verifies and applies one webhook event. Opens its own
   * `withTenant` transaction using the tenantId carried in the event
   * itself (see WebhookEvent's own comment for why that's safe and
   * avoids a cross-tenant lookup), so — unlike the three methods above
   * — this is never called on someone else's already-open client.
   * Idempotent: a payment_intent already settled ('succeeded' or
   * 'failed') is left alone and its current status is returned as-is,
   * since PSPs commonly retry webhook delivery.
   */
  async handleWebhook(rawBody: string, signatureHeader: string | undefined): Promise<{ status: string }> {
    if (!this.provider.verifyWebhookSignature(rawBody, signatureHeader)) {
      throw new UnauthorizedException('Invalid webhook signature.');
    }
    const event = this.provider.parseWebhookEvent(rawBody);

    return this.db.withTenant(event.tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT id, tenant_id, booking_id, payout_id, kind, amount_minor_units, currency_code, status
         FROM payment_intent WHERE provider = $1 AND provider_reference = $2`,
        [this.provider.name, event.providerReference],
      );
      const intent = rows[0];
      if (!intent) {
        throw new NotFoundException('No matching payment intent for this webhook event.');
      }
      if (intent.status !== 'pending') {
        return { status: intent.status as string };
      }

      if (event.status === 'succeeded') {
        const entry = await recordLedgerEntry(client, {
          tenantId: intent.tenant_id,
          bookingId: intent.booking_id,
          type: intent.kind,
          amountMinorUnits: Number(intent.amount_minor_units),
          currencyCode: intent.currency_code,
        });
        await client.query(
          `UPDATE payment_intent SET status = 'succeeded', ledger_entry_id = $2, updated_at = now() WHERE id = $1`,
          [intent.id, entry.id],
        );
        return { status: 'succeeded' };
      }

      await client.query(`UPDATE payment_intent SET status = 'failed', updated_at = now() WHERE id = $1`, [intent.id]);
      return { status: 'failed' };
    });
  }

  private async recordAttempt(
    client: PoolClient,
    input: {
      tenantId: string;
      bookingId: string | null;
      payoutId: string | null;
      kind: 'charge' | 'refund' | 'payout';
      amountMinorUnits: number;
      currencyCode: string;
      createdBy: string | null;
      attempt: { providerReference: string; status: 'pending' | 'succeeded' | 'failed' };
    },
  ): Promise<PaymentAttemptOutcome> {
    let ledgerEntry: LedgerEntry | null = null;
    if (input.attempt.status === 'succeeded') {
      ledgerEntry = await recordLedgerEntry(client, {
        tenantId: input.tenantId,
        bookingId: input.bookingId,
        type: input.kind,
        amountMinorUnits: input.amountMinorUnits,
        currencyCode: input.currencyCode,
        createdBy: input.createdBy,
      });
    }

    const { rows } = await client.query(
      `INSERT INTO payment_intent
         (tenant_id, booking_id, payout_id, kind, provider, provider_reference, amount_minor_units, currency_code, status, ledger_entry_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        input.tenantId,
        input.bookingId,
        input.payoutId,
        input.kind,
        this.provider.name,
        input.attempt.providerReference,
        input.amountMinorUnits,
        input.currencyCode,
        input.attempt.status,
        ledgerEntry?.id ?? null,
        input.createdBy,
      ],
    );

    return { paymentIntentId: rows[0].id as string, ledgerEntry };
  }
}

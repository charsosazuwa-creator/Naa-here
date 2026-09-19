import { PoolClient } from 'pg';

/**
 * The escrow ledger (migration 005). As of migration 006 (Phase 4),
 * application code no longer calls `recordLedgerEntry` directly for a
 * charge, refund or payout — that goes through
 * `payments/payments.service.ts`'s PaymentsService, which calls this
 * only after the payment provider confirms the attempt succeeded
 * (synchronously for the mock provider today, or from
 * PaymentsController's webhook route for a provider that confirms
 * asynchronously). `recordLedgerEntry` remains a plain function, not a
 * service, so both call sites (PaymentsService's own methods, and its
 * webhook handler) can run it inside whichever transaction they
 * already opened — a booking/refund/payout and its ledger entry commit
 * or roll back together either way.
 *
 * Every entry's fee_minor_units is always 0 (the database CHECK
 * constraint enforces this too): commission/fee features exist in the
 * schema per the design's approved decision, but stay dormant until
 * turned on by a real launch decision — Phase 4's mock provider
 * doesn't turn them on, it only adds the provider-facing boundary a
 * real one will plug into (see payment-provider.interface.ts).
 */

export interface RecordLedgerEntryInput {
  tenantId: string;
  bookingId?: string | null;
  type: 'charge' | 'refund' | 'payout' | 'adjustment';
  amountMinorUnits: number;
  currencyCode: string;
  createdBy?: string | null;
  heldForDisputeId?: string | null;
}

export interface LedgerEntry {
  id: string;
  tenantId: string;
  bookingId: string | null;
  type: RecordLedgerEntryInput['type'];
  amountMinorUnits: number;
  currencyCode: string;
  feeMinorUnits: number;
  heldForDisputeId: string | null;
  createdAt: string;
}

/**
 * Records one ledger entry and keeps `escrow_account.balance_minor_units`
 * in sync: a charge or a payout-reversal increases the tenant's held
 * balance (money coming in), a refund or payout decreases it (money
 * going out). Both writes happen in the same statement batch on the
 * caller's client, so they succeed or fail together.
 */
export async function recordLedgerEntry(client: PoolClient, input: RecordLedgerEntryInput): Promise<LedgerEntry> {
  const { rows } = await client.query(
    `INSERT INTO ledger_entry (tenant_id, booking_id, type, amount_minor_units, currency_code, created_by, held_for_dispute_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, tenant_id, booking_id, type, amount_minor_units, currency_code, fee_minor_units, held_for_dispute_id, created_at`,
    [
      input.tenantId,
      input.bookingId ?? null,
      input.type,
      input.amountMinorUnits,
      input.currencyCode,
      input.createdBy ?? null,
      input.heldForDisputeId ?? null,
    ],
  );

  const delta = input.type === 'charge' ? input.amountMinorUnits : -input.amountMinorUnits;
  await client.query(
    `INSERT INTO escrow_account (tenant_id, balance_minor_units, currency_code)
     VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id) DO UPDATE
       SET balance_minor_units = escrow_account.balance_minor_units + $2, updated_at = now()`,
    [input.tenantId, delta, input.currencyCode],
  );

  return toLedgerEntry(rows[0]);
}

export async function getEscrowBalance(
  client: PoolClient,
  tenantId: string,
): Promise<{ balanceMinorUnits: number; currencyCode: string } | null> {
  const { rows } = await client.query(`SELECT balance_minor_units, currency_code FROM escrow_account WHERE tenant_id = $1`, [
    tenantId,
  ]);
  if (rows.length === 0) return null;
  return { balanceMinorUnits: Number(rows[0].balance_minor_units), currencyCode: rows[0].currency_code as string };
}

export function toLedgerEntry(row: Record<string, unknown>): LedgerEntry {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    bookingId: (row.booking_id as string) ?? null,
    type: row.type as LedgerEntry['type'],
    amountMinorUnits: Number(row.amount_minor_units),
    currencyCode: row.currency_code as string,
    feeMinorUnits: Number(row.fee_minor_units ?? 0),
    heldForDisputeId: (row.held_for_dispute_id as string) ?? null,
    createdAt: row.created_at as string,
  };
}

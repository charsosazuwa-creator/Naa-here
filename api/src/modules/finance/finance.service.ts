import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { IssueRefundDto, RequestPayoutDto } from './dto/finance.dto';

export interface Payout {
  id: string;
  tenantId: string;
  amountMinorUnits: number;
  currencyCode: string;
  status: 'requested' | 'paid' | 'rejected';
  requestedBy: string;
  decisionNotes: string | null;
}

export interface ReconciliationReport {
  tenantId: string;
  totalChargedMinorUnits: number;
  totalRefundedMinorUnits: number;
  totalPaidOutMinorUnits: number;
  expectedBalanceMinorUnits: number;
  escrowBalanceMinorUnits: number;
  currencyCode: string | null;
  reconciled: boolean;
}

/**
 * Reconciliation, refund and payout management (design section 11,
 * phase 5). Built against the dormant escrow ledger from migration 005
 * (see that migration's header, and ledger.repository.ts, for why this
 * exists ahead of a real phase-4 payment integration).
 *
 * A tenant assumes a single currency in this milestone (one per the
 * country it's registered in — see country_config), so balances are
 * summed without a currency breakdown; a tenant that somehow mixed
 * currencies would get a misleading total, which is an acceptable gap
 * for a dormant ledger with no real multi-currency settlement yet.
 */
@Injectable()
export class FinanceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly payments: PaymentsService,
  ) {}

  async requestPayout(tenantId: string, requestedBy: string, dto: RequestPayoutDto): Promise<Payout> {
    return this.db.withTenant(tenantId, async (client) => {
      const balance = await ledgerBalance(client, tenantId);
      const { rows: pendingRows } = await client.query(
        `SELECT COALESCE(SUM(amount_minor_units), 0) AS pending FROM payout WHERE tenant_id = $1 AND status = 'requested'`,
        [tenantId],
      );
      const available = balance.amount - Number(pendingRows[0]?.pending ?? 0);

      if (dto.amountMinorUnits > available) {
        throw new BadRequestException(`Requested amount exceeds the available escrow balance (${available} minor units available).`);
      }

      const { rows } = await client.query(
        `INSERT INTO payout (tenant_id, amount_minor_units, currency_code, requested_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id, tenant_id, amount_minor_units, currency_code, status, requested_by, decision_notes`,
        [tenantId, dto.amountMinorUnits, dto.currencyCode, requestedBy],
      );

      await this.audit.record({
        tenantId,
        actorUserId: requestedBy,
        action: 'payout.request',
        targetType: 'payout',
        targetId: rows[0].id,
      }, client);

      return toPayout(rows[0]);
    });
  }

  /** Platform-level (finance_administrator) — see PlatformPermissionGuard. */
  async decidePayout(
    tenantId: string,
    payoutId: string,
    decidedBy: string,
    decision: 'paid' | 'rejected',
    notes: string | undefined,
  ): Promise<Payout> {
    return this.db.withTenant(tenantId, async (client) => {
      const { rows: existingRows } = await client.query(
        `SELECT id, amount_minor_units, currency_code, status FROM payout WHERE id = $1 AND tenant_id = $2`,
        [payoutId, tenantId],
      );
      if (existingRows.length === 0) {
        throw new NotFoundException('Payout request not found.');
      }
      if (existingRows[0].status !== 'requested') {
        throw new BadRequestException(`This payout is already '${existingRows[0].status}'.`);
      }

      if (decision === 'paid') {
        // Recomputed at decide time, not trusted from request time — the
        // balance may have moved (a refund, a dispute hold) since the
        // provider asked.
        const balance = await ledgerBalance(client, tenantId);
        if (Number(existingRows[0].amount_minor_units) > balance.amount) {
          throw new BadRequestException(
            `Approving this payout would exceed the current escrow balance (${balance.amount} minor units available).`,
          );
        }
        await this.payments.payoutAndRecord(client, {
          tenantId,
          payoutId,
          amountMinorUnits: Number(existingRows[0].amount_minor_units),
          currencyCode: existingRows[0].currency_code,
          createdBy: decidedBy,
        });
      }

      const { rows } = await client.query(
        `UPDATE payout SET status = $3, decided_by = $4, decision_notes = $5, decided_at = now()
         WHERE id = $1 AND tenant_id = $2
         RETURNING id, tenant_id, amount_minor_units, currency_code, status, requested_by, decision_notes`,
        [payoutId, tenantId, decision, decidedBy, notes ?? null],
      );

      await this.audit.record({
        tenantId,
        actorUserId: decidedBy,
        action: 'payout.decide',
        targetType: 'payout',
        targetId: payoutId,
        metadata: { decision, notes },
      }, client);

      return toPayout(rows[0]);
    });
  }

  /** Platform-level (finance_administrator): a direct refund, independent of a dispute. */
  async issueRefund(tenantId: string, bookingId: string, decidedBy: string, dto: IssueRefundDto): Promise<{ id: string }> {
    return this.db.withTenant(tenantId, async (client) => {
      const { rows: bookingRows } = await client.query(`SELECT id FROM booking WHERE id = $1 AND tenant_id = $2`, [
        bookingId,
        tenantId,
      ]);
      if (bookingRows.length === 0) {
        throw new NotFoundException('Booking not found.');
      }

      const outcome = await this.payments.refundAndRecord(client, {
        tenantId,
        bookingId,
        amountMinorUnits: dto.amountMinorUnits,
        currencyCode: dto.currencyCode,
        createdBy: decidedBy,
      });
      // The mock provider always settles synchronously (see
      // mock-payment.provider.ts), so ledgerEntry is always present
      // here in practice; a real, asynchronous provider would leave it
      // null until /v1/payments/webhook confirms the refund later.
      const targetId = outcome.ledgerEntry?.id ?? outcome.paymentIntentId;

      await this.audit.record({
        tenantId,
        actorUserId: decidedBy,
        action: 'refund.issue',
        targetType: outcome.ledgerEntry ? 'ledger_entry' : 'payment_intent',
        targetId,
        metadata: { bookingId, amountMinorUnits: dto.amountMinorUnits, reason: dto.reason },
      }, client);

      return { id: targetId };
    });
  }

  /** A tenant's own payout history — what the provider portal shows, as opposed to reconciliationReport()'s platform-level ledger view. */
  async listForTenant(tenantId: string): Promise<Payout[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT id, tenant_id, amount_minor_units, currency_code, status, requested_by, decision_notes
         FROM payout WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [tenantId],
      );
      return rows.map(toPayout);
    });
  }

  /** Platform-level (administrator or finance_administrator, both carry report.view). */
  async reconciliationReport(tenantId: string): Promise<ReconciliationReport> {
    return this.db.withTenant(tenantId, async (client) => {
      const { rows: totals } = await client.query(
        `SELECT
           currency_code,
           COALESCE(SUM(CASE WHEN type = 'charge' THEN amount_minor_units ELSE 0 END), 0) AS total_charged,
           COALESCE(SUM(CASE WHEN type = 'refund' THEN amount_minor_units ELSE 0 END), 0) AS total_refunded,
           COALESCE(SUM(CASE WHEN type = 'payout' THEN amount_minor_units ELSE 0 END), 0) AS total_paid_out
         FROM ledger_entry
         WHERE tenant_id = $1
         GROUP BY currency_code`,
        [tenantId],
      );

      const { rows: escrowRows } = await client.query(
        `SELECT balance_minor_units, currency_code FROM escrow_account WHERE tenant_id = $1`,
        [tenantId],
      );

      const totalCharged = Number(totals[0]?.total_charged ?? 0);
      const totalRefunded = Number(totals[0]?.total_refunded ?? 0);
      const totalPaidOut = Number(totals[0]?.total_paid_out ?? 0);
      const expectedBalance = totalCharged - totalRefunded - totalPaidOut;
      const escrowBalance = Number(escrowRows[0]?.balance_minor_units ?? 0);

      return {
        tenantId,
        totalChargedMinorUnits: totalCharged,
        totalRefundedMinorUnits: totalRefunded,
        totalPaidOutMinorUnits: totalPaidOut,
        expectedBalanceMinorUnits: expectedBalance,
        escrowBalanceMinorUnits: escrowBalance,
        currencyCode: (totals[0]?.currency_code as string) ?? (escrowRows[0]?.currency_code as string) ?? null,
        reconciled: expectedBalance === escrowBalance,
      };
    });
  }
}

/**
 * The tenant's spendable balance computed straight from ledger history
 * (charges not currently held for a dispute, minus refunds, minus
 * payouts already made) — independent of escrow_account's incrementally
 * maintained running total, which is exactly why reconciliationReport()
 * above compares the two instead of trusting either one alone.
 */
async function ledgerBalance(client: PoolClient, tenantId: string): Promise<{ amount: number; currencyCode: string | null }> {
  const { rows } = await client.query(
    `SELECT
       currency_code,
       COALESCE(SUM(CASE WHEN type = 'charge' AND held_for_dispute_id IS NULL THEN amount_minor_units ELSE 0 END), 0)
         - COALESCE(SUM(CASE WHEN type = 'refund' THEN amount_minor_units ELSE 0 END), 0)
         - COALESCE(SUM(CASE WHEN type = 'payout' THEN amount_minor_units ELSE 0 END), 0) AS balance
     FROM ledger_entry
     WHERE tenant_id = $1
     GROUP BY currency_code`,
    [tenantId],
  );
  return rows[0] ? { amount: Number(rows[0].balance), currencyCode: rows[0].currency_code as string } : { amount: 0, currencyCode: null };
}

function toPayout(row: Record<string, unknown>): Payout {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    amountMinorUnits: Number(row.amount_minor_units),
    currencyCode: row.currency_code as string,
    status: row.status as Payout['status'],
    requestedBy: row.requested_by as string,
    decisionNotes: (row.decision_notes as string) ?? null,
  };
}

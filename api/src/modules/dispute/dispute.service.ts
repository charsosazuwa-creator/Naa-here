import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';

export interface Dispute {
  id: string;
  tenantId: string;
  bookingId: string;
  raisedBy: string;
  reason: string;
  status: 'open' | 'resolved_customer' | 'resolved_provider' | 'dismissed';
  resolutionNotes: string | null;
}

/**
 * Complaints and disputes (design section 11, phase 5). Either party to
 * a booking can raise one; a platform administrator resolves it. The
 * "dispute holds" test requirement in the phase table is implemented
 * literally: raising a dispute marks that booking's charge ledger
 * entry with held_for_dispute_id (migration 005), which
 * finance.service.ts's payout-eligible-balance calculation excludes —
 * a provider cannot be paid out for a booking under active dispute.
 * Resolving in the customer's favor automatically records a refund for
 * the held amount; resolving in the provider's favor or dismissing
 * just releases the hold, since nothing was ever moved.
 */
@Injectable()
export class DisputeService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly payments: PaymentsService,
  ) {}

  async raise(tenantId: string, bookingId: string, raisedBy: string, reason: string): Promise<Dispute> {
    return this.db.withTenant(tenantId, async (client) => {
      const { rows: bookingRows } = await client.query(`SELECT id, customer_id FROM booking WHERE id = $1 AND tenant_id = $2`, [
        bookingId,
        tenantId,
      ]);
      if (bookingRows.length === 0) {
        throw new NotFoundException('Booking not found.');
      }

      const { rows: customerRows } = await client.query(`SELECT linked_user_id FROM customer_profile WHERE id = $1`, [
        bookingRows[0].customer_id,
      ]);
      const isCustomer = customerRows[0]?.linked_user_id === raisedBy;

      const { rows: memberRows } = await client.query(
        `SELECT 1 FROM membership WHERE tenant_id = $1 AND user_id = $2 AND status = 'active'`,
        [tenantId, raisedBy],
      );
      const isMember = memberRows.length > 0;

      if (!isCustomer && !isMember) {
        throw new ForbiddenException('Only the customer or the business can raise a dispute on this booking.');
      }

      const { rows } = await client.query(
        `INSERT INTO dispute (tenant_id, booking_id, raised_by, reason)
         VALUES ($1, $2, $3, $4)
         RETURNING id, tenant_id, booking_id, raised_by, reason, status, resolution_notes`,
        [tenantId, bookingId, raisedBy, reason],
      );

      // Place the hold: the booking's charge entry can no longer count
      // toward a payout while this dispute is open.
      await client.query(
        `UPDATE ledger_entry SET held_for_dispute_id = $1
         WHERE booking_id = $2 AND type = 'charge' AND held_for_dispute_id IS NULL`,
        [rows[0].id, bookingId],
      );

      await this.audit.record({
        tenantId,
        actorUserId: raisedBy,
        action: 'dispute.raise',
        targetType: 'dispute',
        targetId: rows[0].id,
      }, client);

      return toDispute(rows[0]);
    });
  }

  async resolve(
    tenantId: string,
    disputeId: string,
    decidedBy: string,
    resolution: 'resolved_customer' | 'resolved_provider' | 'dismissed',
    notes: string | undefined,
  ): Promise<Dispute> {
    return this.db.withTenant(tenantId, async (client) => {
      const { rows: existingRows } = await client.query(
        `SELECT id, booking_id, status FROM dispute WHERE id = $1 AND tenant_id = $2`,
        [disputeId, tenantId],
      );
      if (existingRows.length === 0) {
        throw new NotFoundException('Dispute not found.');
      }
      if (existingRows[0].status !== 'open') {
        throw new BadRequestException(`This dispute is already '${existingRows[0].status}'.`);
      }

      const { rows: heldEntries } = await client.query(
        `SELECT id, amount_minor_units, currency_code FROM ledger_entry WHERE held_for_dispute_id = $1`,
        [disputeId],
      );

      if (resolution === 'resolved_customer') {
        for (const entry of heldEntries) {
          await this.payments.refundAndRecord(client, {
            tenantId,
            bookingId: existingRows[0].booking_id,
            amountMinorUnits: Number(entry.amount_minor_units),
            currencyCode: entry.currency_code,
            createdBy: decidedBy,
          });
        }
      }

      // The hold is released either way: 'resolved_provider' and
      // 'dismissed' mean nothing gets refunded, so the entry rejoins
      // the ordinary payout-eligible balance.
      await client.query(`UPDATE ledger_entry SET held_for_dispute_id = NULL WHERE held_for_dispute_id = $1`, [disputeId]);

      const { rows } = await client.query(
        `UPDATE dispute SET status = $3, resolution_notes = $4, resolved_by = $5, resolved_at = now()
         WHERE id = $1 AND tenant_id = $2
         RETURNING id, tenant_id, booking_id, raised_by, reason, status, resolution_notes`,
        [disputeId, tenantId, resolution, notes ?? null, decidedBy],
      );

      await this.audit.record({
        tenantId,
        actorUserId: decidedBy,
        action: 'dispute.resolve',
        targetType: 'dispute',
        targetId: disputeId,
        metadata: { resolution, notes, refundedEntries: resolution === 'resolved_customer' ? heldEntries.length : 0 },
      }, client);

      return toDispute(rows[0]);
    });
  }

  async listForTenant(tenantId: string): Promise<Dispute[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT id, tenant_id, booking_id, raised_by, reason, status, resolution_notes
         FROM dispute WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [tenantId],
      );
      return rows.map(toDispute);
    });
  }
}

function toDispute(row: Record<string, unknown>): Dispute {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    bookingId: row.booking_id as string,
    raisedBy: row.raised_by as string,
    reason: row.reason as string,
    status: row.status as Dispute['status'],
    resolutionNotes: (row.resolution_notes as string) ?? null,
  };
}

import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { EMAIL_PROVIDER, EmailProvider } from '../notifications/email-provider.interface';
import { DisputeAttachmentService, DisputeAttachmentRow, UploadedDisputeFile } from './dispute-attachment.service';

export interface DisputeAttachment {
  id: string;
  url: string;
  contentType: string;
  byteSize: number;
  uploadedBy: string;
  createdAt: string;
}

export interface Dispute {
  id: string;
  caseNumber: string;
  tenantId: string;
  bookingId: string;
  raisedBy: string;
  reason: string;
  details: string | null;
  status: 'open' | 'resolved_customer' | 'resolved_provider' | 'dismissed';
  resolutionNotes: string | null;
  createdAt: string;
  resolvedAt: string | null;
  attachments: DisputeAttachment[];
}

/**
 * Complaints and disputes (US-056). Either party to a booking can
 * raise one; a platform administrator/support staff resolves it. The
 * "dispute holds" logic (raising marks the booking's charge ledger
 * entry with held_for_dispute_id, which finance.service.ts's payout
 * calculation excludes) is unchanged from the original build (design
 * section 11, phase 5) — this pass adds the rest of US-056's
 * acceptance criteria on top: a generated case reference, an optional
 * details field alongside the reason, evidence attachments, and a
 * best-effort email update to both parties when the case is raised
 * and when it's resolved.
 */
@Injectable()
export class DisputeService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly payments: PaymentsService,
    private readonly attachments: DisputeAttachmentService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {}

  async raise(tenantId: string, bookingId: string, raisedBy: string, reason: string, details: string | undefined): Promise<Dispute> {
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

      const { rows: inserted } = await client.query(`INSERT INTO dispute (tenant_id, booking_id, raised_by, reason, details) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [
        tenantId,
        bookingId,
        raisedBy,
        reason,
        details ?? null,
      ]);
      const disputeId = inserted[0].id as string;
      // AC "the system must generate a case reference" — short and
      // stable, derived from the row's own id rather than a separate
      // sequence, so there's nothing else that can drift out of sync.
      const caseNumber = `DSP-${disputeId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

      const { rows } = await client.query(
        `UPDATE dispute SET case_number = $2 WHERE id = $1
         RETURNING id, case_number, tenant_id, booking_id, raised_by, reason, details, status, resolution_notes, created_at, resolved_at`,
        [disputeId, caseNumber],
      );

      // Place the hold: the booking's charge entry can no longer count
      // toward a payout while this dispute is open.
      await client.query(
        `UPDATE ledger_entry SET held_for_dispute_id = $1
         WHERE booking_id = $2 AND type = 'charge' AND held_for_dispute_id IS NULL`,
        [disputeId, bookingId],
      );

      await this.audit.record({
        tenantId,
        actorUserId: raisedBy,
        action: 'dispute.raise',
        targetType: 'dispute',
        targetId: disputeId,
      }, client);

      await this.notifyRaised(client, tenantId, bookingId, raisedBy, isMember, caseNumber);

      return toDispute(rows[0], []);
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
        `SELECT id, booking_id, raised_by, status FROM dispute WHERE id = $1 AND tenant_id = $2`,
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
         RETURNING id, case_number, tenant_id, booking_id, raised_by, reason, details, status, resolution_notes, created_at, resolved_at`,
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

      const attachments = await this.attachments.listFor(client, disputeId);
      await this.notifyResolved(client, tenantId, existingRows[0].booking_id, existingRows[0].raised_by, rows[0].case_number, resolution, notes);

      return toDispute(rows[0], attachments);
    });
  }

  async listForTenant(tenantId: string): Promise<Dispute[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT id, case_number, tenant_id, booking_id, raised_by, reason, details, status, resolution_notes, created_at, resolved_at
         FROM dispute WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [tenantId],
      );
      if (rows.length === 0) {
        return [];
      }
      const attachments = await client.query(
        `SELECT da.id, da.dispute_id, da.storage_key, da.content_type, da.byte_size, da.uploaded_by, da.created_at
         FROM dispute_attachment da WHERE da.dispute_id = ANY($1::uuid[]) ORDER BY da.created_at ASC`,
        [rows.map((r) => r.id)],
      );
      return rows.map((row) =>
        toDispute(
          row,
          attachments.rows.filter((a) => a.dispute_id === row.id),
        ),
      );
    });
  }

  /** Any signed-in user's own disputes — as raiser, or as the customer on the booking a dispute is about (see migration 014's extra RLS policy). */
  async listMine(userId: string): Promise<Dispute[]> {
    return this.db.withUser(userId, async (client) => {
      const { rows } = await client.query(
        `SELECT id, case_number, tenant_id, booking_id, raised_by, reason, details, status, resolution_notes, created_at, resolved_at
         FROM dispute ORDER BY created_at DESC`,
      );
      if (rows.length === 0) {
        return [];
      }
      const attachments = await client.query(
        `SELECT da.id, da.dispute_id, da.storage_key, da.content_type, da.byte_size, da.uploaded_by, da.created_at
         FROM dispute_attachment da WHERE da.dispute_id = ANY($1::uuid[]) ORDER BY da.created_at ASC`,
        [rows.map((r) => r.id)],
      );
      return rows.map((row) =>
        toDispute(
          row,
          attachments.rows.filter((a) => a.dispute_id === row.id),
        ),
      );
    });
  }

  /** Platform queue (support_agent/administrator/finance_administrator — anyone holding dispute.view; see migration 014's platform-staff RLS policy). */
  async listForAdmin(adminUserId: string): Promise<(Dispute & { tenantName: string; raisedByName: string })[]> {
    return this.db.withUser(adminUserId, async (client) => {
      const { rows } = await client.query(
        `SELECT d.id, d.case_number, d.tenant_id, d.booking_id, d.raised_by, d.reason, d.details, d.status, d.resolution_notes,
                d.created_at, d.resolved_at, t.name AS tenant_name, u.full_name AS raised_by_name
         FROM dispute d
         JOIN tenant t ON t.id = d.tenant_id
         JOIN app_user u ON u.id = d.raised_by
         ORDER BY (d.status = 'open') DESC, d.created_at ASC`,
      );
      if (rows.length === 0) {
        return [];
      }
      const attachments = await client.query(
        `SELECT da.id, da.dispute_id, da.storage_key, da.content_type, da.byte_size, da.uploaded_by, da.created_at
         FROM dispute_attachment da WHERE da.dispute_id = ANY($1::uuid[]) ORDER BY da.created_at ASC`,
        [rows.map((r) => r.id)],
      );
      return rows.map((row) => ({
        ...toDispute(
          row,
          attachments.rows.filter((a) => a.dispute_id === row.id),
        ),
        tenantName: row.tenant_name as string,
        raisedByName: row.raised_by_name as string,
      }));
    });
  }

  async addAttachment(tenantId: string, disputeId: string, userId: string, file: UploadedDisputeFile | undefined): Promise<DisputeAttachment> {
    return this.db.withTenant(tenantId, async (client) => {
      await this.assertParty(client, tenantId, disputeId, userId);
      const row = await this.attachments.add(client, userId, disputeId, file);
      return toAttachment(row);
    });
  }

  async removeAttachment(tenantId: string, disputeId: string, userId: string, attachmentId: string): Promise<void> {
    return this.db.withTenant(tenantId, async (client) => {
      await this.assertParty(client, tenantId, disputeId, userId);
      await this.attachments.remove(client, userId, disputeId, attachmentId);
    });
  }

  /** Raiser, an active member of the owning tenant, or platform staff with dispute.view. */
  private async assertParty(client: PoolClient, tenantId: string, disputeId: string, userId: string): Promise<void> {
    const { rows } = await client.query(`SELECT raised_by, status FROM dispute WHERE id = $1 AND tenant_id = $2`, [disputeId, tenantId]);
    if (rows.length === 0) {
      throw new NotFoundException('Dispute not found.');
    }
    if (rows[0].status !== 'open') {
      throw new BadRequestException('Attachments can only be added to an open dispute.');
    }
    if (rows[0].raised_by === userId) {
      return;
    }
    const { rows: memberRows } = await client.query(
      `SELECT 1 FROM membership WHERE tenant_id = $1 AND user_id = $2 AND status = 'active'`,
      [tenantId, userId],
    );
    if (memberRows.length > 0) {
      return;
    }
    const { rows: staffRows } = await client.query(
      `SELECT 1 FROM platform_role_assignment pra
       JOIN role_permission rp ON rp.role_id = pra.role_id
       JOIN permission p ON p.id = rp.permission_id
       WHERE pra.user_id = $1 AND p.code = 'dispute.view'`,
      [userId],
    );
    if (staffRows.length > 0) {
      return;
    }
    throw new ForbiddenException("You're not a party to this dispute.");
  }

  // -- Notifications (best-effort — never fail the underlying action) ----

  private async notifyRaised(
    client: PoolClient,
    tenantId: string,
    bookingId: string,
    raisedBy: string,
    raiserIsBusinessMember: boolean,
    caseNumber: string,
  ): Promise<void> {
    const { raiserEmail, otherPartyEmail } = await this.partyEmails(client, tenantId, bookingId, raisedBy, raiserIsBusinessMember);
    await this.sendEmail(
      raiserEmail,
      `Case ${caseNumber} — we've received your report`,
      `Thanks for letting us know. Your case reference is ${caseNumber}. We'll update you here once it's reviewed.`,
    );
    await this.sendEmail(
      otherPartyEmail,
      `Case ${caseNumber} — a complaint was raised about a booking`,
      `A complaint was raised about a recent booking (case reference ${caseNumber}). Our support team will review it and be in touch if anything is needed from you.`,
    );
  }

  private async notifyResolved(
    client: PoolClient,
    tenantId: string,
    bookingId: string,
    raisedBy: string,
    caseNumber: string,
    resolution: 'resolved_customer' | 'resolved_provider' | 'dismissed',
    notes: string | undefined,
  ): Promise<void> {
    const { rows: memberRows } = await client.query(
      `SELECT 1 FROM membership WHERE tenant_id = $1 AND user_id = $2 AND status = 'active'`,
      [tenantId, raisedBy],
    );
    const raiserIsBusinessMember = memberRows.length > 0;
    const { raiserEmail, otherPartyEmail } = await this.partyEmails(client, tenantId, bookingId, raisedBy, raiserIsBusinessMember);

    const summary: Record<typeof resolution, string> = {
      resolved_customer: 'resolved in the customer’s favor (a refund has been issued for the held amount)',
      resolved_provider: 'resolved in the provider’s favor',
      dismissed: 'dismissed',
    };
    const body = `Case ${caseNumber} has been ${summary[resolution]}.${notes ? `\n\nNote from support: ${notes}` : ''}`;

    await this.sendEmail(raiserEmail, `Case ${caseNumber} — resolved`, body);
    await this.sendEmail(otherPartyEmail, `Case ${caseNumber} — resolved`, body);
  }

  private async partyEmails(
    client: PoolClient,
    tenantId: string,
    bookingId: string,
    raisedBy: string,
    raiserIsBusinessMember: boolean,
  ): Promise<{ raiserEmail: string | null; otherPartyEmail: string | null }> {
    const { rows: raiserRows } = await client.query(`SELECT email FROM app_user WHERE id = $1`, [raisedBy]);
    const raiserEmail: string | null = (raiserRows[0]?.email as string | undefined) ?? null;

    const { rows: bookingRows } = await client.query(
      `SELECT cp.email AS customer_email, u.email AS linked_user_email
       FROM booking b
       JOIN customer_profile cp ON cp.id = b.customer_id
       LEFT JOIN app_user u ON u.id = cp.linked_user_id
       WHERE b.id = $1`,
      [bookingId],
    );
    const customerEmail: string | null =
      (bookingRows[0]?.linked_user_email as string | undefined) ?? (bookingRows[0]?.customer_email as string | undefined) ?? null;

    const { rows: ownerRows } = await client.query(
      `SELECT u.email FROM membership m
       JOIN app_user u ON u.id = m.user_id
       JOIN role r ON r.id = m.role_id
       WHERE m.tenant_id = $1 AND r.code = 'owner' AND m.status = 'active'
       LIMIT 1`,
      [tenantId],
    );
    const businessEmail: string | null = (ownerRows[0]?.email as string | undefined) ?? null;

    return {
      raiserEmail,
      otherPartyEmail: raiserIsBusinessMember ? customerEmail : businessEmail,
    };
  }

  private async sendEmail(to: string | null, subject: string, text: string): Promise<void> {
    if (!to) {
      return;
    }
    try {
      await this.emailProvider.send({ to, subject, text });
    } catch {
      // Best-effort (AC "both parties must receive relevant status
      // updates" — but a notification failure must never undo or block
      // the underlying dispute action, same as every other email send
      // in this app).
    }
  }
}

function toAttachment(row: DisputeAttachmentRow): DisputeAttachment {
  return {
    id: row.id,
    url: `/uploads/${row.storage_key}`,
    contentType: row.content_type,
    byteSize: row.byte_size,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
  };
}

function toDispute(row: Record<string, unknown>, attachmentRows: DisputeAttachmentRow[]): Dispute {
  return {
    id: row.id as string,
    caseNumber: row.case_number as string,
    tenantId: row.tenant_id as string,
    bookingId: row.booking_id as string,
    raisedBy: row.raised_by as string,
    reason: row.reason as string,
    details: (row.details as string) ?? null,
    status: row.status as Dispute['status'],
    resolutionNotes: (row.resolution_notes as string) ?? null,
    createdAt: row.created_at as string,
    resolvedAt: (row.resolved_at as string) ?? null,
    attachments: attachmentRows.map((a) =>
      toAttachment({
        id: a.id as string,
        storage_key: a.storage_key as string,
        content_type: a.content_type as string,
        byte_size: a.byte_size as number,
        uploaded_by: a.uploaded_by as string,
        created_at: a.created_at as string,
      }),
    ),
  };
}

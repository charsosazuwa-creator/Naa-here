import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { assertValidTransition, BookingStatus } from './booking-state';
import { CreateBookingDto } from './dto/create-booking.dto';

export interface Booking {
  id: string;
  tenantId: string;
  serviceId: string;
  customerId: string;
  staffUserId: string | null;
  status: BookingStatus;
  startsAt: string;
  endsAt: string;
  notes: string | null;
  cancellationReason: string | null;
  policySnapshot: Record<string, unknown>;
}

const POSTGRES_EXCLUSION_VIOLATION = '23P01';

/**
 * Appointment and accommodation bookings. Double-booking prevention is
 * NOT re-implemented here as a check-then-insert (which would race
 * under concurrent requests) — it is delegated entirely to the
 * `booking` table's EXCLUDE constraint (migration 004), and this
 * service's job is only to translate that constraint's violation into
 * a normal 409 response.
 */
@Injectable()
export class BookingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly payments: PaymentsService,
  ) {}

  /**
   * Any signed-in user may book a published service — this route is
   * deliberately NOT behind TenantRoleGuard, since a customer is not a
   * member of the provider's tenant. It still runs inside
   * withTenant(tenantId, ...) so the write itself is correctly scoped
   * and RLS-visible to the provider afterwards.
   */
  async create(tenantId: string, customerUserId: string, dto: CreateBookingDto): Promise<Booking> {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (!(startsAt.getTime() < endsAt.getTime())) {
      throw new BadRequestException('startsAt must be before endsAt.');
    }

    try {
      return await this.db.withTenant(tenantId, async (client) => {
        const { rows: serviceRows } = await client.query(
          `SELECT id, status, moderation_status, price_minor_units, currency_code FROM service WHERE id = $1 AND tenant_id = $2`,
          [dto.serviceId, tenantId],
        );
        const service = serviceRows[0];
        if (!service) {
          throw new NotFoundException('Service not found.');
        }
        if (service.status !== 'published') {
          throw new BadRequestException('This service is not currently bookable.');
        }
        if (service.moderation_status !== 'active') {
          // A platform administrator suspended this listing (migration
          // 005) — kept as a hard rejection distinct from "not
          // published" so a provider sees a different reason for one
          // than the other, even though both reach the same 400 today.
          throw new BadRequestException('This listing has been suspended and is not currently bookable.');
        }

        if (dto.staffUserId) {
          const { rows: staffRows } = await client.query(
            `SELECT 1 FROM membership WHERE tenant_id = $1 AND user_id = $2 AND status = 'active'`,
            [tenantId, dto.staffUserId],
          );
          if (staffRows.length === 0) {
            throw new BadRequestException('staffUserId is not an active member of this business.');
          }
        }

        // A customer_profile row represents this person from the
        // provider's side of the CRM; find-or-create one linked to
        // their account so the same person always maps to the same
        // CRM record for a given tenant.
        const { rows: existingCustomer } = await client.query(
          `SELECT id FROM customer_profile WHERE tenant_id = $1 AND linked_user_id = $2`,
          [tenantId, customerUserId],
        );
        let customerId: string;
        if (existingCustomer.length > 0) {
          customerId = existingCustomer[0].id;
        } else {
          const { rows: userRows } = await client.query(`SELECT full_name, email, phone FROM app_user WHERE id = $1`, [
            customerUserId,
          ]);
          const user = userRows[0];
          const { rows: createdCustomer } = await client.query(
            `INSERT INTO customer_profile (tenant_id, linked_user_id, full_name, phone, email, created_by)
             VALUES ($1, $2, $3, $4, $5, $2)
             RETURNING id`,
            [tenantId, customerUserId, user?.full_name ?? 'Customer', user?.phone ?? null, user?.email ?? null],
          );
          customerId = createdCustomer[0].id;
        }

        const { rows: tenantRows } = await client.query(`SELECT verification_status FROM tenant WHERE id = $1`, [
          tenantId,
        ]);
        // A published service already implies a verified tenant (the
        // database trigger in migration 002 enforces this at publish
        // time), but this stays as a clear, intentional second check
        // rather than relying solely on that earlier gate.
        if (tenantRows[0]?.verification_status !== 'verified') {
          throw new BadRequestException('This business is not verified and cannot take bookings.');
        }

        const { rows } = await client.query(
          `INSERT INTO booking (tenant_id, service_id, customer_id, created_by, staff_user_id, starts_at, ends_at, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, tenant_id, service_id, customer_id, staff_user_id, status, starts_at, ends_at, notes, cancellation_reason, policy_snapshot`,
          [tenantId, dto.serviceId, customerId, customerUserId, dto.staffUserId ?? null, startsAt.toISOString(), endsAt.toISOString(), dto.notes ?? null],
        );

        await this.audit.record({
          tenantId,
          actorUserId: customerUserId,
          action: 'booking.create',
          targetType: 'booking',
          targetId: rows[0].id,
        }, client);

        // Phase 4: goes through the payment provider (mock, pending a
        // real PSP integration — see payments.module.ts) rather than
        // writing the ledger entry directly. In the same transaction
        // as the booking itself, so the two can never disagree. A
        // zero-priced service (common for artisan listings quoted per
        // job — see job.service.ts's accept(), which charges the
        // quotation's amount instead) has nothing to charge, so no
        // attempt is made; ledger_entry.amount_minor_units must be
        // positive.
        if (service.price_minor_units > 0) {
          await this.payments.chargeAndRecord(client, {
            tenantId,
            bookingId: rows[0].id,
            amountMinorUnits: service.price_minor_units,
            currencyCode: service.currency_code,
            createdBy: customerUserId,
          });
        }

        return toBooking(rows[0]);
      });
    } catch (err) {
      if (isExclusionViolation(err)) {
        throw new ConflictException('This time slot is no longer available.');
      }
      throw err;
    }
  }

  async reschedule(tenantId: string, bookingId: string, startsAt: string, endsAt: string): Promise<Booking> {
    if (!(new Date(startsAt).getTime() < new Date(endsAt).getTime())) {
      throw new BadRequestException('startsAt must be before endsAt.');
    }

    try {
      return await this.db.withTenant(tenantId, async (client) => {
        const { rows } = await client.query(
          `UPDATE booking SET starts_at = $3, ends_at = $4, updated_at = now()
           WHERE id = $1 AND tenant_id = $2 AND status = 'confirmed'
           RETURNING id, tenant_id, service_id, customer_id, staff_user_id, status, starts_at, ends_at, notes, cancellation_reason, policy_snapshot`,
          [bookingId, tenantId, startsAt, endsAt],
        );
        if (rows.length === 0) {
          throw new NotFoundException('Booking not found, or it is not in a state that can be rescheduled.');
        }
        return toBooking(rows[0]);
      });
    } catch (err) {
      if (isExclusionViolation(err)) {
        throw new ConflictException('This time slot is no longer available.');
      }
      throw err;
    }
  }

  async transition(
    tenantId: string,
    bookingId: string,
    actorUserId: string,
    toStatus: BookingStatus,
    reason?: string,
  ): Promise<Booking> {
    return this.db.withTenant(tenantId, async (client) => {
      const { rows: existingRows } = await client.query(`SELECT status FROM booking WHERE id = $1 AND tenant_id = $2`, [
        bookingId,
        tenantId,
      ]);
      if (existingRows.length === 0) {
        throw new NotFoundException('Booking not found.');
      }

      assertValidTransition(existingRows[0].status, toStatus);

      const { rows } = await client.query(
        `UPDATE booking SET status = $3, cancellation_reason = COALESCE($4, cancellation_reason), updated_at = now()
         WHERE id = $1 AND tenant_id = $2
         RETURNING id, tenant_id, service_id, customer_id, staff_user_id, status, starts_at, ends_at, notes, cancellation_reason, policy_snapshot`,
        [bookingId, tenantId, toStatus, toStatus === 'cancelled' ? (reason ?? null) : null],
      );

      await this.audit.record({
        tenantId,
        actorUserId,
        action: 'booking.status_change',
        targetType: 'booking',
        targetId: bookingId,
        metadata: { status: toStatus, reason },
      }, client);

      return toBooking(rows[0]);
    });
  }

  /** A customer cancelling their own booking — checked against customer_profile.linked_user_id, not tenant membership. */
  async cancelOwnBooking(bookingId: string, customerUserId: string, reason?: string): Promise<Booking> {
    return this.db.withUser(customerUserId, async (client) => {
      const { rows: existingRows } = await client.query(
        `SELECT b.tenant_id, b.status
         FROM booking b
         JOIN customer_profile cp ON cp.id = b.customer_id
         WHERE b.id = $1 AND cp.linked_user_id = $2`,
        [bookingId, customerUserId],
      );
      const existing = existingRows[0];
      if (!existing) {
        throw new NotFoundException('Booking not found.');
      }

      assertValidTransition(existing.status, 'cancelled');

      const { rows } = await client.query(
        `UPDATE booking SET status = 'cancelled', cancellation_reason = $3, updated_at = now()
         WHERE id = $1
         RETURNING id, tenant_id, service_id, customer_id, staff_user_id, status, starts_at, ends_at, notes, cancellation_reason, policy_snapshot`,
        [bookingId, existing.tenant_id, reason ?? null],
      );

      return toBooking(rows[0]);
    });
  }

  async listForTenant(tenantId: string): Promise<Booking[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT id, tenant_id, service_id, customer_id, staff_user_id, status, starts_at, ends_at, notes, cancellation_reason, policy_snapshot
         FROM booking WHERE tenant_id = $1 ORDER BY starts_at DESC`,
        [tenantId],
      );
      return rows.map(toBooking);
    });
  }

  /** Cross-tenant "my bookings" — relies on the booking table's second RLS policy (see migration 004) and no app.tenant_id being set. */
  async listMine(customerUserId: string): Promise<Booking[]> {
    return this.db.withUser(customerUserId, async (client) => {
      const { rows } = await client.query(
        `SELECT b.id, b.tenant_id, b.service_id, b.customer_id, b.staff_user_id, b.status, b.starts_at, b.ends_at, b.notes, b.cancellation_reason, b.policy_snapshot
         FROM booking b
         JOIN customer_profile cp ON cp.id = b.customer_id
         WHERE cp.linked_user_id = $1
         ORDER BY b.starts_at DESC`,
        [customerUserId],
      );
      return rows.map(toBooking);
    });
  }
}

function isExclusionViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === POSTGRES_EXCLUSION_VIOLATION;
}

function toBooking(row: Record<string, unknown>): Booking {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    serviceId: row.service_id as string,
    customerId: row.customer_id as string,
    staffUserId: (row.staff_user_id as string) ?? null,
    status: row.status as BookingStatus,
    startsAt: row.starts_at as string,
    endsAt: row.ends_at as string,
    notes: (row.notes as string) ?? null,
    cancellationReason: (row.cancellation_reason as string) ?? null,
    policySnapshot: (row.policy_snapshot as Record<string, unknown>) ?? {},
  };
}

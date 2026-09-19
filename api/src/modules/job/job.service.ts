import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { CreateJobRequestDto, CreateQuotationDto } from './dto/job-request.dto';

export interface JobRequestRecord {
  id: string;
  serviceId: string;
  customerId: string;
  description: string;
  status: 'requested' | 'quoted' | 'accepted' | 'declined' | 'cancelled';
}

export interface QuotationRecord {
  id: string;
  jobRequestId: string;
  amountMinorUnits: number;
  currencyCode: string;
  proposedStartsAt: string;
  proposedEndsAt: string;
  validUntil: string;
}

const POSTGRES_EXCLUSION_VIOLATION = '23P01';

/**
 * The artisan flow (design section 8, "Journeys" > Artisan): a
 * customer describes a job, the provider quotes a price and schedule,
 * the customer accepts (which creates a `booking` row — going through
 * the same EXCLUDE constraint every appointment/accommodation booking
 * does, so an accepted quotation can still be rejected with a 409 if
 * the slot was taken in the meantime) or declines.
 */
@Injectable()
export class JobService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly payments: PaymentsService,
  ) {}

  async createRequest(tenantId: string, customerUserId: string, dto: CreateJobRequestDto): Promise<JobRequestRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const { rows: serviceRows } = await client.query(
        `SELECT id FROM service WHERE id = $1 AND tenant_id = $2 AND status = 'published' AND moderation_status = 'active'`,
        [dto.serviceId, tenantId],
      );
      if (serviceRows.length === 0) {
        throw new NotFoundException('Service not found or not currently open for requests.');
      }

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
           VALUES ($1, $2, $3, $4, $5, $2) RETURNING id`,
          [tenantId, customerUserId, user?.full_name ?? 'Customer', user?.phone ?? null, user?.email ?? null],
        );
        customerId = createdCustomer[0].id;
      }

      const { rows } = await client.query(
        `INSERT INTO job_request (tenant_id, service_id, customer_id, created_by, description)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, service_id, customer_id, description, status`,
        [tenantId, dto.serviceId, customerId, customerUserId, dto.description],
      );

      await this.audit.record({
        tenantId,
        actorUserId: customerUserId,
        action: 'job_request.create',
        targetType: 'job_request',
        targetId: rows[0].id,
      }, client);

      return toJobRequest(rows[0]);
    });
  }

  async quote(tenantId: string, jobRequestId: string, createdBy: string, dto: CreateQuotationDto): Promise<QuotationRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const { rows: jobRows } = await client.query(
        `SELECT id, status FROM job_request WHERE id = $1 AND tenant_id = $2`,
        [jobRequestId, tenantId],
      );
      if (jobRows.length === 0) {
        throw new NotFoundException('Job request not found.');
      }
      if (!['requested', 'quoted'].includes(jobRows[0].status)) {
        throw new BadRequestException(`Cannot quote a job request in status '${jobRows[0].status}'.`);
      }

      const { rows } = await client.query(
        `INSERT INTO quotation (tenant_id, job_request_id, amount_minor_units, currency_code, proposed_starts_at, proposed_ends_at, valid_until, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, job_request_id, amount_minor_units, currency_code, proposed_starts_at, proposed_ends_at, valid_until`,
        [
          tenantId,
          jobRequestId,
          dto.amountMinorUnits,
          dto.currencyCode,
          dto.proposedStartsAt,
          dto.proposedEndsAt,
          dto.validUntil,
          createdBy,
        ],
      );

      await client.query(`UPDATE job_request SET status = 'quoted', updated_at = now() WHERE id = $1`, [jobRequestId]);

      await this.audit.record({
        tenantId,
        actorUserId: createdBy,
        action: 'quotation.create',
        targetType: 'quotation',
        targetId: rows[0].id,
      }, client);

      return toQuotation(rows[0]);
    });
  }

  /** Customer accepts the most recent quotation, creating the booking. */
  async accept(tenantId: string, jobRequestId: string, customerUserId: string): Promise<{ bookingId: string }> {
    try {
      return await this.db.withTenant(tenantId, async (client) => {
        const { rows: jobRows } = await client.query(
          `SELECT jr.id, jr.service_id, jr.customer_id, jr.status, cp.linked_user_id
           FROM job_request jr
           JOIN customer_profile cp ON cp.id = jr.customer_id
           WHERE jr.id = $1 AND jr.tenant_id = $2`,
          [jobRequestId, tenantId],
        );
        const job = jobRows[0];
        if (!job) {
          throw new NotFoundException('Job request not found.');
        }
        if (job.linked_user_id !== customerUserId) {
          throw new BadRequestException('Only the customer who made this request can accept a quotation for it.');
        }
        if (job.status !== 'quoted') {
          throw new BadRequestException(`Cannot accept a job request in status '${job.status}'.`);
        }

        const { rows: quoteRows } = await client.query(
          `SELECT id, amount_minor_units, currency_code, proposed_starts_at, proposed_ends_at FROM quotation
           WHERE job_request_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [jobRequestId],
        );
        const quote = quoteRows[0];
        if (!quote) {
          throw new NotFoundException('No quotation found for this job request.');
        }
        if (new Date(quote.proposed_ends_at) < new Date()) {
          throw new BadRequestException('This quotation has expired.');
        }

        const { rows: bookingRows } = await client.query(
          `INSERT INTO booking (tenant_id, service_id, customer_id, created_by, starts_at, ends_at, notes)
           VALUES ($1, $2, $3, $4, $5, $6, 'Created from an accepted artisan quotation.')
           RETURNING id`,
          [tenantId, job.service_id, job.customer_id, customerUserId, quote.proposed_starts_at, quote.proposed_ends_at],
        );

        await client.query(`UPDATE job_request SET status = 'accepted', updated_at = now() WHERE id = $1`, [jobRequestId]);

        // Phase 4: through the payment provider (see
        // payments.module.ts), same as booking.service.ts's create().
        // The artisan flow's price is whatever was quoted, not the
        // service's own (typically zero, quote-per-job) price.
        if (quote.amount_minor_units > 0) {
          await this.payments.chargeAndRecord(client, {
            tenantId,
            bookingId: bookingRows[0].id,
            amountMinorUnits: quote.amount_minor_units,
            currencyCode: quote.currency_code,
            createdBy: customerUserId,
          });
        }

        await this.audit.record({
          tenantId,
          actorUserId: customerUserId,
          action: 'job_request.accept',
          targetType: 'job_request',
          targetId: jobRequestId,
          metadata: { bookingId: bookingRows[0].id },
        }, client);

        return { bookingId: bookingRows[0].id };
      });
    } catch (err) {
      if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === POSTGRES_EXCLUSION_VIOLATION) {
        throw new ConflictException('The quoted time slot is no longer available.');
      }
      throw err;
    }
  }

  async decline(tenantId: string, jobRequestId: string, reason?: string): Promise<JobRequestRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `UPDATE job_request SET status = 'declined', updated_at = now()
         WHERE id = $1 AND tenant_id = $2 AND status IN ('requested', 'quoted')
         RETURNING id, service_id, customer_id, description, status`,
        [jobRequestId, tenantId],
      );
      if (rows.length === 0) {
        throw new NotFoundException('Job request not found, or already resolved.');
      }
      void reason; // kept in the route's DTO for an audit trail; no dedicated column in this milestone's schema
      return toJobRequest(rows[0]);
    });
  }

  async listForTenant(tenantId: string): Promise<JobRequestRecord[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT id, service_id, customer_id, description, status FROM job_request WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [tenantId],
      );
      return rows.map(toJobRequest);
    });
  }
}

function toJobRequest(row: Record<string, unknown>): JobRequestRecord {
  return {
    id: row.id as string,
    serviceId: row.service_id as string,
    customerId: row.customer_id as string,
    description: row.description as string,
    status: row.status as JobRequestRecord['status'],
  };
}

function toQuotation(row: Record<string, unknown>): QuotationRecord {
  return {
    id: row.id as string,
    jobRequestId: row.job_request_id as string,
    amountMinorUnits: row.amount_minor_units as number,
    currencyCode: row.currency_code as string,
    proposedStartsAt: row.proposed_starts_at as string,
    proposedEndsAt: row.proposed_ends_at as string,
    validUntil: row.valid_until as string,
  };
}

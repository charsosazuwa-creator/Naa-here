import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { DatabaseService } from '../../src/database/database.service';

/**
 * The Phase-3 "Done when" scenario, end to end, against an in-memory
 * fake standing in for PostgreSQL (see auth.e2e-spec.ts and
 * provider-crm.e2e-spec.ts for the same pattern). The fake
 * re-implements the one rule this suite exists to prove: the
 * booking table's EXCLUDE constraint rejects an overlapping booking
 * for the same service. test/db/booking-exclusion.spec.ts proves the
 * same rule against a real Postgres, including under concurrency —
 * this suite proves the API translates that rejection into a normal
 * 409, and covers the reschedule/cancel/status-transition routes a
 * fake database can exercise without needing real range types.
 */

interface FakeTenant {
  id: string;
  verification_status: string;
}
interface FakeMembership {
  tenant_id: string;
  user_id: string;
  role_id: number;
  status: string;
}
interface FakeService {
  id: string;
  tenant_id: string;
  status: string;
  moderation_status: string;
  price_minor_units: number;
  currency_code: string;
}
interface FakeCustomer {
  id: string;
  tenant_id: string;
  linked_user_id: string;
}
interface FakeBooking {
  id: string;
  tenant_id: string;
  service_id: string;
  customer_id: string;
  status: string;
  starts_at: string;
  ends_at: string;
  cancellation_reason: string | null;
}
interface FakeJobRequest {
  id: string;
  tenant_id: string;
  service_id: string;
  customer_id: string;
  status: string;
}
interface FakeQuotation {
  id: string;
  job_request_id: string;
  amount_minor_units: number;
  currency_code: string;
  proposed_starts_at: string;
  proposed_ends_at: string;
  created_at: string;
}
interface FakeLedgerEntry {
  id: string;
  tenant_id: string;
  booking_id: string | null;
  type: string;
  amount_minor_units: number;
  currency_code: string;
}
interface FakeEscrowAccount {
  tenant_id: string;
  balance_minor_units: number;
  currency_code: string;
}
interface FakePaymentIntent {
  id: string;
  tenant_id: string;
  booking_id: string | null;
  payout_id: string | null;
  kind: string;
  provider: string;
  provider_reference: string;
  amount_minor_units: number;
  currency_code: string;
  status: string;
  ledger_entry_id: string | null;
}

const ROLE_CODES: Record<number, string> = { 1: 'owner', 2: 'staff', 3: 'artisan' };

// Mirrors db/migrations/002_provider_crm.sql's and
// 004_booking_engine.sql's role_permission seed for the roles this
// fixture actually exercises. The previous version of this stub
// granted every permission to 'owner' alone and nothing to any other
// role, which happened to work for the owner-only booking tests but
// silently 403'd both the artisan flow (role 'artisan') and the
// booking-state-machine test's 'booking.manage' checks the moment
// this suite was ever actually run — never caught before that.
const ROLE_PERMISSIONS: Record<string, string[]> = {
  owner: ['business.manage', 'staff.manage', 'service.manage', 'service.publish', 'availability.manage', 'customer.manage', 'media.upload', 'booking.manage', 'job.manage'],
  staff: ['service.manage', 'availability.manage', 'customer.manage', 'media.upload', 'booking.manage', 'job.manage'],
  artisan: ['business.manage', 'service.manage', 'service.publish', 'availability.manage', 'customer.manage', 'media.upload', 'verification.submit', 'booking.manage', 'job.manage'],
};

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd);
}

interface FakeIdempotencyRow {
  key: string;
  user_id: string;
  request_hash: string;
  response_body: unknown;
}

class FakeDatabaseService {
  tenants: FakeTenant[] = [];
  memberships: FakeMembership[] = [];
  services: FakeService[] = [];
  customers: FakeCustomer[] = [];
  bookings: FakeBooking[] = [];
  jobRequests: FakeJobRequest[] = [];
  quotations: FakeQuotation[] = [];
  ledgerEntries: FakeLedgerEntry[] = [];
  escrowAccounts: FakeEscrowAccount[] = [];
  paymentIntents: FakePaymentIntent[] = [];
  idempotencyKeys: FakeIdempotencyRow[] = [];
  nextId(_prefix: string): string {
    // CreateBookingDto.serviceId / CreateJobRequestDto.serviceId (and a
    // few other DTO fields elsewhere) are @IsUUID()-validated against
    // the real schema's gen_random_uuid() ids, so the fake must hand
    // out real UUIDs too, or ValidationPipe rejects every request
    // built from one of these ids with a 400 before it ever reaches
    // the fake database. `_prefix` is kept only for readability at
    // call sites.
    return randomUUID();
  }

  async query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
    const sql = text.replace(/\s+/g, ' ').trim();

    if (sql.startsWith('SELECT r.code AS role_code, m.status')) {
      const [tenantId, userId] = params as [string, string];
      const m = this.memberships.find((x) => x.tenant_id === tenantId && x.user_id === userId);
      return (m ? [{ role_code: ROLE_CODES[m.role_id], status: m.status }] : []) as unknown as T[];
    }

    if (sql.startsWith('SELECT p.code')) {
      const [roleCode, permissionCode] = params as [string, string];
      const granted = (ROLE_PERMISSIONS[roleCode] ?? []).includes(permissionCode);
      return (granted ? [{ code: permissionCode }] : []) as unknown as T[];
    }

    if (sql.startsWith('SELECT request_hash, response_body, user_id FROM idempotency_key')) {
      const [key] = params as [string];
      const row = this.idempotencyKeys.find((r) => r.key === key);
      return (row ? [row] : []) as unknown as T[];
    }

    if (sql.startsWith('INSERT INTO idempotency_key')) {
      const [key, userId, , requestHash, , responseBody] = params as [string, string, string, string, number, string];
      if (!this.idempotencyKeys.some((r) => r.key === key)) {
        this.idempotencyKeys.push({ key, user_id: userId, request_hash: requestHash, response_body: JSON.parse(responseBody) });
      }
      return [] as unknown as T[];
    }

    return [] as unknown as T[];
  }

  async withTenant<T>(tenantId: string, fn: (client: unknown) => Promise<T>): Promise<T> {
    return fn(new FakeClient(this, tenantId) as unknown as never);
  }

  async withUser<T>(userId: string, fn: (client: unknown) => Promise<T>): Promise<T> {
    return fn(new FakeClient(this, null, userId) as unknown as never);
  }

  async withTransaction<T>(fn: (client: unknown) => Promise<T>): Promise<T> {
    return fn(new FakeClient(this, null) as unknown as never);
  }

  async onModuleDestroy(): Promise<void> {
    /* no-op */
  }
}

class ExclusionViolation extends Error {
  code = '23P01';
}

class FakeClient {
  constructor(
    private readonly db: FakeDatabaseService,
    private readonly tenantId: string | null,
    private readonly asUserId: string | null = null,
  ) {}

  async query(text: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> {
    const sql = text.replace(/\s+/g, ' ').trim();

    if (sql.startsWith('INSERT INTO tenant')) {
      const tenant: FakeTenant = { id: this.db.nextId('tenant'), verification_status: 'verified' };
      this.db.tenants.push(tenant);
      return { rows: [{ id: tenant.id, name: params[0], category: params[2], country_code: params[1], description: null, contact_phone: null, contact_email: null, verification_status: 'verified', status: 'active' }] };
    }

    if (sql.startsWith('INSERT INTO membership')) {
      const [tenantId, userId, roleId] = params as [string, string, number];
      this.db.memberships.push({ tenant_id: tenantId, user_id: userId, role_id: roleId, status: 'active' });
      return { rows: [{ id: this.db.nextId('membership') }] };
    }

    if (sql.startsWith('INSERT INTO service')) {
      const [tenantId, , categoryId, name] = params as [string, string, number, string];
      const priceMinorUnits = Number(params[6]);
      const currencyCode = params[7] as string;
      const service: FakeService = {
        id: this.db.nextId('service'),
        tenant_id: tenantId,
        status: 'draft',
        moderation_status: 'active',
        price_minor_units: priceMinorUnits,
        currency_code: currencyCode,
      };
      this.db.services.push(service);
      return { rows: [{ id: service.id, category_id: categoryId, location_id: null, name, description: null, duration_minutes: params[5], price_minor_units: priceMinorUnits, currency_code: currencyCode, status: 'draft' }] };
    }

    if (sql.startsWith('UPDATE service SET status')) {
      const [serviceId, tenantId, status] = params as [string, string, string];
      const service = this.db.services.find((s) => s.id === serviceId && s.tenant_id === tenantId);
      if (!service) return { rows: [] };
      service.status = status;
      return { rows: [{ id: service.id, category_id: 1, location_id: null, name: 'svc', description: null, duration_minutes: 30, price_minor_units: service.price_minor_units, currency_code: service.currency_code, status }] };
    }

    // booking.service.ts's own service lookup (includes moderation_status,
    // price and currency, needed to record the dormant ledger charge).
    if (sql.startsWith('SELECT id, status, moderation_status, price_minor_units, currency_code FROM service')) {
      const [serviceId, tenantId] = params as [string, string];
      const service = this.db.services.find((s) => s.id === serviceId && s.tenant_id === tenantId);
      return {
        rows: service
          ? [
              {
                id: service.id,
                status: service.status,
                moderation_status: service.moderation_status,
                price_minor_units: service.price_minor_units,
                currency_code: service.currency_code,
              },
            ]
          : [],
      };
    }

    if (sql.startsWith('SELECT id FROM customer_profile WHERE tenant_id')) {
      const [tenantId, userId] = params as [string, string];
      const customer = this.db.customers.find((c) => c.tenant_id === tenantId && c.linked_user_id === userId);
      return { rows: customer ? [{ id: customer.id }] : [] };
    }

    if (sql.startsWith('SELECT full_name, email, phone FROM app_user')) {
      return { rows: [{ full_name: 'Test Customer', email: null, phone: null }] };
    }

    if (sql.startsWith('INSERT INTO customer_profile')) {
      const [tenantId, userId] = params as [string, string];
      const customer: FakeCustomer = { id: this.db.nextId('customer'), tenant_id: tenantId, linked_user_id: userId };
      this.db.customers.push(customer);
      return { rows: [{ id: customer.id }] };
    }

    if (sql.startsWith('SELECT verification_status FROM tenant')) {
      const [tenantId] = params as [string];
      const tenant = this.db.tenants.find((t) => t.id === tenantId);
      return { rows: tenant ? [{ verification_status: tenant.verification_status }] : [] };
    }

    // Two distinct INSERT INTO booking statements share this prefix:
    // booking.service.ts's (8 columns, including staff_user_id) and
    // job.service.ts's accept() flow (7 columns, no staff_user_id, a
    // literal notes string baked into the SQL text rather than a param).
    // The column list is part of the SQL text either way, so checking
    // for 'staff_user_id' in the text (not the params) tells them apart.
    if (sql.startsWith('INSERT INTO booking') && sql.includes('staff_user_id')) {
      const [tenantId, serviceId, customerId, , , startsAt, endsAt] = params as [string, string, string, string, string | null, string, string];
      const conflict = this.db.bookings.find(
        (b) =>
          b.tenant_id === tenantId &&
          b.service_id === serviceId &&
          !['cancelled', 'no_show'].includes(b.status) &&
          overlaps(b.starts_at, b.ends_at, startsAt, endsAt),
      );
      if (conflict) {
        throw new ExclusionViolation('overlapping booking');
      }
      const booking: FakeBooking = {
        id: this.db.nextId('booking'),
        tenant_id: tenantId,
        service_id: serviceId,
        customer_id: customerId,
        status: 'confirmed',
        starts_at: startsAt,
        ends_at: endsAt,
        cancellation_reason: null,
      };
      this.db.bookings.push(booking);
      return { rows: [toBookingRow(booking)] };
    }

    if (sql.startsWith('INSERT INTO booking')) {
      // job.service.ts's accept() flow: (tenant_id, service_id, customer_id, created_by, starts_at, ends_at, <literal notes>)
      const [tenantId, serviceId, customerId, , startsAt, endsAt] = params as [string, string, string, string, string, string];
      const conflict = this.db.bookings.find(
        (b) =>
          b.tenant_id === tenantId &&
          b.service_id === serviceId &&
          !['cancelled', 'no_show'].includes(b.status) &&
          overlaps(b.starts_at, b.ends_at, startsAt, endsAt),
      );
      if (conflict) {
        throw new ExclusionViolation('overlapping booking');
      }
      const booking: FakeBooking = {
        id: this.db.nextId('booking'),
        tenant_id: tenantId,
        service_id: serviceId,
        customer_id: customerId,
        status: 'confirmed',
        starts_at: startsAt,
        ends_at: endsAt,
        cancellation_reason: null,
      };
      this.db.bookings.push(booking);
      return { rows: [{ id: booking.id }] };
    }

    if (sql.startsWith("SELECT id FROM service WHERE id = $1 AND tenant_id = $2 AND status = 'published'")) {
      const [serviceId, tenantId] = params as [string, string];
      const service = this.db.services.find(
        (s) => s.id === serviceId && s.tenant_id === tenantId && s.status === 'published' && s.moderation_status === 'active',
      );
      return { rows: service ? [{ id: service.id }] : [] };
    }

    if (sql.startsWith('INSERT INTO job_request')) {
      const [tenantId, serviceId, customerId, , description] = params as [string, string, string, string, string];
      const jobRequest: FakeJobRequest = {
        id: this.db.nextId('job'),
        tenant_id: tenantId,
        service_id: serviceId,
        customer_id: customerId,
        status: 'requested',
      };
      this.db.jobRequests.push(jobRequest);
      return { rows: [{ id: jobRequest.id, service_id: serviceId, customer_id: customerId, description, status: jobRequest.status }] };
    }

    if (sql.startsWith('SELECT id, status FROM job_request WHERE id = $1 AND tenant_id = $2')) {
      const [jobRequestId, tenantId] = params as [string, string];
      const jobRequest = this.db.jobRequests.find((j) => j.id === jobRequestId && j.tenant_id === tenantId);
      return { rows: jobRequest ? [{ id: jobRequest.id, status: jobRequest.status }] : [] };
    }

    if (sql.startsWith('INSERT INTO quotation')) {
      const [, jobRequestId, amountMinorUnits, currencyCode, proposedStartsAt, proposedEndsAt, validUntil] = params as [
        string,
        string,
        number,
        string,
        string,
        string,
        string,
      ];
      const quotation: FakeQuotation = {
        id: this.db.nextId('quotation'),
        job_request_id: jobRequestId,
        amount_minor_units: Number(amountMinorUnits),
        currency_code: currencyCode,
        proposed_starts_at: proposedStartsAt,
        proposed_ends_at: proposedEndsAt,
        created_at: new Date().toISOString(),
      };
      this.db.quotations.push(quotation);
      return {
        rows: [
          {
            id: quotation.id,
            job_request_id: jobRequestId,
            amount_minor_units: amountMinorUnits,
            currency_code: currencyCode,
            proposed_starts_at: proposedStartsAt,
            proposed_ends_at: proposedEndsAt,
            valid_until: validUntil,
          },
        ],
      };
    }

    if (sql.startsWith("UPDATE job_request SET status = 'quoted'")) {
      const [jobRequestId] = params as [string];
      const jobRequest = this.db.jobRequests.find((j) => j.id === jobRequestId);
      if (jobRequest) jobRequest.status = 'quoted';
      return { rows: [] };
    }

    if (
      sql.includes('FROM job_request jr') &&
      sql.includes('JOIN customer_profile cp') &&
      sql.startsWith('SELECT jr.id, jr.service_id, jr.customer_id, jr.status, cp.linked_user_id')
    ) {
      const [jobRequestId, tenantId] = params as [string, string];
      const jobRequest = this.db.jobRequests.find((j) => j.id === jobRequestId && j.tenant_id === tenantId);
      if (!jobRequest) return { rows: [] };
      const customer = this.db.customers.find((c) => c.id === jobRequest.customer_id);
      return {
        rows: [
          {
            id: jobRequest.id,
            service_id: jobRequest.service_id,
            customer_id: jobRequest.customer_id,
            status: jobRequest.status,
            linked_user_id: customer?.linked_user_id ?? null,
          },
        ],
      };
    }

    if (sql.startsWith('SELECT id, amount_minor_units, currency_code, proposed_starts_at, proposed_ends_at FROM quotation')) {
      const [jobRequestId] = params as [string];
      const matches = this.db.quotations
        .filter((q) => q.job_request_id === jobRequestId)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      const latest = matches[0];
      return {
        rows: latest
          ? [
              {
                id: latest.id,
                amount_minor_units: latest.amount_minor_units,
                currency_code: latest.currency_code,
                proposed_starts_at: latest.proposed_starts_at,
                proposed_ends_at: latest.proposed_ends_at,
              },
            ]
          : [],
      };
    }

    if (sql.startsWith('INSERT INTO ledger_entry')) {
      const [tenantId, bookingId, type, amountMinorUnits, currencyCode, createdBy, heldForDisputeId] = params as [
        string,
        string | null,
        string,
        number,
        string,
        string | null,
        string | null,
      ];
      const entry: FakeLedgerEntry = {
        id: this.db.nextId('ledger'),
        tenant_id: tenantId,
        booking_id: bookingId ?? null,
        type,
        amount_minor_units: Number(amountMinorUnits),
        currency_code: currencyCode,
      };
      this.db.ledgerEntries.push(entry);
      return {
        rows: [
          {
            id: entry.id,
            tenant_id: tenantId,
            booking_id: entry.booking_id,
            type,
            amount_minor_units: entry.amount_minor_units,
            currency_code: currencyCode,
            fee_minor_units: 0,
            held_for_dispute_id: heldForDisputeId ?? null,
            created_at: new Date().toISOString(),
          },
        ],
      };
    }

    if (sql.startsWith('INSERT INTO escrow_account')) {
      const [tenantId, deltaMinorUnits, currencyCode] = params as [string, number, string];
      let account = this.db.escrowAccounts.find((a) => a.tenant_id === tenantId);
      if (!account) {
        account = { tenant_id: tenantId, balance_minor_units: 0, currency_code: currencyCode };
        this.db.escrowAccounts.push(account);
      }
      account.balance_minor_units += Number(deltaMinorUnits);
      return { rows: [] };
    }

    // Phase 4: PaymentsService.chargeAndRecord's payment_intent row,
    // written alongside (never in place of) the ledger_entry inserted
    // just above — see payments.service.ts.
    if (sql.startsWith('INSERT INTO payment_intent')) {
      const [tenantId, bookingId, payoutId, kind, provider, providerReference, amountMinorUnits, currencyCode, status, ledgerEntryId] =
        params as [string, string | null, string | null, string, string, string, number, string, string, string | null, string | null];
      const intent: FakePaymentIntent = {
        id: this.db.nextId('payment_intent'),
        tenant_id: tenantId,
        booking_id: bookingId ?? null,
        payout_id: payoutId ?? null,
        kind,
        provider,
        provider_reference: providerReference,
        amount_minor_units: Number(amountMinorUnits),
        currency_code: currencyCode,
        status,
        ledger_entry_id: ledgerEntryId ?? null,
      };
      this.db.paymentIntents.push(intent);
      return { rows: [{ id: intent.id }] };
    }

    if (sql.startsWith("UPDATE job_request SET status = 'accepted'")) {
      const [jobRequestId] = params as [string];
      const jobRequest = this.db.jobRequests.find((j) => j.id === jobRequestId);
      if (jobRequest) jobRequest.status = 'accepted';
      return { rows: [] };
    }

    if (sql.startsWith("UPDATE job_request SET status = 'declined'")) {
      const [jobRequestId, tenantId] = params as [string, string];
      const jobRequest = this.db.jobRequests.find(
        (j) => j.id === jobRequestId && j.tenant_id === tenantId && ['requested', 'quoted'].includes(j.status),
      );
      if (!jobRequest) return { rows: [] };
      jobRequest.status = 'declined';
      return { rows: [{ id: jobRequest.id, service_id: jobRequest.service_id, customer_id: jobRequest.customer_id, description: '', status: jobRequest.status }] };
    }

    if (sql.startsWith('UPDATE booking SET starts_at')) {
      const [bookingId, tenantId, startsAt, endsAt] = params as [string, string, string, string];
      const booking = this.db.bookings.find((b) => b.id === bookingId && b.tenant_id === tenantId && b.status === 'confirmed');
      if (!booking) return { rows: [] };
      const conflict = this.db.bookings.find(
        (b) =>
          b.id !== bookingId &&
          b.tenant_id === tenantId &&
          b.service_id === booking.service_id &&
          !['cancelled', 'no_show'].includes(b.status) &&
          overlaps(b.starts_at, b.ends_at, startsAt, endsAt),
      );
      if (conflict) throw new ExclusionViolation('overlapping booking');
      booking.starts_at = startsAt;
      booking.ends_at = endsAt;
      return { rows: [toBookingRow(booking)] };
    }

    if (sql.startsWith('SELECT status FROM booking WHERE id')) {
      const [bookingId, tenantId] = params as [string, string];
      const booking = this.db.bookings.find((b) => b.id === bookingId && b.tenant_id === tenantId);
      return { rows: booking ? [{ status: booking.status }] : [] };
    }

    if (sql.startsWith('UPDATE booking SET status = $3')) {
      const [bookingId, tenantId, status, reason] = params as [string, string, string, string | null];
      const booking = this.db.bookings.find((b) => b.id === bookingId && b.tenant_id === tenantId);
      if (!booking) return { rows: [] };
      booking.status = status;
      if (reason) booking.cancellation_reason = reason;
      return { rows: [toBookingRow(booking)] };
    }

    if (sql.includes('FROM booking b') && sql.includes('JOIN customer_profile cp') && sql.startsWith('SELECT b.tenant_id, b.status')) {
      const [bookingId, userId] = params as [string, string];
      const booking = this.db.bookings.find((b) => b.id === bookingId);
      const customer = booking && this.db.customers.find((c) => c.id === booking.customer_id && c.linked_user_id === userId);
      return { rows: booking && customer ? [{ tenant_id: booking.tenant_id, status: booking.status }] : [] };
    }

    if (sql.startsWith("UPDATE booking SET status = 'cancelled'")) {
      const [bookingId, , reason] = params as [string, string, string | null];
      const booking = this.db.bookings.find((b) => b.id === bookingId);
      if (!booking) return { rows: [] };
      booking.status = 'cancelled';
      booking.cancellation_reason = reason;
      return { rows: [toBookingRow(booking)] };
    }

    // Falls through to FakeDatabaseService.query() for anything this
    // tenant-scoped client doesn't special-case itself — in particular
    // TenantRoleGuard's own membership/role_permission lookups, which
    // now run through `client.query()` (see tenant-role.guard.ts's own
    // comment for why). Without this, every TenantRoleGuard-protected
    // route would 403 here, since this class's own branches never
    // modeled those two lookups.
    return { rows: await this.db.query(text, params) };
  }
}

function toBookingRow(b: FakeBooking) {
  return {
    id: b.id,
    tenant_id: b.tenant_id,
    service_id: b.service_id,
    customer_id: b.customer_id,
    staff_user_id: null,
    status: b.status,
    starts_at: b.starts_at,
    ends_at: b.ends_at,
    notes: null,
    cancellation_reason: b.cancellation_reason,
    policy_snapshot: {},
  };
}

describe('Booking engine (e2e)', () => {
  let app: INestApplication;
  let jwt: JwtService;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useClass(FakeDatabaseService)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.setGlobalPrefix('v1', { exclude: ['health/live', 'health/ready'] });
    await app.init();

    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function tokenFor(userId: string): Promise<string> {
    return jwt.signAsync({ sub: userId }, { secret: process.env.JWT_SECRET, expiresIn: '15m' });
  }

  it('rejects an overlapping booking with 409, and allows a non-overlapping one', async () => {
    const server = app.getHttpServer();
    const ownerId = 'owner-1';
    const customerAId = 'customer-a';
    const customerBId = 'customer-b';
    const ownerAuth = { Authorization: `Bearer ${await tokenFor(ownerId)}` };

    const businessRes = await request(server)
      .post('/v1/tenants')
      .set(ownerAuth)
      .send({ name: 'Booking Test Salon', category: 'barber_salon', countryCode: 'NG' })
      .expect(201);
    const tenantId = businessRes.body.id as string;

    const serviceRes = await request(server)
      .post(`/v1/tenants/${tenantId}/services`)
      .set(ownerAuth)
      .send({ categoryId: 1, name: 'Haircut', priceMinorUnits: 500000, currencyCode: 'NGN', durationMinutes: 30 })
      .expect(201);
    const serviceId = serviceRes.body.id as string;

    await request(server)
      .patch(`/v1/tenants/${tenantId}/services/${serviceId}/status`)
      .set(ownerAuth)
      .send({ status: 'published' })
      .expect(200);

    const startsAt = new Date(Date.now() + 3_600_000).toISOString();
    const endsAt = new Date(Date.now() + 5_400_000).toISOString();

    const firstBookingRes = await request(server)
      .post(`/v1/tenants/${tenantId}/bookings`)
      .set({ Authorization: `Bearer ${await tokenFor(customerAId)}`, 'Idempotency-Key': 'key-1' })
      .send({ serviceId, startsAt, endsAt })
      .expect(201);
    expect(firstBookingRes.body.status).toBe('confirmed');

    // A second, different customer, trying to book the exact same slot.
    await request(server)
      .post(`/v1/tenants/${tenantId}/bookings`)
      .set({ Authorization: `Bearer ${await tokenFor(customerBId)}`, 'Idempotency-Key': 'key-2' })
      .send({ serviceId, startsAt, endsAt })
      .expect(409);

    // A non-overlapping slot for the same service succeeds.
    const laterStart = endsAt;
    const laterEnd = new Date(Date.now() + 7_200_000).toISOString();
    await request(server)
      .post(`/v1/tenants/${tenantId}/bookings`)
      .set({ Authorization: `Bearer ${await tokenFor(customerBId)}`, 'Idempotency-Key': 'key-3' })
      .send({ serviceId, startsAt: laterStart, endsAt: laterEnd })
      .expect(201);
  });

  it('replays the cached response for a retried request with the same Idempotency-Key', async () => {
    const server = app.getHttpServer();
    const ownerId = 'owner-2';
    const customerId = 'customer-c';
    const ownerAuth = { Authorization: `Bearer ${await tokenFor(ownerId)}` };
    const customerAuth = { Authorization: `Bearer ${await tokenFor(customerId)}`, 'Idempotency-Key': 'retry-key-1' };

    const businessRes = await request(server)
      .post('/v1/tenants')
      .set(ownerAuth)
      .send({ name: 'Idempotency Test Salon', category: 'barber_salon', countryCode: 'NG' })
      .expect(201);
    const tenantId = businessRes.body.id as string;

    const serviceRes = await request(server)
      .post(`/v1/tenants/${tenantId}/services`)
      .set(ownerAuth)
      .send({ categoryId: 1, name: 'Shave', priceMinorUnits: 200000, currencyCode: 'NGN', durationMinutes: 15 })
      .expect(201);
    const serviceId = serviceRes.body.id as string;

    await request(server).patch(`/v1/tenants/${tenantId}/services/${serviceId}/status`).set(ownerAuth).send({ status: 'published' }).expect(200);

    const startsAt = new Date(Date.now() + 10_000_000).toISOString();
    const endsAt = new Date(Date.now() + 10_900_000).toISOString();
    const body = { serviceId, startsAt, endsAt };

    const first = await request(server).post(`/v1/tenants/${tenantId}/bookings`).set(customerAuth).send(body).expect(201);
    const second = await request(server).post(`/v1/tenants/${tenantId}/bookings`).set(customerAuth).send(body).expect(201);

    // Same booking id both times: the second call replayed the cached
    // response rather than executing the handler (and its INSERT) again.
    expect(second.body.id).toBe(first.body.id);
  });

  it('cancel then complete: enforces the state machine end to end', async () => {
    const server = app.getHttpServer();
    const ownerId = 'owner-3';
    const customerId = 'customer-d';
    const ownerAuth = { Authorization: `Bearer ${await tokenFor(ownerId)}` };

    const businessRes = await request(server)
      .post('/v1/tenants')
      .set(ownerAuth)
      .send({ name: 'State Machine Salon', category: 'barber_salon', countryCode: 'NG' })
      .expect(201);
    const tenantId = businessRes.body.id as string;

    const serviceRes = await request(server)
      .post(`/v1/tenants/${tenantId}/services`)
      .set(ownerAuth)
      .send({ categoryId: 1, name: 'Trim', priceMinorUnits: 100000, currencyCode: 'NGN', durationMinutes: 15 })
      .expect(201);
    const serviceId = serviceRes.body.id as string;
    await request(server).patch(`/v1/tenants/${tenantId}/services/${serviceId}/status`).set(ownerAuth).send({ status: 'published' }).expect(200);

    const startsAt = new Date(Date.now() + 20_000_000).toISOString();
    const endsAt = new Date(Date.now() + 20_900_000).toISOString();
    const bookingRes = await request(server)
      .post(`/v1/tenants/${tenantId}/bookings`)
      .set({ Authorization: `Bearer ${await tokenFor(customerId)}`, 'Idempotency-Key': 'state-key-1' })
      .send({ serviceId, startsAt, endsAt })
      .expect(201);
    const bookingId = bookingRes.body.id as string;

    // Owner cannot mark it 'completed' directly from 'confirmed'.
    await request(server)
      .patch(`/v1/tenants/${tenantId}/bookings/${bookingId}/status`)
      .set(ownerAuth)
      .send({ status: 'completed' })
      .expect(400);

    // Customer cancels their own booking.
    const cancelRes = await request(server)
      .patch(`/v1/bookings/${bookingId}/cancel`)
      .set({ Authorization: `Bearer ${await tokenFor(customerId)}` })
      .send({ reason: 'Change of plans' })
      .expect(200);
    expect(cancelRes.body.status).toBe('cancelled');

    // A cancelled booking cannot be moved anywhere else.
    await request(server)
      .patch(`/v1/tenants/${tenantId}/bookings/${bookingId}/status`)
      .set(ownerAuth)
      .send({ status: 'in_progress' })
      .expect(400);
  });

  it('artisan flow: request -> quote -> accept creates a booking', async () => {
    const server = app.getHttpServer();
    const ownerId = 'owner-4';
    const customerId = 'customer-e';
    const ownerAuth = { Authorization: `Bearer ${await tokenFor(ownerId)}` };
    const customerAuth = { Authorization: `Bearer ${await tokenFor(customerId)}` };

    const businessRes = await request(server)
      .post('/v1/tenants')
      .set(ownerAuth)
      .send({ name: 'Artisan Test Workshop', category: 'artisan', countryCode: 'NG' })
      .expect(201);
    const tenantId = businessRes.body.id as string;

    const serviceRes = await request(server)
      .post(`/v1/tenants/${tenantId}/services`)
      .set(ownerAuth)
      .send({ categoryId: 1, name: 'Custom furniture repair', priceMinorUnits: 0, currencyCode: 'NGN', durationMinutes: 60 })
      .expect(201);
    const serviceId = serviceRes.body.id as string;
    await request(server).patch(`/v1/tenants/${tenantId}/services/${serviceId}/status`).set(ownerAuth).send({ status: 'published' }).expect(200);

    const jobRes = await request(server)
      .post(`/v1/tenants/${tenantId}/job-requests`)
      .set(customerAuth)
      .send({ serviceId, description: 'Fix a wobbly dining chair.' })
      .expect(201);
    const jobRequestId = jobRes.body.id as string;
    expect(jobRes.body.status).toBe('requested');

    const proposedStartsAt = new Date(Date.now() + 30_000_000).toISOString();
    const proposedEndsAt = new Date(Date.now() + 33_600_000).toISOString();
    const validUntil = new Date(Date.now() + 86_400_000).toISOString();

    const quoteRes = await request(server)
      .post(`/v1/tenants/${tenantId}/job-requests/${jobRequestId}/quote`)
      .set(ownerAuth)
      .send({ amountMinorUnits: 1_500_000, currencyCode: 'NGN', proposedStartsAt, proposedEndsAt, validUntil })
      .expect(201);
    expect(quoteRes.body.jobRequestId).toBe(jobRequestId);

    const acceptRes = await request(server)
      .post(`/v1/tenants/${tenantId}/job-requests/${jobRequestId}/accept`)
      .set(customerAuth)
      .send({})
      .expect(201);
    expect(acceptRes.body.bookingId).toBeDefined();
  });

  it('artisan flow: declining a job request stops it from being quoted again', async () => {
    const server = app.getHttpServer();
    const ownerId = 'owner-5';
    const customerId = 'customer-f';
    const ownerAuth = { Authorization: `Bearer ${await tokenFor(ownerId)}` };
    const customerAuth = { Authorization: `Bearer ${await tokenFor(customerId)}` };

    const businessRes = await request(server)
      .post('/v1/tenants')
      .set(ownerAuth)
      .send({ name: 'Another Artisan Workshop', category: 'artisan', countryCode: 'NG' })
      .expect(201);
    const tenantId = businessRes.body.id as string;

    const serviceRes = await request(server)
      .post(`/v1/tenants/${tenantId}/services`)
      .set(ownerAuth)
      .send({ categoryId: 1, name: 'Custom cabinetry', priceMinorUnits: 0, currencyCode: 'NGN', durationMinutes: 60 })
      .expect(201);
    const serviceId = serviceRes.body.id as string;
    await request(server).patch(`/v1/tenants/${tenantId}/services/${serviceId}/status`).set(ownerAuth).send({ status: 'published' }).expect(200);

    const jobRes = await request(server)
      .post(`/v1/tenants/${tenantId}/job-requests`)
      .set(customerAuth)
      .send({ serviceId, description: 'Built-in bookshelf.' })
      .expect(201);
    const jobRequestId = jobRes.body.id as string;

    const declineRes = await request(server)
      .post(`/v1/tenants/${tenantId}/job-requests/${jobRequestId}/decline`)
      .set(ownerAuth)
      .send({ reason: 'Outside our service area.' })
      .expect(201);
    expect(declineRes.body.status).toBe('declined');

    // A declined job request can no longer be quoted (it exists, but is
    // no longer in 'requested'/'quoted' status).
    await request(server)
      .post(`/v1/tenants/${tenantId}/job-requests/${jobRequestId}/quote`)
      .set(ownerAuth)
      .send({
        amountMinorUnits: 500_000,
        currencyCode: 'NGN',
        proposedStartsAt: new Date(Date.now() + 40_000_000).toISOString(),
        proposedEndsAt: new Date(Date.now() + 43_600_000).toISOString(),
        validUntil: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .expect(400);
  });
});

import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { DatabaseService } from '../../src/database/database.service';

/**
 * Phase 5's "Done when" scenario, end to end, against an in-memory fake
 * standing in for PostgreSQL (see booking.e2e-spec.ts for the same
 * approach): "Finance reconciles and resolves a dispute, and reports
 * match the ledger." Also covers the "dispute holds" test requirement
 * (a disputed booking's charge cannot be paid out while the dispute is
 * open) and listing moderation blocking new bookings on a suspended
 * service even though it is still 'published'.
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
}
interface FakeLedgerEntry {
  id: string;
  tenant_id: string;
  booking_id: string | null;
  type: string;
  amount_minor_units: number;
  currency_code: string;
  held_for_dispute_id: string | null;
}
interface FakeEscrowAccount {
  tenant_id: string;
  balance_minor_units: number;
  currency_code: string;
}
interface FakeDispute {
  id: string;
  tenant_id: string;
  booking_id: string;
  raised_by: string;
  reason: string;
  status: string;
  resolution_notes: string | null;
}
interface FakePayout {
  id: string;
  tenant_id: string;
  amount_minor_units: number;
  currency_code: string;
  status: string;
  requested_by: string;
  decision_notes: string | null;
}
interface FakeModerationAction {
  id: string;
  service_id: string;
  tenant_id: string;
  action: string;
  reason: string | null;
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

// administrator=6, finance_administrator=7 (migration 001's seed).
const TENANT_ROLE_CODES: Record<number, string> = { 1: 'owner', 2: 'staff' };

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd);
}

class FakeDatabaseService {
  tenants: FakeTenant[] = [];
  memberships: FakeMembership[] = [];
  services: FakeService[] = [];
  customers: FakeCustomer[] = [];
  bookings: FakeBooking[] = [];
  ledgerEntries: FakeLedgerEntry[] = [];
  escrowAccounts: FakeEscrowAccount[] = [];
  disputes: FakeDispute[] = [];
  payouts: FakePayout[] = [];
  moderationActions: FakeModerationAction[] = [];
  paymentIntents: FakePaymentIntent[] = [];
  platformRoleAssignments: { user_id: string; role_id: number }[] = [];
  idempotencyKeys: { key: string; user_id: string; request_hash: string; response_body: unknown }[] = [];
  nextId(_prefix: string): string {
    // CreateBookingDto.serviceId and friends are @IsUUID()-validated
    // against the real schema's gen_random_uuid() ids (the same gap
    // already fixed in booking.e2e-spec.ts's fake) — a sequential
    // 'service-1' string here made ValidationPipe 400 the booking
    // route the moment this suite was ever actually executed.
    return randomUUID();
  }

  assignPlatformRole(userId: string, roleId: 6 | 7) {
    this.platformRoleAssignments.push({ user_id: userId, role_id: roleId });
  }

  async query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
    const sql = text.replace(/\s+/g, ' ').trim();

    // PlatformPermissionGuard.
    if (sql.includes('platform_role_assignment')) {
      const [userId, permissionCode] = params as [string, string];
      const assignment = this.platformRoleAssignments.find((a) => a.user_id === userId);
      if (!assignment) return [] as unknown as T[];
      // Mirrors migration 005's real grants.
      const administratorGrants = ['verification.decide', 'dispute.view', 'dispute.resolve', 'listing.moderate', 'config.manage', 'report.view'];
      const financeGrants = ['dispute.view', 'refund.issue', 'payout.decide', 'report.view'];
      const grants = assignment.role_id === 6 ? administratorGrants : financeGrants;
      return (grants.includes(permissionCode) ? [{ code: permissionCode }] : []) as unknown as T[];
    }

    // TenantRoleGuard membership lookup.
    if (sql.startsWith('SELECT r.code AS role_code, m.status')) {
      const [tenantId, userId] = params as [string, string];
      const m = this.memberships.find((x) => x.tenant_id === tenantId && x.user_id === userId);
      return (m ? [{ role_code: TENANT_ROLE_CODES[m.role_id], status: m.status }] : []) as unknown as T[];
    }

    // TenantRoleGuard permission lookup: this fake grants owners
    // everything this suite exercises (booking.manage, payout.request).
    if (sql.startsWith('SELECT p.code')) {
      const [roleCode, permissionCode] = params as [string, string];
      return (roleCode === 'owner' ? [{ code: permissionCode }] : []) as unknown as T[];
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

function ledgerBalance(db: FakeDatabaseService, tenantId: string): number {
  let balance = 0;
  for (const e of db.ledgerEntries.filter((x) => x.tenant_id === tenantId)) {
    if (e.type === 'charge' && !e.held_for_dispute_id) balance += e.amount_minor_units;
    if (e.type === 'refund') balance -= e.amount_minor_units;
    if (e.type === 'payout') balance -= e.amount_minor_units;
  }
  return balance;
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
      return { rows: [{ id: tenant.id, name: params[0], category: params[2], country_code: params[1], verification_status: 'verified', status: 'active' }] };
    }

    if (sql.startsWith('INSERT INTO membership')) {
      const [tenantId, userId, roleId] = params as [string, string, number];
      this.db.memberships.push({ tenant_id: tenantId, user_id: userId, role_id: roleId, status: 'active' });
      return { rows: [{ id: this.db.nextId('membership') }] };
    }

    if (sql.startsWith('INSERT INTO service')) {
      const [tenantId, , categoryId, name] = params as [string, string, number, string];
      const service: FakeService = {
        id: this.db.nextId('service'),
        tenant_id: tenantId,
        status: 'draft',
        moderation_status: 'active',
        price_minor_units: Number(params[6]),
        currency_code: params[7] as string,
      };
      this.db.services.push(service);
      return { rows: [{ id: service.id, category_id: categoryId, name, status: 'draft', price_minor_units: service.price_minor_units, currency_code: service.currency_code }] };
    }

    if (sql.startsWith('UPDATE service SET status')) {
      const [serviceId, tenantId, status] = params as [string, string, string];
      const service = this.db.services.find((s) => s.id === serviceId && s.tenant_id === tenantId);
      if (!service) return { rows: [] };
      service.status = status;
      return { rows: [{ id: service.id, category_id: 1, name: 'svc', status, price_minor_units: service.price_minor_units, currency_code: service.currency_code }] };
    }

    if (sql.startsWith('SELECT id, status, moderation_status, price_minor_units, currency_code FROM service')) {
      const [serviceId, tenantId] = params as [string, string];
      const service = this.db.services.find((s) => s.id === serviceId && s.tenant_id === tenantId);
      return {
        rows: service
          ? [{ id: service.id, status: service.status, moderation_status: service.moderation_status, price_minor_units: service.price_minor_units, currency_code: service.currency_code }]
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

    if (sql.startsWith('INSERT INTO booking') && sql.includes('staff_user_id')) {
      const [tenantId, serviceId, customerId, , , startsAt, endsAt] = params as [string, string, string, string, string | null, string, string];
      const conflict = this.db.bookings.find(
        (b) => b.tenant_id === tenantId && b.service_id === serviceId && b.status !== 'cancelled' && overlaps(b.starts_at, b.ends_at, startsAt, endsAt),
      );
      if (conflict) throw Object.assign(new Error('overlapping booking'), { code: '23P01' });
      const booking: FakeBooking = { id: this.db.nextId('booking'), tenant_id: tenantId, service_id: serviceId, customer_id: customerId, status: 'confirmed', starts_at: startsAt, ends_at: endsAt };
      this.db.bookings.push(booking);
      return {
        rows: [
          { id: booking.id, tenant_id: tenantId, service_id: serviceId, customer_id: customerId, staff_user_id: null, status: 'confirmed', starts_at: startsAt, ends_at: endsAt, notes: null, cancellation_reason: null, policy_snapshot: {} },
        ],
      };
    }

    if (sql.startsWith('INSERT INTO ledger_entry')) {
      const [tenantId, bookingId, type, amountMinorUnits, currencyCode, , heldForDisputeId] = params as [
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
        held_for_dispute_id: heldForDisputeId ?? null,
      };
      this.db.ledgerEntries.push(entry);
      return { rows: [{ id: entry.id, tenant_id: tenantId, booking_id: entry.booking_id, type, amount_minor_units: entry.amount_minor_units, currency_code: currencyCode, fee_minor_units: 0, held_for_dispute_id: entry.held_for_dispute_id, created_at: new Date().toISOString() }] };
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

    // Phase 4: PaymentsService's payment_intent row, alongside every
    // ledger_entry inserted above (charge on booking, refund on
    // dispute resolution, payout on decide) — see payments.service.ts.
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

    // dispute.service.ts's raise().
    if (sql.startsWith('SELECT id, customer_id FROM booking WHERE id = $1 AND tenant_id = $2')) {
      const [bookingId, tenantId] = params as [string, string];
      const booking = this.db.bookings.find((b) => b.id === bookingId && b.tenant_id === tenantId);
      return { rows: booking ? [{ id: booking.id, customer_id: booking.customer_id }] : [] };
    }

    if (sql.startsWith('SELECT linked_user_id FROM customer_profile WHERE id = $1')) {
      const [customerId] = params as [string];
      const customer = this.db.customers.find((c) => c.id === customerId);
      return { rows: customer ? [{ linked_user_id: customer.linked_user_id }] : [] };
    }

    if (sql.startsWith("SELECT 1 FROM membership WHERE tenant_id = $1 AND user_id = $2 AND status = 'active'")) {
      const [tenantId, userId] = params as [string, string];
      const member = this.db.memberships.find((m) => m.tenant_id === tenantId && m.user_id === userId && m.status === 'active');
      return { rows: member ? [{ '?column?': 1 }] : [] };
    }

    if (sql.startsWith('INSERT INTO dispute')) {
      const [tenantId, bookingId, raisedBy, reason] = params as [string, string, string, string];
      const dispute: FakeDispute = { id: this.db.nextId('dispute'), tenant_id: tenantId, booking_id: bookingId, raised_by: raisedBy, reason, status: 'open', resolution_notes: null };
      this.db.disputes.push(dispute);
      return { rows: [{ id: dispute.id, tenant_id: tenantId, booking_id: bookingId, raised_by: raisedBy, reason, status: 'open', resolution_notes: null }] };
    }

    if (sql.startsWith("UPDATE ledger_entry SET held_for_dispute_id = $1 WHERE booking_id = $2 AND type = 'charge'")) {
      const [disputeId, bookingId] = params as [string, string];
      for (const e of this.db.ledgerEntries) {
        if (e.booking_id === bookingId && e.type === 'charge' && !e.held_for_dispute_id) e.held_for_dispute_id = disputeId;
      }
      return { rows: [] };
    }

    if (sql.startsWith('SELECT id, booking_id, status FROM dispute WHERE id = $1 AND tenant_id = $2')) {
      const [disputeId, tenantId] = params as [string, string];
      const dispute = this.db.disputes.find((d) => d.id === disputeId && d.tenant_id === tenantId);
      return { rows: dispute ? [{ id: dispute.id, booking_id: dispute.booking_id, status: dispute.status }] : [] };
    }

    if (sql.startsWith('SELECT id, amount_minor_units, currency_code FROM ledger_entry WHERE held_for_dispute_id = $1')) {
      const [disputeId] = params as [string];
      const held = this.db.ledgerEntries.filter((e) => e.held_for_dispute_id === disputeId);
      return { rows: held.map((e) => ({ id: e.id, amount_minor_units: e.amount_minor_units, currency_code: e.currency_code })) };
    }

    if (sql.startsWith('UPDATE ledger_entry SET held_for_dispute_id = NULL WHERE held_for_dispute_id = $1')) {
      const [disputeId] = params as [string];
      for (const e of this.db.ledgerEntries) {
        if (e.held_for_dispute_id === disputeId) e.held_for_dispute_id = null;
      }
      return { rows: [] };
    }

    if (sql.startsWith('UPDATE dispute SET status = $3')) {
      const [disputeId, tenantId, status, notes, resolvedBy] = params as [string, string, string, string | null, string];
      const dispute = this.db.disputes.find((d) => d.id === disputeId && d.tenant_id === tenantId);
      if (!dispute) return { rows: [] };
      dispute.status = status;
      dispute.resolution_notes = notes;
      void resolvedBy;
      return { rows: [{ id: dispute.id, tenant_id: tenantId, booking_id: dispute.booking_id, raised_by: dispute.raised_by, reason: dispute.reason, status, resolution_notes: notes }] };
    }

    // finance.service.ts's ledgerBalance() helper.
    if (sql.includes('FROM ledger_entry') && sql.includes('AS balance')) {
      const [tenantId] = params as [string];
      const entries = this.db.ledgerEntries.filter((e) => e.tenant_id === tenantId);
      return { rows: [{ currency_code: entries[0]?.currency_code ?? null, balance: ledgerBalance(this.db, tenantId) }] };
    }

    if (sql.startsWith("SELECT COALESCE(SUM(amount_minor_units), 0) AS pending FROM payout WHERE tenant_id = $1 AND status = 'requested'")) {
      const [tenantId] = params as [string];
      const pending = this.db.payouts.filter((p) => p.tenant_id === tenantId && p.status === 'requested').reduce((s, p) => s + p.amount_minor_units, 0);
      return { rows: [{ pending }] };
    }

    if (sql.startsWith('INSERT INTO payout')) {
      const [tenantId, amountMinorUnits, currencyCode, requestedBy] = params as [string, number, string, string];
      const payout: FakePayout = { id: this.db.nextId('payout'), tenant_id: tenantId, amount_minor_units: Number(amountMinorUnits), currency_code: currencyCode, status: 'requested', requested_by: requestedBy, decision_notes: null };
      this.db.payouts.push(payout);
      return { rows: [{ id: payout.id, tenant_id: tenantId, amount_minor_units: payout.amount_minor_units, currency_code: currencyCode, status: 'requested', requested_by: requestedBy, decision_notes: null }] };
    }

    if (sql.startsWith('SELECT id, amount_minor_units, currency_code, status FROM payout WHERE id = $1 AND tenant_id = $2')) {
      const [payoutId, tenantId] = params as [string, string];
      const payout = this.db.payouts.find((p) => p.id === payoutId && p.tenant_id === tenantId);
      return { rows: payout ? [{ id: payout.id, amount_minor_units: payout.amount_minor_units, currency_code: payout.currency_code, status: payout.status }] : [] };
    }

    if (sql.startsWith('UPDATE payout SET status = $3')) {
      const [payoutId, tenantId, status, decidedBy, notes] = params as [string, string, string, string, string | null];
      const payout = this.db.payouts.find((p) => p.id === payoutId && p.tenant_id === tenantId);
      if (!payout) return { rows: [] };
      payout.status = status;
      payout.decision_notes = notes;
      void decidedBy;
      return { rows: [{ id: payout.id, tenant_id: tenantId, amount_minor_units: payout.amount_minor_units, currency_code: payout.currency_code, status, requested_by: payout.requested_by, decision_notes: notes }] };
    }

    // finance.service.ts's reconciliationReport() totals.
    if (sql.includes('FROM ledger_entry') && sql.includes('total_charged')) {
      const [tenantId] = params as [string];
      const entries = this.db.ledgerEntries.filter((e) => e.tenant_id === tenantId);
      const sum = (type: string) => entries.filter((e) => e.type === type).reduce((s, e) => s + e.amount_minor_units, 0);
      return { rows: [{ currency_code: entries[0]?.currency_code ?? null, total_charged: sum('charge'), total_refunded: sum('refund'), total_paid_out: sum('payout') }] };
    }

    if (sql.startsWith('SELECT balance_minor_units, currency_code FROM escrow_account WHERE tenant_id = $1')) {
      const [tenantId] = params as [string];
      const account = this.db.escrowAccounts.find((a) => a.tenant_id === tenantId);
      return { rows: account ? [{ balance_minor_units: account.balance_minor_units, currency_code: account.currency_code }] : [] };
    }

    if (sql.startsWith("UPDATE service SET moderation_status = 'suspended'")) {
      const [serviceId, tenantId] = params as [string, string];
      const service = this.db.services.find((s) => s.id === serviceId && s.tenant_id === tenantId);
      if (!service) return { rows: [] };
      service.moderation_status = 'suspended';
      return { rows: [{ id: service.id }] };
    }

    if (sql.startsWith("UPDATE service SET moderation_status = 'active'")) {
      const [serviceId, tenantId] = params as [string, string];
      const service = this.db.services.find((s) => s.id === serviceId && s.tenant_id === tenantId);
      if (!service) return { rows: [] };
      service.moderation_status = 'active';
      return { rows: [{ id: service.id }] };
    }

    if (sql.startsWith('INSERT INTO listing_moderation_action')) {
      const [serviceId, tenantId, action, reason] = params as [string, string, string, string | null];
      const entry: FakeModerationAction = { id: this.db.nextId('modaction'), service_id: serviceId, tenant_id: tenantId, action, reason: reason ?? null };
      this.db.moderationActions.push(entry);
      return { rows: [{ id: entry.id, service_id: serviceId, action, reason: entry.reason }] };
    }

    // Falls through to FakeDatabaseService.query() for anything this
    // tenant-scoped client doesn't special-case itself — in particular
    // TenantRoleGuard's own membership/role_permission lookups, which
    // now run through `client.query()` (see tenant-role.guard.ts's own
    // comment for why: an unscoped connection can never see an
    // RLS-protected row once RLS is actually enforced). Without this,
    // every TenantRoleGuard-protected route would 403 here, since this
    // class's own branches never modeled those two lookups.
    return { rows: await this.db.query(text, params) };
  }
}

describe('Admin & finance (e2e)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let fakeDb: FakeDatabaseService;

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
    fakeDb = moduleRef.get(DatabaseService) as unknown as FakeDatabaseService;
  });

  afterAll(async () => {
    await app.close();
  });

  async function tokenFor(userId: string): Promise<string> {
    return jwt.signAsync({ sub: userId }, { secret: process.env.JWT_SECRET, expiresIn: '15m' });
  }

  it('dispute raise -> hold -> resolve(resolved_customer) refunds, and the reconciliation report matches the ledger', async () => {
    const server = app.getHttpServer();
    const ownerId = 'owner-1';
    const customerId = 'customer-1';
    const adminId = 'admin-1';
    fakeDb.assignPlatformRole(adminId, 6);
    const ownerAuth = { Authorization: `Bearer ${await tokenFor(ownerId)}` };
    const customerAuth = { Authorization: `Bearer ${await tokenFor(customerId)}` };
    const adminAuth = { Authorization: `Bearer ${await tokenFor(adminId)}` };

    const businessRes = await request(server).post('/v1/tenants').set(ownerAuth).send({ name: 'Dispute Test Salon', category: 'barber_salon', countryCode: 'NG' }).expect(201);
    const tenantId = businessRes.body.id as string;

    const serviceRes = await request(server)
      .post(`/v1/tenants/${tenantId}/services`)
      .set(ownerAuth)
      .send({ categoryId: 1, name: 'Haircut', priceMinorUnits: 500000, currencyCode: 'NGN', durationMinutes: 30 })
      .expect(201);
    const serviceId = serviceRes.body.id as string;
    await request(server).patch(`/v1/tenants/${tenantId}/services/${serviceId}/status`).set(ownerAuth).send({ status: 'published' }).expect(200);

    const startsAt = new Date(Date.now() + 3_600_000).toISOString();
    const endsAt = new Date(Date.now() + 5_400_000).toISOString();
    const bookingRes = await request(server)
      .post(`/v1/tenants/${tenantId}/bookings`)
      .set({ ...customerAuth, 'Idempotency-Key': 'dispute-booking-1' })
      .send({ serviceId, startsAt, endsAt })
      .expect(201);
    const bookingId = bookingRes.body.id as string;

    // A non-admin, non-party stranger cannot resolve a dispute (proves
    // PlatformPermissionGuard actually gates the route).
    const disputeRes = await request(server)
      .post(`/v1/tenants/${tenantId}/bookings/${bookingId}/disputes`)
      .set(customerAuth)
      .send({ reason: 'Service was not as described.' })
      .expect(201);
    const disputeId = disputeRes.body.id as string;
    expect(disputeRes.body.status).toBe('open');

    await request(server)
      .post(`/v1/tenants/${tenantId}/disputes/${disputeId}/resolve`)
      .set(ownerAuth)
      .send({ resolution: 'resolved_customer' })
      .expect(403);

    // While the dispute is open, the booking's charge is held: a
    // payout request for the full charged amount should still be
    // possible for OTHER money, but here the entire balance is held,
    // so the tenant has nothing payable yet.
    await request(server).post(`/v1/tenants/${tenantId}/payouts`).set(ownerAuth).send({ amountMinorUnits: 500000, currencyCode: 'NGN' }).expect(400);

    const resolveRes = await request(server)
      .post(`/v1/tenants/${tenantId}/disputes/${disputeId}/resolve`)
      .set(adminAuth)
      .send({ resolution: 'resolved_customer', notes: 'Refunded in full.' })
      .expect(201);
    expect(resolveRes.body.status).toBe('resolved_customer');

    const reportRes = await request(server).get(`/v1/tenants/${tenantId}/finance/reconciliation`).set(adminAuth).expect(200);
    expect(reportRes.body.totalChargedMinorUnits).toBe(500000);
    expect(reportRes.body.totalRefundedMinorUnits).toBe(500000);
    expect(reportRes.body.expectedBalanceMinorUnits).toBe(0);
    expect(reportRes.body.escrowBalanceMinorUnits).toBe(0);
    expect(reportRes.body.reconciled).toBe(true);
  });

  it('payout request -> decide(paid) reduces the escrow balance, and the report still reconciles', async () => {
    const server = app.getHttpServer();
    const ownerId = 'owner-2';
    const customerId = 'customer-2';
    const financeId = 'finance-1';
    fakeDb.assignPlatformRole(financeId, 7);
    const ownerAuth = { Authorization: `Bearer ${await tokenFor(ownerId)}` };
    const customerAuth = { Authorization: `Bearer ${await tokenFor(customerId)}` };
    const financeAuth = { Authorization: `Bearer ${await tokenFor(financeId)}` };

    const businessRes = await request(server).post('/v1/tenants').set(ownerAuth).send({ name: 'Payout Test Salon', category: 'barber_salon', countryCode: 'NG' }).expect(201);
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
    await request(server)
      .post(`/v1/tenants/${tenantId}/bookings`)
      .set({ ...customerAuth, 'Idempotency-Key': 'payout-booking-1' })
      .send({ serviceId, startsAt, endsAt })
      .expect(201);

    // Owner (not finance) cannot decide their own payout.
    const payoutRes = await request(server).post(`/v1/tenants/${tenantId}/payouts`).set(ownerAuth).send({ amountMinorUnits: 200000, currencyCode: 'NGN' }).expect(201);
    const payoutId = payoutRes.body.id as string;

    await request(server).post(`/v1/tenants/${tenantId}/payouts/${payoutId}/decide`).set(ownerAuth).send({ decision: 'paid' }).expect(403);

    const decideRes = await request(server).post(`/v1/tenants/${tenantId}/payouts/${payoutId}/decide`).set(financeAuth).send({ decision: 'paid' }).expect(201);
    expect(decideRes.body.status).toBe('paid');

    const reportRes = await request(server).get(`/v1/tenants/${tenantId}/finance/reconciliation`).set(financeAuth).expect(200);
    expect(reportRes.body.totalChargedMinorUnits).toBe(200000);
    expect(reportRes.body.totalPaidOutMinorUnits).toBe(200000);
    expect(reportRes.body.expectedBalanceMinorUnits).toBe(0);
    expect(reportRes.body.escrowBalanceMinorUnits).toBe(0);
    expect(reportRes.body.reconciled).toBe(true);
  });

  it('a suspended listing rejects new bookings even though it is still published, and reinstating restores it', async () => {
    const server = app.getHttpServer();
    const ownerId = 'owner-3';
    const customerId = 'customer-3';
    const adminId = 'admin-2';
    fakeDb.assignPlatformRole(adminId, 6);
    const ownerAuth = { Authorization: `Bearer ${await tokenFor(ownerId)}` };
    const customerAuth = { Authorization: `Bearer ${await tokenFor(customerId)}` };
    const adminAuth = { Authorization: `Bearer ${await tokenFor(adminId)}` };

    const businessRes = await request(server).post('/v1/tenants').set(ownerAuth).send({ name: 'Moderation Test Salon', category: 'barber_salon', countryCode: 'NG' }).expect(201);
    const tenantId = businessRes.body.id as string;

    const serviceRes = await request(server)
      .post(`/v1/tenants/${tenantId}/services`)
      .set(ownerAuth)
      .send({ categoryId: 1, name: 'Manicure', priceMinorUnits: 150000, currencyCode: 'NGN', durationMinutes: 30 })
      .expect(201);
    const serviceId = serviceRes.body.id as string;
    await request(server).patch(`/v1/tenants/${tenantId}/services/${serviceId}/status`).set(ownerAuth).send({ status: 'published' }).expect(200);

    await request(server)
      .post(`/v1/tenants/${tenantId}/services/${serviceId}/moderation/suspend`)
      .set(adminAuth)
      .send({ reason: 'Reported for misleading photos.' })
      .expect(201);

    const startsAt = new Date(Date.now() + 15_000_000).toISOString();
    const endsAt = new Date(Date.now() + 15_900_000).toISOString();
    await request(server)
      .post(`/v1/tenants/${tenantId}/bookings`)
      .set({ ...customerAuth, 'Idempotency-Key': 'moderation-booking-1' })
      .send({ serviceId, startsAt, endsAt })
      .expect(400);

    await request(server).post(`/v1/tenants/${tenantId}/services/${serviceId}/moderation/reinstate`).set(adminAuth).send({}).expect(201);

    await request(server)
      .post(`/v1/tenants/${tenantId}/bookings`)
      .set({ ...customerAuth, 'Idempotency-Key': 'moderation-booking-2' })
      .send({ serviceId, startsAt, endsAt })
      .expect(201);
  });
});

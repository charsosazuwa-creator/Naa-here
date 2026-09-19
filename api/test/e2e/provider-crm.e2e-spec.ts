import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { DatabaseService } from '../../src/database/database.service';

/**
 * Exercises Phase 2's "Done when" criterion end to end (design section
 * 11): a provider registers a business, submits a verification
 * document, an administrator approves it, and only then can they
 * publish a bookable service — publishing before approval is rejected.
 *
 * Uses an in-memory fake in place of PostgreSQL, the same approach as
 * test/e2e/auth.e2e-spec.ts, since this suite runs without a live
 * database. It intentionally re-implements the one database trigger
 * this flow depends on (publish requires a verified tenant) so the
 * fake enforces the same rule migration 002 enforces for real.
 */

interface FakeTenant {
  id: string;
  name: string;
  country_code: string;
  category: string;
  verification_status: string;
}
interface FakeMembership {
  tenant_id: string;
  user_id: string;
  role_id: number;
  status: string;
}
interface FakeAttachment {
  id: string;
  tenant_id: string | null;
  scan_status: string;
}
interface FakeVerification {
  id: string;
  tenant_id: string;
  status: string;
}
interface FakeService {
  id: string;
  tenant_id: string;
  name: string;
  status: string;
}

const ROLE_CODES: Record<number, string> = { 1: 'owner', 2: 'staff', 3: 'artisan', 4: 'host', 6: 'administrator' };

class FakeDatabaseService {
  tenants: FakeTenant[] = [];
  memberships: FakeMembership[] = [];
  attachments: FakeAttachment[] = [];
  verifications: FakeVerification[] = [];
  services: FakeService[] = [];
  // Platform staff (administrator=6, finance_administrator=7,
  // support_agent=5) are assigned via platform_role_assignment, not
  // per-tenant membership — see migration 005 and
  // platform-permission.guard.ts.
  platformRoleAssignments: { user_id: string; role_id: number }[] = [];

  registerAdmin(userId: string) {
    this.platformRoleAssignments.push({ user_id: userId, role_id: 6 });
  }

  async query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
    const sql = text.replace(/\s+/g, ' ').trim();

    // PlatformPermissionGuard's platform_role_assignment + role_permission
    // lookup. This fake only needs to reproduce migration 005's real
    // grant this suite exercises: administrator (role 6) carries
    // verification.decide (granted back in migration 002 as well).
    if (sql.includes('platform_role_assignment')) {
      const [userId, permissionCode] = params as [string, string];
      const isAdmin = this.platformRoleAssignments.some((a) => a.user_id === userId && a.role_id === 6);
      const granted = isAdmin && permissionCode === 'verification.decide';
      return (granted ? [{ code: permissionCode }] : []) as unknown as T[];
    }

    // TenantRoleGuard's membership + role lookup (called directly on
    // DatabaseService, not through withTenant, since it runs before
    // any tenant transaction is opened).
    if (sql.startsWith('SELECT r.code AS role_code, m.status')) {
      const [tenantId, userId] = params as [string, string];
      const membership = this.memberships.find((m) => m.tenant_id === tenantId && m.user_id === userId);
      return (membership ? [{ role_code: ROLE_CODES[membership.role_id], status: membership.status }] : []) as unknown as T[];
    }

    // MediaService's own membership check (upload isn't behind TenantRoleGuard).
    if (sql.startsWith('SELECT status FROM membership')) {
      const [tenantId, userId] = params as [string, string];
      const membership = this.memberships.find((m) => m.tenant_id === tenantId && m.user_id === userId);
      return (membership ? [{ status: membership.status }] : []) as unknown as T[];
    }

    // TenantRoleGuard's role_permission lookup. This fake grants every
    // permission this suite exercises to 'owner' and 'artisan', and
    // none to a bare 'staff' or 'stranger' — enough to prove the guard
    // wires through correctly without re-encoding the whole migration
    // 002 permission matrix here. verification.decide is a platform
    // permission now (matched above, before this branch runs), not a
    // tenant-role one, so it's never granted here.
    if (sql.startsWith('SELECT p.code')) {
      const [roleCode, permissionCode] = params as [string, string];
      const ownerLikeRoles = ['owner', 'artisan', 'host'];
      const granted = ownerLikeRoles.includes(roleCode);
      return (granted ? [{ code: permissionCode }] : []) as unknown as T[];
    }

    return [] as unknown as T[];
  }

  async withTenant<T>(tenantId: string, fn: (client: unknown) => Promise<T>): Promise<T> {
    const client = new FakeTenantClient(this, tenantId);
    return fn(client as unknown as never);
  }

  async withTransaction<T>(fn: (client: unknown) => Promise<T>): Promise<T> {
    const client = new FakeTenantClient(this, null);
    return fn(client as unknown as never);
  }

  // business.service.ts's listForUser() — "my businesses" (GET
  // /v1/tenants/mine), added for the provider portal. Runs under
  // withUser(), not withTenant(), for exactly the reason migration 007
  // explains: no single tenantId is known yet.
  async withUser<T>(_userId: string, fn: (client: unknown) => Promise<T>): Promise<T> {
    const client = new FakeTenantClient(this, null);
    return fn(client as unknown as never);
  }

  async onModuleDestroy(): Promise<void> {
    /* no-op */
  }

  nextId(_prefix: string): string {
    // Same fix as the other e2e fakes: several DTOs (@IsUUID()) are
    // validated against real gen_random_uuid() ids, so a sequential
    // 'tenant-1' string here would 400 every route that takes one of
    // these ids back as input.
    return randomUUID();
  }
}

/** Mimics pg's PoolClient.query({rows}) shape against the fake in-memory store, scoped to one tenant like RLS would be. */
class FakeTenantClient {
  constructor(
    private readonly db: FakeDatabaseService,
    private readonly tenantId: string | null,
  ) {}

  async query(text: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> {
    const sql = text.replace(/\s+/g, ' ').trim();

    if (sql.startsWith('INSERT INTO tenant')) {
      const [name, countryCode, category] = params as [string, string, string];
      const tenant: FakeTenant = { id: this.db.nextId('tenant'), name, country_code: countryCode, category, verification_status: 'unverified' };
      this.db.tenants.push(tenant);
      return { rows: [{ id: tenant.id, name: params[0], category, country_code: countryCode, description: null, contact_phone: null, contact_email: null, verification_status: 'unverified', status: 'active' }] };
    }

    if (sql.startsWith('INSERT INTO membership')) {
      const [tenantId, userId, roleId] = params as [string, string, number];
      this.db.memberships.push({ tenant_id: tenantId, user_id: userId, role_id: roleId, status: 'active' });
      return { rows: [{ id: this.db.nextId('membership') }] };
    }

    if (sql.startsWith('INSERT INTO attachment')) {
      const attachment: FakeAttachment = { id: this.db.nextId('attachment'), tenant_id: this.tenantId, scan_status: 'clean' };
      this.db.attachments.push(attachment);
      return { rows: [{ id: attachment.id, tenant_id: attachment.tenant_id, content_type: params[3], byte_size: params[4], scan_status: 'clean', scan_reason: null }] };
    }

    if (sql.startsWith('SELECT id, tenant_id, content_type, byte_size, scan_status, scan_reason FROM attachment')) {
      const [attachmentId] = params as [string];
      const attachment = this.db.attachments.find((a) => a.id === attachmentId);
      return { rows: attachment ? [{ id: attachment.id, tenant_id: attachment.tenant_id, content_type: 'application/pdf', byte_size: 1024, scan_status: attachment.scan_status, scan_reason: null }] : [] };
    }

    if (sql.startsWith('INSERT INTO verification_submission')) {
      const [tenantId] = params as [string];
      const submission: FakeVerification = { id: this.db.nextId('verification'), tenant_id: tenantId, status: 'pending' };
      this.db.verifications.push(submission);
      return { rows: [{ id: submission.id, document_type: params[2], attachment_id: params[3], status: 'pending', decision_note: null }] };
    }

    if (sql.startsWith("UPDATE tenant SET verification_status = 'pending'")) {
      const [tenantId] = params as [string];
      const tenant = this.db.tenants.find((t) => t.id === tenantId);
      if (tenant) tenant.verification_status = 'pending';
      return { rows: [] };
    }

    if (sql.startsWith('UPDATE verification_submission')) {
      const [submissionId, , decision] = params as [string, string, string];
      const submission = this.db.verifications.find((v) => v.id === submissionId && v.status === 'pending');
      if (!submission) return { rows: [] };
      submission.status = decision;
      return { rows: [{ id: submission.id, document_type: 'business_registration', attachment_id: 'irrelevant', status: decision, decision_note: params[3] }] };
    }

    if (sql.startsWith('UPDATE tenant SET verification_status = $2')) {
      const [tenantId, status] = params as [string, string];
      const tenant = this.db.tenants.find((t) => t.id === tenantId);
      if (tenant) tenant.verification_status = status;
      return { rows: [] };
    }

    if (sql.startsWith('INSERT INTO service')) {
      const [tenantId, , , name] = params as [string, string, number, string];
      const service: FakeService = { id: this.db.nextId('service'), tenant_id: tenantId, name, status: 'draft' };
      this.db.services.push(service);
      return {
        rows: [
          {
            id: service.id,
            category_id: params[2],
            location_id: params[1],
            name,
            description: params[4],
            duration_minutes: params[5],
            price_minor_units: params[6],
            currency_code: params[7],
            status: 'draft',
          },
        ],
      };
    }

    // business.service.ts's listForUser() — GET /v1/tenants/mine.
    if (sql.startsWith('SELECT t.id, t.name, t.category, t.country_code')) {
      const [userId] = params as [string];
      const roleCodes: Record<number, string> = { 1: 'owner', 2: 'staff', 3: 'artisan', 4: 'host' };
      const mine = this.db.memberships
        .filter((m) => m.user_id === userId && m.status === 'active')
        .map((m) => {
          const tenant = this.db.tenants.find((t) => t.id === m.tenant_id);
          return tenant
            ? {
                id: tenant.id,
                name: tenant.name,
                category: tenant.category,
                country_code: tenant.country_code,
                description: null,
                contact_phone: null,
                contact_email: null,
                verification_status: tenant.verification_status,
                status: 'active',
                role_code: roleCodes[m.role_id],
              }
            : null;
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);
      return { rows: mine };
    }

    if (sql.startsWith('UPDATE service SET status')) {
      const [serviceId, tenantId, status] = params as [string, string, string];
      const service = this.db.services.find((s) => s.id === serviceId && s.tenant_id === tenantId);
      if (!service) return { rows: [] };

      // Re-implements the database trigger from migration 002: a
      // service cannot become 'published' unless its tenant is verified.
      if (status === 'published') {
        const tenant = this.db.tenants.find((t) => t.id === tenantId);
        if (tenant?.verification_status !== 'verified') {
          throw new Error(`Cannot publish a service for a tenant that is not verified (tenant ${tenantId}).`);
        }
      }

      service.status = status;
      return { rows: [{ id: service.id, category_id: 1, location_id: null, name: service.name, description: null, duration_minutes: 30, price_minor_units: 500000, currency_code: 'NGN', status }] };
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

describe('Provider CRM flow (e2e)', () => {
  let app: INestApplication;
  let fakeDb: FakeDatabaseService;
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

    fakeDb = moduleRef.get(DatabaseService) as unknown as FakeDatabaseService;
    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  // Signed the same way SessionService does: HS256 with JWT_SECRET, sub = userId.
  async function tokenFor(userId: string): Promise<string> {
    return jwt.signAsync({ sub: userId }, { secret: process.env.JWT_SECRET, expiresIn: '15m' });
  }

  it('a provider cannot publish before verification, and can once approved', async () => {
    const server = app.getHttpServer();
    const ownerId = 'owner-user-1';
    const adminId = 'admin-user-1';
    fakeDb.registerAdmin(adminId);

    const ownerAuth = { Authorization: `Bearer ${await tokenFor(ownerId)}` };
    const adminAuth = { Authorization: `Bearer ${await tokenFor(adminId)}` };

    const businessRes = await request(server)
      .post('/v1/tenants')
      .set(ownerAuth)
      .send({ name: 'Chidi Cuts', category: 'barber_salon', countryCode: 'NG' })
      .expect(201);
    const tenantId = businessRes.body.id as string;

    const uploadRes = await request(server)
      .post('/v1/media')
      .set(ownerAuth)
      .send({ storageKey: 'uploads/business-cert.pdf', contentType: 'application/pdf', byteSize: 2048, tenantId })
      .expect(201);
    const attachmentId = uploadRes.body.id as string;

    const serviceRes = await request(server)
      .post(`/v1/tenants/${tenantId}/services`)
      .set(ownerAuth)
      .send({ categoryId: 1, name: 'Classic haircut', priceMinorUnits: 500000, currencyCode: 'NGN', durationMinutes: 30 })
      .expect(201);
    const serviceId = serviceRes.body.id as string;

    // Publishing before verification is rejected.
    await request(server)
      .patch(`/v1/tenants/${tenantId}/services/${serviceId}/status`)
      .set(ownerAuth)
      .send({ status: 'published' })
      .expect(400);

    const submissionRes = await request(server)
      .post(`/v1/tenants/${tenantId}/verification`)
      .set(ownerAuth)
      .send({ documentType: 'business_registration', attachmentId })
      .expect(201);
    const submissionId = submissionRes.body.id as string;

    await request(server)
      .post(`/v1/tenants/${tenantId}/verification/${submissionId}/decide`)
      .set(adminAuth)
      .send({ decision: 'approved' })
      .expect(201);

    const publishRes = await request(server)
      .patch(`/v1/tenants/${tenantId}/services/${serviceId}/status`)
      .set(ownerAuth)
      .send({ status: 'published' })
      .expect(200);
    expect(publishRes.body.status).toBe('published');
  });

  it('rejects a non-member trying to act on someone else\'s business', async () => {
    const server = app.getHttpServer();
    const ownerId = 'owner-user-2';
    const strangerId = 'stranger-user-1';

    const businessRes = await request(server)
      .post('/v1/tenants')
      .set({ Authorization: `Bearer ${await tokenFor(ownerId)}` })
      .send({ name: 'Lagos Stays', category: 'accommodation', countryCode: 'NG' })
      .expect(201);

    await request(server)
      .post(`/v1/tenants/${businessRes.body.id}/services`)
      .set({ Authorization: `Bearer ${await tokenFor(strangerId)}` })
      .send({ categoryId: 2, name: 'Studio apartment', priceMinorUnits: 2000000, currencyCode: 'NGN' })
      .expect(403);
  });

  it('GET /tenants/mine lists only the businesses this user is an active member of', async () => {
    const server = app.getHttpServer();
    const ownerId = 'owner-user-3';
    const otherOwnerId = 'owner-user-4';
    const ownerAuth = { Authorization: `Bearer ${await tokenFor(ownerId)}` };

    const mineBusiness = await request(server)
      .post('/v1/tenants')
      .set(ownerAuth)
      .send({ name: 'Accra Braids', category: 'barber_salon', countryCode: 'GH' })
      .expect(201);

    // A business owned by someone else should not show up.
    await request(server)
      .post('/v1/tenants')
      .set({ Authorization: `Bearer ${await tokenFor(otherOwnerId)}` })
      .send({ name: 'Someone Else\'s Salon', category: 'barber_salon', countryCode: 'GH' })
      .expect(201);

    const mineRes = await request(server).get('/v1/tenants/mine').set(ownerAuth).expect(200);
    expect(mineRes.body).toHaveLength(1);
    expect(mineRes.body[0]).toMatchObject({ id: mineBusiness.body.id, name: 'Accra Braids', roleCode: 'owner' });
  });
});

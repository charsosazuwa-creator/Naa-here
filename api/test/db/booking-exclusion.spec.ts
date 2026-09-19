import { Pool, PoolClient } from 'pg';

/**
 * Needs a real PostgreSQL database with every migration applied,
 * DATABASE_URL pointing at the `app_runtime` role (see
 * tenant-isolation.spec.ts's header comment for why that matters).
 *
 * This is the direct test for the "Done when: no double booking under
 * load" criterion (design section 11, phase 3): it fires two
 * overlapping INSERTs concurrently at the database and checks that
 * exactly one succeeds — proving the EXCLUDE constraint, not an
 * application-level check that could itself race, is what prevents
 * the double booking.
 *
 * customer_profile, service and booking are all RLS-protected on
 * tenant_id, and app_runtime (unlike the migration-owning role) is
 * genuinely subject to that — a bare pool.query() with no tenant
 * context set fails closed with "new row violates row-level security
 * policy" the instant it actually runs against a real database (never
 * caught before this suite had ever executed). Fixed by doing every
 * tenant-scoped query through one dedicated client that has
 * `app.tenant_id` set once, session-wide — the same session var
 * DatabaseService.withTenant() sets per-request in the real app — plus
 * a second, separately-scoped client for the genuine two-connection
 * concurrency test at the end.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

async function tenantScopedClient(pool: Pool, tenantId: string): Promise<PoolClient> {
  const client = await pool.connect();
  await client.query('SET app.tenant_id = $1', [tenantId]);
  return client;
}

describeIfDb('booking table: EXCLUDE constraint prevents double booking', () => {
  let pool: Pool;
  let client: PoolClient;
  let tenantId: string;
  let serviceId: string;
  let customerId: string;
  let userId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });

    // tenant and app_user carry no RLS policy, so these two inserts run
    // fine on any app_runtime connection before a tenant context exists.
    const { rows: tenants } = await pool.query(
      `INSERT INTO tenant (name, country_code, category, verification_status)
       VALUES ('Exclusion Test Salon', 'NG', 'barber_salon', 'verified') RETURNING id`,
    );
    tenantId = tenants[0].id;

    const { rows: users } = await pool.query(
      `INSERT INTO app_user (email, password_hash, full_name, status)
       VALUES ('booking-test-customer@example.com', 'x', 'Test Customer', 'active') RETURNING id`,
    );
    userId = users[0].id;

    // Everything from here on touches an RLS-protected table, so it
    // goes through this one tenant-scoped client instead of the bare pool.
    client = await tenantScopedClient(pool, tenantId);

    const { rows: customers } = await client.query(
      `INSERT INTO customer_profile (tenant_id, linked_user_id, full_name, created_by)
       VALUES ($1, $2, 'Test Customer', $2) RETURNING id`,
      [tenantId, userId],
    );
    customerId = customers[0].id;

    const { rows: services } = await client.query(
      `INSERT INTO service (tenant_id, category_id, name, price_minor_units, currency_code, status)
       VALUES ($1, 1, 'Haircut', 500000, 'NGN', 'published') RETURNING id`,
      [tenantId],
    );
    serviceId = services[0].id;
  });

  afterAll(async () => {
    await client.query(`DELETE FROM booking WHERE tenant_id = $1`, [tenantId]);
    await client.query(`DELETE FROM service WHERE tenant_id = $1`, [tenantId]);
    await client.query(`DELETE FROM customer_profile WHERE tenant_id = $1`, [tenantId]);
    client.release();
    await pool.query(`DELETE FROM app_user WHERE id = $1`, [userId]);
    await pool.query(`DELETE FROM tenant WHERE id = $1`, [tenantId]);
    await pool.end();
  });

  it('rejects a second booking that overlaps an existing one for the same service', async () => {
    const startsAt = new Date(Date.now() + 3_600_000).toISOString();
    const endsAt = new Date(Date.now() + 5_400_000).toISOString();

    await client.query(
      `INSERT INTO booking (tenant_id, service_id, customer_id, created_by, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tenantId, serviceId, customerId, userId, startsAt, endsAt],
    );

    // Fully overlapping.
    await expect(
      client.query(
        `INSERT INTO booking (tenant_id, service_id, customer_id, created_by, starts_at, ends_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tenantId, serviceId, customerId, userId, startsAt, endsAt],
      ),
    ).rejects.toMatchObject({ code: '23P01' });

    // Partially overlapping (starts 15 minutes into the first booking).
    const partialStart = new Date(Date.now() + 3_600_000 + 900_000).toISOString();
    const partialEnd = new Date(Date.now() + 7_200_000).toISOString();
    await expect(
      client.query(
        `INSERT INTO booking (tenant_id, service_id, customer_id, created_by, starts_at, ends_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tenantId, serviceId, customerId, userId, partialStart, partialEnd],
      ),
    ).rejects.toMatchObject({ code: '23P01' });
  });

  it('allows a back-to-back booking that does not overlap (ends_at of one equals starts_at of the next)', async () => {
    const firstStart = new Date(Date.now() + 10_800_000).toISOString();
    const firstEnd = new Date(Date.now() + 12_600_000).toISOString();
    const secondEnd = new Date(Date.now() + 14_400_000).toISOString();

    await client.query(
      `INSERT INTO booking (tenant_id, service_id, customer_id, created_by, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tenantId, serviceId, customerId, userId, firstStart, firstEnd],
    );

    await expect(
      client.query(
        `INSERT INTO booking (tenant_id, service_id, customer_id, created_by, starts_at, ends_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tenantId, serviceId, customerId, userId, firstEnd, secondEnd],
      ),
    ).resolves.toBeDefined();
  });

  it('allows overlapping bookings once the first is cancelled', async () => {
    const startsAt = new Date(Date.now() + 18_000_000).toISOString();
    const endsAt = new Date(Date.now() + 19_800_000).toISOString();

    const { rows } = await client.query(
      `INSERT INTO booking (tenant_id, service_id, customer_id, created_by, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [tenantId, serviceId, customerId, userId, startsAt, endsAt],
    );

    await client.query(`UPDATE booking SET status = 'cancelled' WHERE id = $1`, [rows[0].id]);

    await expect(
      client.query(
        `INSERT INTO booking (tenant_id, service_id, customer_id, created_by, starts_at, ends_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tenantId, serviceId, customerId, userId, startsAt, endsAt],
      ),
    ).resolves.toBeDefined();
  });

  it('the two-concurrent-inserts race: exactly one of two simultaneous overlapping bookings succeeds', async () => {
    const startsAt = new Date(Date.now() + 25_200_000).toISOString();
    const endsAt = new Date(Date.now() + 27_000_000).toISOString();

    // Two genuinely separate connections, each with their own
    // app.tenant_id set, so the race is a real one at the database
    // layer — not serialized onto the single `client` the other tests
    // share.
    const clientA = await tenantScopedClient(pool, tenantId);
    const clientB = await tenantScopedClient(pool, tenantId);
    const insert = (c: PoolClient) =>
      c.query(
        `INSERT INTO booking (tenant_id, service_id, customer_id, created_by, starts_at, ends_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tenantId, serviceId, customerId, userId, startsAt, endsAt],
      );

    try {
      const results = await Promise.allSettled([insert(clientA), insert(clientB)]);
      const succeeded = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter((r) => r.status === 'rejected');

      expect(succeeded.length).toBe(1);
      expect(failed.length).toBe(1);
    } finally {
      clientA.release();
      clientB.release();
    }
  });
});

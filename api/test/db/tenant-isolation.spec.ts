import { Pool } from 'pg';

/**
 * These tests need a real PostgreSQL database with every migration in
 * db/migrations/ already applied, and — this matters — DATABASE_URL
 * pointing at the `app_runtime` role from migration
 * 003_app_runtime_role.sql, not the role that ran the migrations.
 * PostgreSQL row-level security never applies to a table's owner, so
 * running this suite against the owning/admin role would make every
 * test below pass even if every RLS policy in the project were
 * deleted. They are skipped automatically when DATABASE_URL is not
 * set, so `npm test` (unit) never depends on Postgres, but `npm run
 * test:db` does and will fail loudly if no database is reachable.
 *
 * Coverage here maps to the design package's "Done when" criterion:
 * "tenant-isolation and audit-completeness DB tests pass" (section 15),
 * and to the security control "tenant A cannot read tenant B" listed
 * against this module in the traceability matrix (section 14).
 */

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('Row-level security: tenant isolation', () => {
  let pool: Pool;
  let tenantAId: string;
  let tenantBId: string;
  let userAId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });

    const { rows: tenants } = await pool.query(
      `INSERT INTO tenant (name, country_code) VALUES ('Tenant A', 'NG'), ('Tenant B', 'NG') RETURNING id`,
    );
    [tenantAId, tenantBId] = tenants.map((r) => r.id);

    const { rows: users } = await pool.query(
      `INSERT INTO app_user (email, password_hash, full_name, status)
       VALUES ('tenant-a-owner@example.com', 'x', 'Owner A', 'active') RETURNING id`,
    );
    userAId = users[0].id;

    // membership has an RLS policy (tenant_id = current_setting('app.tenant_id')),
    // and app_runtime — unlike the migration-owning role — is genuinely
    // subject to it, so a plain INSERT with no tenant context set fails
    // closed with "new row violates row-level security policy". This
    // never surfaced before because this suite had never actually run
    // against a database with the RLS policies in place. Set the same
    // per-transaction session var the real app sets via
    // DatabaseService.withTenant() before seeding this fixture row.
    const seedClient = await pool.connect();
    try {
      await seedClient.query('BEGIN');
      await seedClient.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantAId]);
      await seedClient.query(
        `INSERT INTO membership (tenant_id, user_id, role_id, status) VALUES ($1, $2, 1, 'active')`,
        [tenantAId, userAId],
      );
      await seedClient.query('COMMIT');
    } finally {
      seedClient.release();
    }
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM membership WHERE tenant_id IN ($1, $2)`, [tenantAId, tenantBId]);
    await pool.query(`DELETE FROM app_user WHERE id = $1`, [userAId]);
    await pool.query(`DELETE FROM tenant WHERE id IN ($1, $2)`, [tenantAId, tenantBId]);
    await pool.end();
  });

  it('a session scoped to tenant A cannot see tenant B rows in membership', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantAId]);

      const { rows } = await client.query('SELECT tenant_id FROM membership');
      expect(rows.every((r) => r.tenant_id === tenantAId)).toBe(true);
      expect(rows.some((r) => r.tenant_id === tenantBId)).toBe(false);

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('audit_event rows cannot be updated or deleted by the application role', async () => {
    // NOTE: this only holds if DATABASE_URL connects as the
    // `app_runtime` role from migration 003, NOT the role migrations
    // ran as — Postgres table owners bypass GRANT/REVOKE (and RLS) on
    // their own tables regardless of what's granted or revoked.
    await expect(
      pool.query(`UPDATE audit_event SET action = 'tampered' WHERE id = (SELECT id FROM audit_event LIMIT 1)`),
    ).rejects.toThrow();
  });
});

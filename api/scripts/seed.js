#!/usr/bin/env node
/**
 * Seeds a baseline set of dev/QA fixtures: one verified business with
 * two published, bookable services (weekly hours already configured),
 * a provider owner account, and a customer account — all with known
 * credentials, printed at the end.
 *
 * This exists because signing up through the app itself to get to a
 * useful starting point is slow (mock email/SMS verification code has
 * to be read from a log each time) and because the three originally
 * seeded demo listings were found, during QA, to have no weekly hours
 * configured at all (a data gap, not a code bug — see the Oct 2026 QA
 * bug report) — this script seeds hours from the start so a freshly
 * seeded environment is actually bookable immediately.
 *
 * Connects as an admin/owner role (same DATABASE_URL you'd run
 * migrations with), not app_runtime — it needs to bypass RLS to seed
 * data for a tenant before any request has set app.tenant_id.
 *
 * Safe to re-run: skips entirely (with a message) if the demo
 * provider account already exists.
 *
 * Usage:
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/marketplace_dev \
 *   node scripts/seed.js
 */

const { Client } = require('pg');
const argon2 = require('argon2');

const DEMO_PASSWORD = 'DemoPass123!'; // letters + digits, 8+ chars — passes the app's own password-strength rule
const PROVIDER_EMAIL = 'demo-provider@naahere.test';
const PROVIDER_PHONE = '+2348000000001';
const CUSTOMER_EMAIL = 'demo-customer@naahere.test';
const CUSTOMER_PHONE = '+2348000000002';

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[seed] ${msg}`);
}

function sslOption() {
  return process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('[seed] DATABASE_URL is not set. Point it at an admin/owner role, not app_runtime.');
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl, ssl: sslOption() });
  await client.connect();

  try {
    const { rows: existing } = await client.query('SELECT id FROM app_user WHERE email = $1', [PROVIDER_EMAIL]);
    if (existing.length > 0) {
      log(`Already seeded (found ${PROVIDER_EMAIL}) — skipping. Delete that account first to reseed.`);
      return;
    }

    const passwordHash = await argon2.hash(DEMO_PASSWORD);

    log('Creating business category + tenant...');
    const { rows: catRows } = await client.query(
      `SELECT id FROM business_category WHERE code = 'barber_salon'`,
    );
    if (catRows.length === 0) {
      throw new Error(
        "No 'barber_salon' business_category found — have migrations been applied? (npm run db:migrate)",
      );
    }
    const categoryId = catRows[0].id;

    const { rows: tenantRows } = await client.query(
      `INSERT INTO tenant (name, country_code, category_id, business_type, verification_status, description, contact_phone, contact_email)
       VALUES ('Demo Salon', 'NG', $1, 'provider', 'verified', 'Seeded demo business for local dev/QA.', $2, $3)
       RETURNING id`,
      [categoryId, PROVIDER_PHONE, PROVIDER_EMAIL],
    );
    const tenantId = tenantRows[0].id;

    const { rows: locationRows } = await client.query(
      `INSERT INTO location (tenant_id, label, address_line, city, country_code, is_primary)
       VALUES ($1, 'Main branch', '1 Demo Street', 'Lagos', 'NG', true)
       RETURNING id`,
      [tenantId],
    );
    const locationId = locationRows[0].id;

    log('Creating provider owner account...');
    const { rows: providerRows } = await client.query(
      `INSERT INTO app_user (email, phone, password_hash, full_name, status, email_verified_at, phone_verified_at)
       VALUES ($1, $2, $3, 'Demo Provider', 'active', now(), now())
       RETURNING id`,
      [PROVIDER_EMAIL, PROVIDER_PHONE, passwordHash],
    );
    const providerUserId = providerRows[0].id;

    // RLS on membership requires app.tenant_id to be set for this
    // session before the insert — see business.service.ts's own
    // comment on this exact point.
    await client.query('SELECT set_config($1, $2, false)', ['app.tenant_id', tenantId]);
    await client.query(
      `INSERT INTO membership (tenant_id, user_id, role_id, status) VALUES ($1, $2, 1, 'active')`, // role_id 1 = owner
      [tenantId, providerUserId],
    );

    log('Creating customer account...');
    const { rows: customerRows } = await client.query(
      `INSERT INTO app_user (email, phone, password_hash, full_name, status, email_verified_at, phone_verified_at)
       VALUES ($1, $2, $3, 'Demo Customer', 'active', now(), now())
       RETURNING id`,
      [CUSTOMER_EMAIL, CUSTOMER_PHONE, passwordHash],
    );

    log('Creating services with weekly availability (Mon–Fri 9am–5pm)...');
    const services = [
      { name: 'Haircut', durationMinutes: 45, priceMinorUnits: 500000 }, // NGN 5,000
      { name: 'Beard Trim', durationMinutes: 20, priceMinorUnits: 200000 }, // NGN 2,000
    ];
    for (const svc of services) {
      const { rows: serviceRows } = await client.query(
        `INSERT INTO service (tenant_id, location_id, category_id, name, duration_minutes, price_minor_units, currency_code, status)
         VALUES ($1, $2, 1, $3, $4, $5, 'NGN', 'published')
         RETURNING id`,
        // category_id here is service_category.id (smallint, 1 = barber_salon) — a separate, older
        // lookup table from business_category above; see db/migrations/002 vs 018.
        [tenantId, locationId, svc.name, svc.durationMinutes, svc.priceMinorUnits],
      );
      const serviceId = serviceRows[0].id;

      for (let day = 1; day <= 5; day += 1) {
        // 0 = Sunday .. 6 = Saturday (see db/migrations/002's CHECK constraint)
        await client.query(
          `INSERT INTO availability_rule (tenant_id, service_id, day_of_week, start_time, end_time)
           VALUES ($1, $2, $3, '09:00', '17:00')`,
          [tenantId, serviceId, day],
        );
      }
      log(`  - ${svc.name}: published, Mon-Fri 9am-5pm`);
    }

    log('');
    log('Seed complete. Sign in with:');
    log(`  Provider — email: ${PROVIDER_EMAIL}  phone: ${PROVIDER_PHONE}  password: ${DEMO_PASSWORD}`);
    log(`  Customer — email: ${CUSTOMER_EMAIL}  phone: ${CUSTOMER_PHONE}  password: ${DEMO_PASSWORD}`);
    log('Both accounts are already verified — no code to read from the log, sign in directly.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[seed] FAILED:', err);
  process.exit(1);
});

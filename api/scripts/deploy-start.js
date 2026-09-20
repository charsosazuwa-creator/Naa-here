#!/usr/bin/env node
/**
 * Render's startCommand entry point (see ../../render.yaml).
 *
 * Render's buildCommand only builds the API (`cd api && npm ci && npm
 * run build`) — this script is what actually brings the service up.
 * It mirrors what launcher/start.js does for the local one-click demo
 * (same migrations, same app_runtime role switch), but against
 * Render's managed Postgres instead of an embedded one:
 *
 *   1. Connects as the admin/owner role Render's DATABASE_URL supplies
 *      and applies any db/migrations/*.sql not yet recorded in
 *      _naa_here_migrations (idempotent, so redeploys are safe).
 *   2. Sets the app_runtime role's password from APP_RUNTIME_PASSWORD.
 *      The API must never connect as the owner role — Postgres row-
 *      level security silently does not apply to a table's owner, so
 *      running migrations and serving traffic as the same role would
 *      make every RLS policy in db/migrations a no-op (see
 *      db/migrations/003_app_runtime_role.sql for the full story).
 *   3. Starts the built API (dist/main.js) with DATABASE_URL rewritten
 *      to connect as app_runtime instead of the owner role.
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { Client } = require('pg');

const API_DIR = path.join(__dirname, '..');
const DB_DIR = path.join(__dirname, '..', '..', 'db', 'migrations');

// Nest's tsconfig here outputs to dist/src/main.js, not dist/main.js
// (rootDir: '.' in api/tsconfig.json includes both src/ and test/ in
// the compiled tree) - same two candidates launcher/start.js checks
// for the local demo.
function findMain() {
  const candidates = [
    path.join(API_DIR, 'dist', 'main.js'),
    path.join(API_DIR, 'dist', 'src', 'main.js'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[deploy-start] ${msg}`);
}

function sslOption() {
  // Matches DatabaseService: Render's managed Postgres presents a
  // certificate not in Node's default trust store.
  return process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined;
}

function withRuntimeCredentials(databaseUrl, password) {
  const url = new URL(databaseUrl);
  url.username = 'app_runtime';
  url.password = password;
  return url.toString();
}

async function applyMigrations(databaseUrl) {
  const client = new Client({ connectionString: databaseUrl, ssl: sslOption() });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _naa_here_migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const { rows: already } = await client.query('SELECT filename FROM _naa_here_migrations');
    const appliedSet = new Set(already.map((r) => r.filename));

    const files = fs.readdirSync(DB_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      if (appliedSet.has(f)) {
        log(`Migration already applied: ${f}`);
        continue;
      }
      log(`Applying migration: ${f}`);
      const sql = fs.readFileSync(path.join(DB_DIR, f), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO _naa_here_migrations (filename) VALUES ($1)', [f]);
    }
  } finally {
    await client.end();
  }
}

/**
 * Bootstrap problem: the admin/verification console (and anything
 * else behind PlatformPermissionGuard) needs at least one user to
 * hold the 'administrator' platform role, but platform_role_assignment
 * (migration 005) starts empty and nothing in the app itself can grant
 * a role to someone with no role — there's no "first admin" signup
 * flow, on purpose (self-service platform-admin signup would be a
 * real security hole). Instead: PLATFORM_ADMIN_EMAILS (comma-
 * separated) names who should hold it, and this runs on every start,
 * same as applyMigrations — idempotent (ON CONFLICT DO NOTHING, same
 * as migration 005's own backfill), connected as the admin/owner role
 * so it bypasses RLS same as migrations do. If someone listed hasn't
 * signed up yet, it just logs and moves on; the next deploy or
 * restart after they do sign up picks it up automatically, no manual
 * SQL required.
 */
async function grantBootstrapAdmins(databaseUrl) {
  const emailsRaw = process.env.PLATFORM_ADMIN_EMAILS;
  if (!emailsRaw || !emailsRaw.trim()) {
    return;
  }
  const emails = emailsRaw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (emails.length === 0) {
    return;
  }

  const client = new Client({ connectionString: databaseUrl, ssl: sslOption() });
  await client.connect();
  try {
    for (const email of emails) {
      const { rows } = await client.query('SELECT id FROM app_user WHERE lower(email) = $1', [email]);
      if (rows.length === 0) {
        log(`PLATFORM_ADMIN_EMAILS: no account yet for ${email} — will grant automatically once they sign up.`);
        continue;
      }
      // role_id 6 = administrator (see db/migrations/005_admin_finance.sql).
      await client.query(
        `INSERT INTO platform_role_assignment (user_id, role_id) VALUES ($1, 6) ON CONFLICT DO NOTHING`,
        [rows[0].id],
      );
      log(`Ensured administrator platform role for ${email}.`);
    }
  } finally {
    await client.end();
  }
}

async function setRuntimePassword(databaseUrl, password) {
  const client = new Client({ connectionString: databaseUrl, ssl: sslOption() });
  await client.connect();
  try {
    // ALTER ROLE doesn't take the password as a query parameter, so it
    // has to be interpolated — this value comes from Render's own
    // generateValue secret, not user input, but single quotes are
    // still escaped defensively.
    const escaped = password.replace(/'/g, "''");
    await client.query(`ALTER ROLE app_runtime WITH PASSWORD '${escaped}'`);
  } finally {
    await client.end();
  }
}

function startApi(databaseUrl) {
  const mainFile = findMain();
  if (!mainFile) {
    throw new Error(
      'Build finished but dist/main.js (or dist/src/main.js) was not found. Did the build step run?',
    );
  }
  log(`Starting the API on port ${process.env.PORT || 3000}...`);
  const child = spawn(process.execPath, [mainFile], {
    cwd: API_DIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
    },
  });
  child.on('exit', (code, signal) => {
    process.exit(code ?? (signal ? 1 : 0));
  });
}

async function main() {
  const adminDatabaseUrl = process.env.DATABASE_URL;
  const appRuntimePassword = process.env.APP_RUNTIME_PASSWORD;

  if (!adminDatabaseUrl) {
    throw new Error('DATABASE_URL is not set.');
  }
  if (!appRuntimePassword) {
    throw new Error('APP_RUNTIME_PASSWORD is not set.');
  }

  log('Applying database migrations...');
  await applyMigrations(adminDatabaseUrl);

  log('Checking PLATFORM_ADMIN_EMAILS...');
  await grantBootstrapAdmins(adminDatabaseUrl);

  log('Setting app_runtime role password...');
  await setRuntimePassword(adminDatabaseUrl, appRuntimePassword);

  const runtimeDatabaseUrl = withRuntimeCredentials(adminDatabaseUrl, appRuntimePassword);
  startApi(runtimeDatabaseUrl);
}

main().catch((err) => {
  console.error('[deploy-start] Failed:', err);
  process.exit(1);
});

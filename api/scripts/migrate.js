#!/usr/bin/env node
/**
 * Standalone migration runner for local dev and CI.
 *
 * Applies any db/migrations/*.sql not yet recorded in
 * _naa_here_migrations (idempotent — safe to run repeatedly), then,
 * if APP_RUNTIME_PASSWORD is set, sets the app_runtime role's
 * password so the API (or a test suite) can connect as it.
 *
 * This duplicates the handful of lines deploy-start.js uses to do the
 * same thing against Render's managed Postgres (see that file for the
 * production path) — kept as its own script, rather than having
 * deploy-start.js import it, so this stays a pure additive tool for
 * local dev / CI and never risks changing what actually runs in
 * production. If you touch the migration-application logic here,
 * check whether deploy-start.js needs the same fix.
 *
 * Usage:
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/marketplace_dev \
 *   APP_RUNTIME_PASSWORD=devpassword \
 *   node scripts/migrate.js
 *
 * DATABASE_URL here must be an admin/owner role (whatever ran `CREATE
 * DATABASE`), never app_runtime itself — see db/migrations/003 and
 * api/.env.example for why.
 */

const path = require('path');
const fs = require('fs');
const { Client } = require('pg');

const DB_DIR = path.join(__dirname, '..', '..', 'db', 'migrations');

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[migrate] ${msg}`);
}

function sslOption() {
  return process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined;
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
    let appliedCount = 0;
    for (const f of files) {
      if (appliedSet.has(f)) {
        log(`Already applied: ${f}`);
        continue;
      }
      log(`Applying: ${f}`);
      const sql = fs.readFileSync(path.join(DB_DIR, f), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO _naa_here_migrations (filename) VALUES ($1)', [f]);
      appliedCount += 1;
    }
    log(`Done. ${appliedCount} new migration(s) applied, ${files.length} total.`);
  } finally {
    await client.end();
  }
}

async function setRuntimePassword(databaseUrl, password) {
  const client = new Client({ connectionString: databaseUrl, ssl: sslOption() });
  await client.connect();
  try {
    const escaped = password.replace(/'/g, "''");
    await client.query(`ALTER ROLE app_runtime WITH PASSWORD '${escaped}'`);
    log('Set app_runtime role password.');
  } finally {
    await client.end();
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('[migrate] DATABASE_URL is not set. Point it at an admin/owner role, not app_runtime.');
    process.exit(1);
  }

  await applyMigrations(databaseUrl);

  const appRuntimePassword = process.env.APP_RUNTIME_PASSWORD;
  if (appRuntimePassword) {
    await setRuntimePassword(databaseUrl, appRuntimePassword);
  } else {
    log('APP_RUNTIME_PASSWORD not set — skipping app_runtime password step.');
  }
}

main().catch((err) => {
  console.error('[migrate] FAILED:', err);
  process.exit(1);
});

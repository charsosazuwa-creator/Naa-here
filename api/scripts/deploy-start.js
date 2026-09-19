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
const MAIN_FILE = path.join(API_DIR, 'dist', 'main.js');

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
  log(`Starting the API on port ${process.env.PORT || 3000}...`);
  const child = spawn(process.execPath, [MAIN_FILE], {
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

  log('Setting app_runtime role password...');
  await setRuntimePassword(adminDatabaseUrl, appRuntimePassword);

  const runtimeDatabaseUrl = withRuntimeCredentials(adminDatabaseUrl, appRuntimePassword);
  startApi(runtimeDatabaseUrl);
}

main().catch((err) => {
  console.error('[deploy-start] Failed:', err);
  process.exit(1);
});

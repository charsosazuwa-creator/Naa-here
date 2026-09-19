#!/usr/bin/env node
/**
 * One-click runner for the Naa here demo.
 *
 * Starts an embedded (self-contained, no-install-required) PostgreSQL,
 * applies the real migrations, starts the real NestJS API against it,
 * and serves the real static web front end — all on your own machine,
 * reachable from your own browser. No Docker, no system Postgres
 * install, nothing sent anywhere over the network.
 *
 * Usage: node start.js   (or just double-click start.bat / start.sh)
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const API_DIR = path.join(ROOT, 'api');
const DB_DIR = path.join(ROOT, 'db', 'migrations');
const DATA_DIR = path.join(__dirname, 'pgdata');

const PG_PORT = 55433;
const API_PORT = 3000;

function log(msg) {
  console.log(`[naa-here] ${msg}`);
}

function run(cmd, args, cwd) {
  log(`Running: ${cmd} ${args.join(' ')} (in ${cwd})`);
  const res = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (res.status !== 0) {
    throw new Error(`Command failed (exit ${res.status}): ${cmd} ${args.join(' ')}`);
  }
}

function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) {
    console.error(`Node.js 18 or newer is required. You have ${process.version}.`);
    console.error('Install a current Node.js from https://nodejs.org and try again.');
    process.exit(1);
  }
  log(`Node.js ${process.version} OK.`);
}

function ensureDeps(dir, label) {
  const nodeModules = path.join(dir, 'node_modules');
  if (!fs.existsSync(nodeModules)) {
    log(`Installing ${label} dependencies (first run only, this can take a few minutes)...`);
    run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install'], dir);
  } else {
    log(`${label} dependencies already installed.`);
  }
}

function buildApi() {
  const distMain = findMain();
  if (distMain) {
    log('API already built, skipping build step.');
    return distMain;
  }
  log('Building the API (nest build)...');
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], API_DIR);
  const built = findMain();
  if (!built) {
    throw new Error('Build finished but dist/main.js (or dist/src/main.js) was not found.');
  }
  return built;
}

function findMain() {
  const candidates = [
    path.join(API_DIR, 'dist', 'main.js'),
    path.join(API_DIR, 'dist', 'src', 'main.js'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

async function startPostgres() {
  // eslint-disable-next-line import/no-extraneous-dependencies
  const EmbeddedPostgres = require(path.join(__dirname, 'node_modules', 'embedded-postgres')).default;
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: 'postgres',
    password: 'postgres',
    port: PG_PORT,
    persistent: true,
  });

  const alreadyInit = fs.existsSync(path.join(DATA_DIR, 'PG_VERSION'));
  if (!alreadyInit) {
    log('Initialising embedded Postgres (first run only)...');
    await pg.initialise();
  }
  log('Starting embedded Postgres...');
  await pg.start();
  return pg;
}

async function applyMigrationsIfNeeded(appRuntimePassword) {
  const { Client } = require(path.join(__dirname, 'node_modules', 'pg'));

  const admin = new Client({
    host: 'localhost',
    port: PG_PORT,
    user: 'postgres',
    password: 'postgres',
    database: 'postgres',
  });
  await admin.connect();
  try {
    await admin.query('CREATE DATABASE marketplace_dev');
    log('Created database marketplace_dev.');
  } catch (e) {
    if (!/already exists/i.test(e.message)) throw e;
  }
  await admin.end();

  const db = new Client({
    host: 'localhost',
    port: PG_PORT,
    user: 'postgres',
    password: 'postgres',
    database: 'marketplace_dev',
  });
  await db.connect();

  await db.query(`
    CREATE TABLE IF NOT EXISTS _naa_here_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const { rows: already } = await db.query('SELECT filename FROM _naa_here_migrations');
  const appliedSet = new Set(already.map((r) => r.filename));

  const files = fs.readdirSync(DB_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (appliedSet.has(f)) {
      log(`Migration already applied: ${f}`);
      continue;
    }
    log(`Applying migration: ${f}`);
    const sql = fs.readFileSync(path.join(DB_DIR, f), 'utf8');
    await db.query(sql);
    await db.query('INSERT INTO _naa_here_migrations (filename) VALUES ($1)', [f]);
  }

  // Give the app's runtime role a known password so the API can log
  // in as it (see db/migrations/003_app_runtime_role.sql — this role
  // is what makes row-level security actually apply).
  await db.query(`ALTER ROLE app_runtime WITH PASSWORD '${appRuntimePassword}'`);

  await db.end();
}

function startApi(mainFile, secrets) {
  log(`Starting the API on http://localhost:${API_PORT} ...`);
  const child = spawn(process.execPath, [mainFile], {
    cwd: API_DIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(API_PORT),
      DATABASE_URL: `postgres://app_runtime:${secrets.appRuntimePassword}@localhost:${PG_PORT}/marketplace_dev`,
      JWT_SECRET: secrets.jwtSecret,
      JWT_ACCESS_TOKEN_TTL_SECONDS: '900',
      REFRESH_TOKEN_TTL_DAYS: '30',
      VERIFICATION_CODE_TTL_MINUTES: '15',
      VERIFICATION_CODE_MAX_ATTEMPTS: '5',
      LOGIN_MAX_FAILED_ATTEMPTS: '5',
      LOGIN_LOCKOUT_MINUTES: '15',
      // Same-origin now that the API serves web/ itself (see
      // api/src/main.ts's static-asset serving) — no CORS needed, same
      // as the production default.
      CORS_ALLOWED_ORIGINS: '',
      PAYMENT_WEBHOOK_SECRET: secrets.paymentWebhookSecret,
    },
  });
  return child;
}

function openBrowser(url) {
  const platform = process.platform;
  try {
    if (platform === 'win32') {
      spawn('cmd', ['/c', 'start', '""', url], { stdio: 'ignore', detached: true }).unref();
    } else if (platform === 'darwin') {
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    } else {
      spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
    }
  } catch (e) {
    log(`Could not auto-open a browser (${e.message}). Open ${url} manually.`);
  }
}

async function main() {
  checkNode();
  ensureDeps(__dirname, 'launcher');
  ensureDeps(API_DIR, 'API');
  const mainFile = buildApi();

  const secretsFile = path.join(__dirname, '.secrets.json');
  let secrets;
  if (fs.existsSync(secretsFile)) {
    secrets = JSON.parse(fs.readFileSync(secretsFile, 'utf8'));
  } else {
    secrets = {
      appRuntimePassword: crypto.randomBytes(16).toString('hex'),
      jwtSecret: crypto.randomBytes(32).toString('hex'),
      paymentWebhookSecret: crypto.randomBytes(32).toString('hex'),
    };
    fs.writeFileSync(secretsFile, JSON.stringify(secrets, null, 2));
  }

  const pg = await startPostgres();
  await applyMigrationsIfNeeded(secrets.appRuntimePassword);

  // The API serves the web/ front end itself now (see
  // api/src/main.ts), so there's just one server and one origin —
  // matching how this same code runs on a real deployment.
  const apiChild = startApi(mainFile, secrets);

  // Give the API a moment to come up before opening the browser.
  setTimeout(() => {
    const url = `http://localhost:${API_PORT}/`;
    log(`Opening ${url} in your browser...`);
    openBrowser(url);
    log('');
    log('Everything is running. Sign up for a new account to try it out.');
    log('Press Ctrl+C in this window to stop the demo.');
  }, 2500);

  const shutdown = async () => {
    log('Shutting down...');
    apiChild.kill();
    try {
      await pg.stop();
    } catch (e) {
      // ignore
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[naa-here] FAILED:', err);
  process.exit(1);
});

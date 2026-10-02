# Dev / QA environment

How to develop, test, and QA this app before anything reaches
production. There are three tiers:

| Tier | What it is | URL |
|---|---|---|
| **Local dev** | Your own machine, your own database, hot-reload | `http://localhost:3000` |
| **QA / staging** | A real deployment, shared, for manual + future automated QA | `https://test.naahere.com` |
| **Production** | The real thing | `https://naahere.com` (via Render) |

Code moves left to right: write and test locally → push → CI gate →
manually deploy to QA and click through the change → manually deploy
to production.

---

## 1. Local dev

Two ways to run the app locally, for two different purposes.

### Option A — "just run it" (no code changes)

```
node launcher/start.js
```
(or double-click `start.bat` / run `./start.sh`). This is the
one-click demo already in this repo: embedded Postgres, migrations
applied automatically, the real API, opens your browser. Good for
clicking through the app or reproducing a bug report. See the root
`README.md` for details. Data persists in `launcher/pgdata/` between
runs.

### Option B — active development (hot reload)

The launcher always rebuilds and runs the compiled API, which is slow
to iterate on. For actual coding:

1. Get a Postgres database running. Easiest if you already have
   Postgres installed:
   ```
   createdb marketplace_dev
   ```
   Don't have Postgres installed? The simplest path is still the
   launcher above — run it once to let it set up and migrate an
   embedded Postgres on port `55433`, then stop it (Ctrl+C) and reuse
   that same database for the steps below instead of running your own.
2. Copy `api/.env.example` to `api/.env` and fill in `DATABASE_URL`
   (your admin/owner connection for now — see step 3).
3. Apply migrations and set up the `app_runtime` role:
   ```
   cd api
   DATABASE_URL=postgres://postgres:postgres@localhost:5432/marketplace_dev \
   APP_RUNTIME_PASSWORD=devpassword \
   npm run db:migrate
   ```
   Then update `api/.env`'s `DATABASE_URL` to connect as `app_runtime`
   with that same password (see the comment in `.env.example` for why
   it must be this role, not the one that ran migrations).
4. Seed some starting data (a verified demo business with two
   bookable services, a provider account, a customer account):
   ```
   DATABASE_URL=postgres://postgres:postgres@localhost:5432/marketplace_dev \
   npm run db:seed
   ```
   Prints the demo accounts' credentials when it finishes. Safe to
   re-run — it skips if already seeded.
5. Run the API with hot reload:
   ```
   npm run start:dev
   ```
6. Open `http://localhost:3000/provider/login.html` (or
   `/customer/index.html`) and sign in with the seeded demo account.

---

## 2. Automated tests

Three layers, each catching something different:

| Command | What it checks | Needs a database? |
|---|---|---|
| `npm test` (in `api/`) | Business logic in isolation (password rules, booking state machine, guards) | No |
| `npm run test:db` (in `api/`) | Row-level security (tenant isolation) and the double-booking exclusion constraint — things that only a real Postgres enforces | Yes, real Postgres |
| `npm run test:e2e` (in `api/`) | HTTP routes end to end, against an in-memory fake database | No |
| `npm test` (in `e2e-smoke/`) | The actual app in a real browser (Playwright) | Yes, a running app |

Run `npm run lint` and `npm run build` in `api/` too — both are part
of the CI gate (below).

### Known test gaps

**`api/test/e2e/*.e2e-spec.ts` — stale since migration 018.** Three of
the four e2e spec files (`provider-crm`, `booking`, `admin-finance`)
send business-creation requests shaped like
`{ name, category: 'barber_salon', countryCode }`. Migration
`018_open_categories.sql` replaced that flat `category` text column
with `tenant.category_id` (a lookup into a new `business_category`
table) and a separate required `tenant.business_type` field — the real
API now expects `{ name, businessType: 'provider', categoryName:
'barber_salon', countryCode }` (see
`api/src/modules/tenancy/dto/create-business.dto.ts`). These specs'
in-memory fake-database layer was never updated for that shape change,
so most of their tests currently fail — not flaky, just wrong against
today's contract. `auth.e2e-spec.ts` has one additional, unrelated
failure (a verification-code logging-capture assertion) not yet root
caused.

This was found, not introduced, while setting up this Dev/QA
environment — apparently nobody had run `npm run test:e2e` since
migration 018 landed (there was no CI to catch it). CI runs this suite
so the exact failure count stays visible, but with `continue-on-error`
so it doesn't block merges. Fixing it means updating each spec's fake
`query()` handler to understand `business_category` lookups (by code,
case-insensitive-ish via `slugify()` in
`business-category.service.ts`) and updating every
`.send({ ..., category: '<x>' ... })` call site to the new shape —
`category: 'artisan'` → `businessType: 'artisan', categoryName:
'artisan'`; everything else → `businessType: 'provider', categoryName:
'<x>'`.

The `api/test/db/*.spec.ts` suite (RLS, booking exclusion) had the
same kind of staleness and has already been fixed as part of this
work — see git history for `tenant-isolation.spec.ts` and
`booking-exclusion.spec.ts` if you want the pattern for the e2e fix
above.

---

## 3. CI

`.github/workflows/ci.yml` runs on every push and PR to `main`:

- **`api` job**: install → lint → build → unit tests → spin up a real
  Postgres → migrate → db tests (blocking) → e2e tests (non-blocking,
  see above).
- **`smoke` job**: builds the API, migrates + seeds a fresh database,
  boots the API, runs the Playwright smoke suite against it
  (non-blocking until it's proven itself reliable over a few runs —
  then remove `continue-on-error` from that job).

CI does **not** deploy anything. It's a gate before QA/production, not
a pipeline to them.

---

## 4. QA / staging (test.naahere.com)

This is a real Render deployment of the same `render.yaml` blueprint,
on its own custom domain. Use it for:

- Manual click-through QA before a production deploy — see the
  Oct 2026 QA bug report (ask for a copy, or regenerate one following
  the same approach: sign up by phone — email signup needs
  `EMAIL_PROVIDER=resend` configured with a verified domain, see bug
  #1 in that report — then exercise the flow you changed, in both the
  customer and provider portals).
- Running `e2e-smoke` against a real deployment:
  ```
  cd e2e-smoke
  BASE_URL=https://test.naahere.com npm test
  ```
  Only works for flows that don't depend on `db:seed` fixtures unless
  you've also run `db:seed` against that environment's actual
  database (ask whoever holds its `DATABASE_URL` — it's set via the
  Render dashboard, not committed, same as production's).

**Deploys are manual.** Pushing to `main` does not redeploy
`test.naahere.com` or production by itself — go to the Render
dashboard for the relevant service and click "Manual Deploy" →
"Deploy latest commit" once CI is green.

---

## 5. Production

Same deploy process as QA, against the production Render service and
`naahere.com`. Always go through QA first for anything beyond a
trivial fix — there's no automated gate between QA and production
(by design: a human click is the last checkpoint).

Production secrets (`RESEND_API_KEY`, `GOOGLE_CLIENT_SECRET`,
`PLATFORM_ADMIN_EMAILS`, etc.) live only in the Render dashboard's
environment variables, never in this repo — see the comments in
`render.yaml` for what each one does and where to get it.

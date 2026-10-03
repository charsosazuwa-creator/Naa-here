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
   bookable services, a provider account, a customer account, and a
   platform administrator account):
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
6. Open `http://localhost:3000/provider/login.html`
   (`/customer/index.html`, or `/admin/login.html`) and sign in with
   the matching seeded demo account.

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

---

## 6. Reports & the reporting Agent

A "Platform summary" (cross-tenant, admin-only) and a "Business
performance" report (any one tenant — an admin can generate it for
any business, a provider only for their own) are available on demand
from the Admin Console's Reports tab and the provider portal's Reports
tab. See `db/migrations/026_admin_agent_reports.sql` and
`api/src/modules/reports/` for the full design.

Every report is generated and recorded under a service account — the
"Agent" (`reporting-agent@naahere.internal`, `status = 'disabled'` so
it can never actually sign in) — assigned the same `administrator`
platform role a human admin would hold, via `platform_role_assignment`
like any other platform staff member. A human admin or provider's
click is what triggers a run; the resulting `report_run` row's
`generated_by` is always the Agent, `requested_by` is always the human
who clicked. There is no scheduler yet — on-demand only, by design for
this first version; a cron-driven nightly run is a natural next step
if it's wanted later.

**Two real bugs found while building and verifying this feature** (not
introduced by it — found because this was the first time anyone had
actually loaded the Admin Console's rendered pages with a browser
rather than just reading the code):

1. `@RequirePermission(...)` placed at the **controller class** level,
   rather than on each `@Get`/`@Post` handler, is invisible to both
   `TenantRoleGuard` and `PlatformPermissionGuard` — they only read it
   off `context.getHandler()`. A route like this silently 403s on
   every single request, in every environment, forever: this was true
   of `CrmController`, `TenantCustomerInvitationController`, and
   `DisputeAdminController` (meaning the Admin Console's Disputes tab
   has never actually been able to load its queue). All three are
   fixed now — `@RequirePermission` applied per-handler, matching
   every other controller. If you add a new controller, put
   `@RequirePermission` on each method, not the class.
2. The Admin Console's tab bar (`<nav class="admin-tabs">`) rendered
   as a column of full-height pill buttons instead of a row — `.shell`
   is a `display: flex` row built for the provider portal's sidebar
   layout, and the admin page's extra in-flow child (the tabs nav,
   where provider/customer no-tenant pages only ever had one) was
   getting the same row/stretch treatment. Fixed in
   `web/provider/app.css`'s `body.no-tenant .shell` rule.

Both are a reminder: this app has no automated visual/rendering checks
for the Admin Console (the Playwright smoke suite only covers customer
and provider so far — see `e2e-smoke/tests/reports.spec.ts` for admin
coverage added alongside this feature). A page that's never actually
been looked at can be broken for a long time without anyone noticing.

### The Agent's moderation review (advisory only)

The Agent also attaches an advisory recommendation to each item in the
two provider-submission moderation queues (marketplace listings and
business verification): a `looks_ready` / `needs_attention` flag plus
specific reasons, shown as a badge and a reasons list next to each
pending item in the Admin Console. See
`api/src/modules/moderation-assist/moderation-assist.service.ts`.

This is deliberately **read-only and rule-based** — a human still has
to click Approve/Reject on every item; the Agent never calls
`decide()` on anything itself. The rules are simple, explainable
checks (missing description, no photos, an implausible-looking email
or phone, a zero price where one's required, etc.), not a model call,
so every recommendation is reproducible from the same input with no
external dependency. If a richer, model-backed version is ever wanted,
`marketplace/ai-search.service.ts`'s natural-language search is the
existing pattern for that in this codebase (optional
`ANTHROPIC_API_KEY`, graceful fallback when it's unset).

---

## 7. Email verification is disabled at signup

A deliberate product decision, not a bug: an **email** signup
(`POST /v1/auth/register` with `email` set) is created already
`active`, with no `email_verify` code issued at all — the new account
can sign in immediately. See `auth.service.ts`'s `register()` for the
full reasoning in code.

Scope, precisely:

- **Email signups only.** A **phone-only** signup is completely
  unaffected — it still goes through the existing `phone_verify` code
  and `pending_verification` gate, exactly as before.
- If both an email and a phone are given at signup, the email path
  wins (same precedence the code already used for choosing which
  channel to verify) — the account goes active immediately either way.
- `email_verified_at` is left `null` on these accounts rather than
  backfilled to `now()` — nobody has actually proven ownership of the
  address, so this stays an honest signal for anything that reads it
  later, even though nothing currently gates on it.
- OAuth (Google/Facebook) signups are unaffected — they already went
  active immediately, since the provider itself vouches for the email.
- Password reset is unaffected — it's a separate self-service flow
  (`auth.service.ts`'s password-reset path) that already activates an
  account and verifies its channel as a side effect of a successful
  code entry, regardless of this change.

`register()`'s response now carries `requiresVerification: boolean` so
callers don't have to re-derive the business rule themselves —
`web/auth/signup-customer.js` and `signup-provider.js` both branch on
it: `false` skips `verify.html` entirely and goes straight to the
relevant app's sign-in page; `true` (phone-only) goes to `verify.html`
as before.

**If this ever needs to be reverted** (e.g. spam/fraud becomes a
problem), the change is contained to `AuthService.register()` — revert
`requiresVerification`'s calculation back to always issuing a code and
starting at `pending_verification`, and the two signup pages' redirect
branches fall back to their original unconditional
`verify.html?...` behavior automatically (the `if (!result
.requiresVerification)` branch just never triggers).

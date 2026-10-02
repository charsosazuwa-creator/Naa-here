# Browser smoke tests

A small, deliberately starting Playwright suite — covers the provider
sign-in flow against the seeded demo account. This is a scaffold to
build on, not full coverage: see `docs/DEV_QA.md` for the bigger list
of flows confirmed working by hand (phone signup, messaging, job
requests, etc.) that would be good candidates to automate here next.

## Run it

1. Have the app running somewhere — either the local one-click demo
   (`node launcher/start.js` from the repo root) or against
   `test.naahere.com`.
2. Install dependencies and browsers (first time only):
   ```
   npm install
   npx playwright install chromium
   ```
3. Run:
   ```
   npm test
   ```
   Defaults to `http://localhost:3000`. Point it elsewhere with
   `BASE_URL`, e.g.:
   ```
   BASE_URL=https://test.naahere.com npm test
   ```
   Tests against `test.naahere.com` need accounts that actually exist
   there — the seeded `demo-provider@naahere.test` account is local-only
   unless you also run `db:seed` against that environment's database.

## Adding a test

Follow `tests/provider-login.spec.ts`'s shape: one `test()` per
behavior, short and specific. Prefer stable `id` selectors already in
the HTML (`#identifier`, `#submit-btn`, etc.) over text matches, which
break when copy changes.

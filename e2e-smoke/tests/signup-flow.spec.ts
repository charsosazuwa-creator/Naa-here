import { test, expect } from '@playwright/test';

/**
 * Covers the email-signup verification bypass (see auth.service.ts's
 * register() — an email signup is created already active, with no
 * email_verify code issued; a phone-only signup is unit-tested
 * separately in auth.service.register.spec.ts and is unaffected).
 *
 * Each run creates a new account with a timestamped email, same as
 * every other test file here that signs something up fresh -- no
 * cleanup step, since CI always runs this suite against a freshly
 * migrated and seeded database (see docs/DEV_QA.md's CI section).
 * Repeated manual runs against a long-lived local/QA database will
 * accumulate these test accounts; clean them up by hand if that
 * database is meant to stay tidy (see this session's own cleanup for
 * the SQL pattern: delete audit_event rows referencing the account/
 * tenant first, then the tenant, then the app_user row).
 */
test('customer email signup skips verification and lands on login', async ({ page }) => {
  const email = `pw-signup-${Date.now()}@example.com`;
  await page.goto('/auth/signup-customer.html');
  await page.fill('#fullName', 'Playwright Test User');
  await page.fill('#email', email);
  await page.fill('#password', 'abc12345');
  await page.fill('#confirmPassword', 'abc12345');
  await page.check('#terms');
  await page.click('#submit-btn');
  await page.waitForURL(/\/customer\/login\.html/, { timeout: 10_000 });
});

test('provider email signup skips verification, signs in, and creates the pending business', async ({ page }) => {
  const email = `pw-provider-signup-${Date.now()}@example.com`;
  await page.goto('/auth/signup-provider.html');
  await page.fill('#fullName', 'Playwright Provider');
  await page.fill('#email', email);
  await page.fill('#password', 'abc12345');
  await page.fill('#confirmPassword', 'abc12345');
  await page.fill('#businessName', 'Playwright Test Shop');
  await page.selectOption('#businessType', 'provider');
  await page.fill('#businessCategory', 'barber_salon');
  await page.selectOption('#businessCountry', 'NG');
  await page.check('#terms');
  await page.click('#submit-btn');

  // Skips verify.html entirely and lands on provider/login.html.
  await page.waitForURL(/\/provider\/login\.html/, { timeout: 10_000 });

  // Signing in now (no verification step happened) should succeed and
  // create the pending business, same as it would after verifying.
  await page.fill('#identifier', email);
  await page.fill('#password', 'abc12345');
  await page.click('#submit-btn');
  await page.waitForURL(/\/provider\/index\.html/, { timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'Playwright Test Shop' })).toBeVisible({ timeout: 10_000 });
});

import { test, expect } from '@playwright/test';

/**
 * Covers the provider sign-in flow against the seeded Demo Salon
 * account (api/scripts/seed.js). Confirmed working manually during
 * the Oct 2026 QA pass — see docs/DEV_QA.md.
 */
test('provider can sign in and see their business', async ({ page }) => {
  await page.goto('/provider/login.html');

  await page.locator('#identifier').fill('demo-provider@naahere.test');
  await page.locator('#password').fill('DemoPass123!');
  await page.locator('#submit-btn').click();

  // Login redirects into the provider portal SPA.
  await page.waitForURL(/\/provider\/index\.html/, { timeout: 10_000 });
  // "Demo Salon" also appears as an <option> in the tenant switcher,
  // so scope to the rendered view to avoid a strict-mode ambiguity.
  await expect(page.locator('#view').getByText('Demo Salon')).toBeVisible({ timeout: 10_000 });
});

test('wrong password shows an inline error, not a crash', async ({ page }) => {
  await page.goto('/provider/login.html');

  await page.locator('#identifier').fill('demo-provider@naahere.test');
  await page.locator('#password').fill('WrongPassword123!');
  await page.locator('#submit-btn').click();

  await expect(page.locator('#alert')).toBeVisible({ timeout: 10_000 });
});

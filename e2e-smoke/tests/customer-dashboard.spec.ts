import { test, expect } from '@playwright/test';

/**
 * Covers the signed-in customer dashboard (the personalized #/home —
 * see renderDashboard() in web/customer/app.js). Confirmed rendering
 * correctly against real seeded + manually-inserted booking/job-
 * request/conversation/listing data before this was committed.
 */
test('signed-out visitor still sees the marketing home page', async ({ page }) => {
  await page.goto('/customer/index.html#/home');
  await expect(page.getByText('Welcome to naahere.com')).toBeVisible({ timeout: 10_000 });
});

test('signed-in customer sees a personalized dashboard, not the marketing page', async ({ page }) => {
  await page.goto('/customer/login.html');
  await page.locator('#identifier').fill('demo-customer@naahere.test');
  await page.locator('#password').fill('DemoPass123!');
  await page.locator('#submit-btn').click();

  await page.waitForURL(/\/customer\/index\.html/, { timeout: 10_000 });
  await expect(page.getByText(/Welcome back,/)).toBeVisible({ timeout: 10_000 });

  // The four summary cards this view promises — see docs/DEV_QA.md.
  await expect(page.getByRole('heading', { name: 'Upcoming bookings' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Job requests & quotations' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Messages' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'My listings' })).toBeVisible();
});

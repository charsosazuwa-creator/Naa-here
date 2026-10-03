import { test, expect } from '@playwright/test';

/**
 * Covers the reports feature end to end: the reporting Agent service
 * account (db/migrations/026_admin_agent_reports.sql), the provider
 * portal's own Reports tab (a business's own performance report), and
 * the Admin Console's Reports tab (cross-tenant platform summary +
 * any business's performance report). Confirmed rendering correctly
 * against real seeded data, including the pre-existing admin-tabs
 * layout bug this feature's verification incidentally found and fixed
 * — see web/provider/app.css's body.no-tenant .shell comment.
 */
test('provider can generate and view their own business performance report', async ({ page }) => {
  await page.goto('/provider/login.html');
  await page.locator('#identifier').fill('demo-provider@naahere.test');
  await page.locator('#password').fill('DemoPass123!');
  await page.locator('#submit-btn').click();
  await page.waitForURL(/\/provider\/index\.html/, { timeout: 10_000 });

  await page.locator('.tenant-card').first().click();
  await page.locator('#sidebar-nav a', { hasText: 'Reports' }).click();
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible({ timeout: 10_000 });

  await page.locator('#generate-report-btn').click();
  await expect(page.locator('#report-result .report-stat-label', { hasText: /Bookings/ })).toBeVisible({ timeout: 10_000 });
});

test('admin can generate a platform summary and a business performance report', async ({ page }) => {
  await page.goto('/admin/login.html');
  await page.locator('#identifier').fill('demo-admin@naahere.test');
  await page.locator('#password').fill('DemoPass123!');
  await page.locator('#submit-btn').click();
  await page.waitForURL(/\/admin\/index\.html/, { timeout: 10_000 });

  await page.locator('button[data-tab="reports"]').click();
  await expect(page.getByRole('heading', { name: 'Platform summary' })).toBeVisible({ timeout: 10_000 });

  await page.locator('#generate-platform-btn').click();
  await expect(page.locator('#platform-result .report-stat-label', { hasText: 'Total businesses' })).toBeVisible({ timeout: 10_000 });

  await page.locator('#generate-business-btn').click();
  await expect(page.locator('#business-result .report-stat-label', { hasText: 'Business' })).toBeVisible({ timeout: 10_000 });
});

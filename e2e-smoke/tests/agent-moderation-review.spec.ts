import { test, expect } from '@playwright/test';

/**
 * Covers the reporting Agent's advisory review on the marketplace
 * listings moderation queue (ModerationAssistService, attached by
 * ListingAdminController.listPending() — see its own comment). This
 * is read-only and advisory: a human still has to click Approve or
 * Reject, this only confirms the recommendation renders.
 *
 * The test creates its own pending listing via the API (deliberately
 * missing fields, so the Agent is guaranteed to flag something) and
 * rejects it again at the end, so the shared demo database stays
 * clean for other specs.
 */
test('admin sees the agent\'s advisory review on a pending listing', async ({ page, request, baseURL }) => {
  const login = async (email: string) => {
    const res = await request.post(`${baseURL}/v1/auth/login`, {
      data: { email, password: 'DemoPass123!' },
    });
    const { accessToken } = await res.json();
    return accessToken as string;
  };

  const providerToken = await login('demo-provider@naahere.test');

  const createRes = await request.post(`${baseURL}/v1/listings`, {
    headers: { Authorization: `Bearer ${providerToken}` },
    data: {
      listingType: 'product',
      title: 'x',
      category: 'misc',
      priceType: 'fixed',
      priceMinorUnits: 0,
      currencyCode: 'NGN',
      contactMethod: 'email',
      contactValue: 'not-an-email',
    },
  });
  const listing = await createRes.json();

  await request.post(`${baseURL}/v1/listings/${listing.id}/submit`, {
    headers: { Authorization: `Bearer ${providerToken}` },
  });

  try {
    await page.goto('/admin/login.html');
    await page.locator('#identifier').fill('demo-admin@naahere.test');
    await page.locator('#password').fill('DemoPass123!');
    await page.locator('#submit-btn').click();
    await page.waitForURL(/\/admin\/index\.html/, { timeout: 10_000 });

    await page.locator('button[data-tab="listings"]').click();
    const row = page.locator('tr.submission-row', { hasText: 'x' }).first();
    await expect(row.locator('.agent-review-badge.attention')).toBeVisible({ timeout: 10_000 });

    await row.locator('[data-action="review"]').click();
    const detail = page.locator(`tr.submission-detail[data-detail-for="${listing.id}"]`);
    await expect(detail.locator('.agent-review-reasons li')).toContainText(['No photos attached.']);
  } finally {
    const adminToken = await login('demo-admin@naahere.test');
    await request.post(`${baseURL}/v1/admin/listings/${listing.id}/decide`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { decision: 'rejected', reason: 'e2e-smoke test cleanup' },
    });
  }
});

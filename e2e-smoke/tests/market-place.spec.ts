import { test, expect } from '@playwright/test';

/**
 * Covers the Market Place menu (Public Store / Post Product(s) / Post
 * Service(s)) added to both the provider and customer portals — see
 * web/shared/listing-ui.js's renderPostListing()/renderMarketBrowse()
 * and the "market"/"post-product"/"post-service" views in each
 * app.js. A listing created through "Post Product(s)" goes through
 * the exact same draft -> submit -> admin-approve lifecycle every
 * other listing does; this only checks the new entry points and that
 * the Public Store maps a published listing back to whoever posted
 * it, with a working "reach out" contact link.
 *
 * Archives the listing again at the end so the shared demo database
 * stays clean for other specs.
 */
test('Post Product(s) creates a listing that shows up, owner-mapped, in the Public Store', async ({ page, request, baseURL }) => {
  const login = async (email: string) => {
    const res = await request.post(`${baseURL}/v1/auth/login`, {
      data: { email, password: 'DemoPass123!' },
    });
    const { accessToken } = await res.json();
    return accessToken as string;
  };

  let listingId: string | undefined;

  try {
    // Sign in on the provider portal and use the Market Place menu's
    // "Post Product(s)" item rather than the API directly, so this
    // actually exercises the new UI entry point end to end.
    await page.goto('/provider/login.html');
    await page.locator('#identifier').fill('demo-provider@naahere.test');
    await page.locator('#password').fill('DemoPass123!');
    await page.locator('#submit-btn').click();
    await page.waitForURL(/\/provider\/index\.html/, { timeout: 10_000 });

    // An ordinary sign-in always lands on "Your businesses" (unlike
    // the auto-select-into-it-on-first-sign-in path signup-flow.spec.ts
    // covers) — pick the seeded Demo Salon to reach the sidebar.
    await page.locator('#view').getByText('Demo Salon').click();
    await page.waitForURL(/\/t\/[^/]+\/overview$/, { timeout: 10_000 });

    await page.locator('#sidebar-nav a', { hasText: 'Post Product(s)' }).click();
    await expect(page.getByRole('heading', { name: 'Post a product' })).toBeVisible({ timeout: 10_000 });

    // The type dropdown is locked to "product" (disabled, single
    // option) rather than the full picker shown on My Listings.
    const typeSelect = page.locator('.lf-type');
    await expect(typeSelect).toBeDisabled();
    await expect(typeSelect).toHaveValue('product');

    const title = `E2E Market Place Product ${Date.now()}`;
    await page.locator('.lf-title').fill(title);
    await page.locator('.lf-category').fill('Electronics');
    await page.locator('.lf-description').fill('Created via the Post Product(s) Market Place menu item.');
    await page.locator('.lf-price').fill('750000');
    await page.locator('.lf-contact-method').selectOption('whatsapp');
    await page.locator('.lf-contact-value').fill('+2348012345678');
    await page.locator('button[type="submit"]').click();

    // renderPostListing() redirects to My Listings on success.
    await page.waitForURL(/\/t\/[^/]+\/listings$/, { timeout: 10_000 });
    const row = page.locator('tr', { hasText: title });
    await expect(row).toBeVisible({ timeout: 10_000 });

    // Submit for review, then approve as admin via the API (the admin
    // UI side of this is already covered by agent-moderation-review.spec.ts).
    await row.locator('[data-action="submit"]').click();
    await expect(row.locator('.badge')).toHaveText(/pending review/i, { timeout: 10_000 });

    const providerToken = await login('demo-provider@naahere.test');
    const mine = await (await request.get(`${baseURL}/v1/listings/mine`, {
      headers: { Authorization: `Bearer ${providerToken}` },
    })).json();
    const created = mine.find((l: { title: string }) => l.title === title);
    listingId = created.id;

    const adminToken = await login('demo-admin@naahere.test');
    await request.post(`${baseURL}/v1/admin/listings/${listingId}/decide`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { decision: 'approved' },
    });

    // Now check the Public Store (customer portal) shows it, mapped
    // to the Provider who posted it, with a working contact link.
    await page.goto(`/customer/index.html#/market?q=${encodeURIComponent(title)}`);
    const card = page.locator('.service-card', { hasText: title });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText('Posted by Demo Provider');

    await card.click();
    await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Posted by Demo Provider')).toBeVisible();
    const contactLink = page.locator('a', { hasText: 'Message Demo Provider on WhatsApp' });
    await expect(contactLink).toHaveAttribute('href', 'https://wa.me/2348012345678');
  } finally {
    if (listingId) {
      // Already-approved/published, so this listing has no "decide"
      // left to undo — archive it the same way My Listings would.
      const providerToken = await login('demo-provider@naahere.test');
      await request.delete(`${baseURL}/v1/listings/${listingId}`, {
        headers: { Authorization: `Bearer ${providerToken}` },
      });
    }
  }
});

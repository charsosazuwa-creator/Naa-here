import { defineConfig } from '@playwright/test';

/**
 * BASE_URL defaults to the local one-click demo (launcher/start.js /
 * `npm run db:migrate && db:seed` loop — see docs/DEV_QA.md). Point it
 * at https://test.naahere.com to run the same smoke checks there
 * instead — nothing else needs to change. These tests assume the
 * db:seed fixtures exist (demo-provider@naahere.test /
 * DemoPass123!), so they won't pass as-is against production.
 */
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        // CI environments that already ship a Chromium build (so
        // `playwright install` can't/shouldn't re-download one) can
        // point this at it via PLAYWRIGHT_CHROMIUM_PATH; otherwise
        // Playwright uses whatever `playwright install` downloaded.
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
          : {},
      },
    },
  ],
});

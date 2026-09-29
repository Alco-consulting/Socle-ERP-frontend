import { defineConfig, devices } from '@playwright/test';

const PORT = 4300;

/**
 * End-to-end checks in a real browser: login and Django session, CSRF, company context and
 * switch, launcher and permissions, navigation journey, list/form behaviour, layout rules
 * (no sidebar, no horizontal page scroll), accessibility (axe). No test ever reaches the
 * real API: every `/api/v1/…` request is answered by the fake of e2e/support/fake-api.ts.
 * Locally, `PLAYWRIGHT_CHANNEL=chrome` reuses the installed Chrome instead of downloading
 * Playwright's Chromium; the CI installs its own browser.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: process.env['PLAYWRIGHT_CHANNEL'] || undefined,
    locale: 'fr-FR',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: /captures\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'tablet',
      testMatch: /layout\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 820, height: 1180 }, hasTouch: true },
    },
    {
      name: 'phone',
      testMatch: /layout\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, hasTouch: true },
    },
    {
      // Screenshots for the design review, on demand only: `npm run captures`.
      name: 'captures',
      testMatch: /captures\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `npx ng serve --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
  },
});

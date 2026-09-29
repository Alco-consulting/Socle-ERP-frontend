import { defineConfig, devices } from '@playwright/test';

/** Prototype mode (simulated session): the validated UX journeys. */
const PROTOTYPE_PORT = 4300;
/** API mode (Django session): the technical base, network simulated by Playwright. */
const API_PORT = 4310;

/**
 * End-to-end checks: navigation journey, list/form behaviour, permissions, layout rules
 * (no sidebar, no horizontal page scroll), accessibility (axe) — and, in API mode, the
 * session, CSRF and company context in a real browser. No test ever reaches the real API:
 * in API mode every `/api/v1/…` request is answered by the test itself.
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
    baseURL: `http://localhost:${PROTOTYPE_PORT}`,
    channel: process.env['PLAYWRIGHT_CHANNEL'] || undefined,
    locale: 'fr-FR',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: /(captures|api-session)\.spec\.ts/,
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
      name: 'api',
      testMatch: /api-session\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        baseURL: `http://localhost:${API_PORT}`,
      },
    },
    {
      // Screenshots for the design review, on demand only: `npm run captures`.
      name: 'captures',
      testMatch: /captures\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: `npx ng serve --port ${PROTOTYPE_PORT}`,
      url: `http://localhost:${PROTOTYPE_PORT}`,
      reuseExistingServer: !process.env['CI'],
      timeout: 180_000,
    },
    {
      command: `npx ng serve --configuration development-api --port ${API_PORT}`,
      url: `http://localhost:${API_PORT}`,
      reuseExistingServer: !process.env['CI'],
      timeout: 180_000,
    },
  ],
});

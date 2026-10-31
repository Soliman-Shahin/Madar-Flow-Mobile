import { defineConfig, devices } from '@playwright/test';

/**
 * Consumer-app browser e2e. Runs against a LOCAL QA backend only.
 *
 *   # terminal 1 (Madar-Flow-BE): in-memory DB + seeded QA accounts
 *   QA_PORT=3111 QA_PASSWORD='<throwaway>' node scripts/qa-server.cjs
 *
 *   # terminal 2 (Madar-Flow-Mobile)
 *   E2E_API_TARGET=http://localhost:3111 E2E_PASSWORD='<same throwaway>' npm run e2e
 *
 * Credentials come from the environment (never committed). Uses the installed
 * Google Chrome, so no browser download is needed.
 */
const PORT = Number(process.env.E2E_PORT || 4401);
const baseURL = process.env.E2E_BASE_URL || `http://localhost:${PORT}`;
const apiTarget = process.env.E2E_API_TARGET || 'http://localhost:3111';

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(apiTarget)) {
  throw new Error('E2E_API_TARGET must be a localhost URL (e2e never targets staging or production).');
}

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  outputDir: 'e2e-results',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Pixel 7'],
    channel: 'chrome',
  },
  webServer: {
    command: `npx ng serve --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 240_000,
    env: { MADAR_FLOW_API_TARGET: apiTarget },
  },
});

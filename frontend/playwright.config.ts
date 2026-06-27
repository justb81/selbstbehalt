// SPDX-License-Identifier: Apache-2.0
import { defineConfig, devices } from '@playwright/test';

const PORT = 5173;
const BASE_URL = `http://localhost:${PORT}`;
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Run the E2E suite against the Vite dev server.
  webServer: {
    command: `pnpm run dev --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});

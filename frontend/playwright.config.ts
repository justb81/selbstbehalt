// SPDX-License-Identifier: Apache-2.0
import { defineConfig, devices } from '@playwright/test';

const PORT = 5173;
const BASE_URL = `http://localhost:${PORT}`;
const isCI = !!process.env.CI;

// Optional escape hatch for environments that ship a Chromium whose build does
// not match the pinned Playwright (e.g. sandboxes with a preinstalled browser).
// Unset in CI, which installs the matching browser via `playwright install`.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

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
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } },
    },
  ],
  // Run the E2E suite against a production build served by `vite preview`, not
  // the dev server: the PWA service worker is only emitted/active in a real
  // build (devOptions.enabled is false), so the installability and offline
  // checks (issue #27) need the built output.
  webServer: {
    command: `pnpm run build && pnpm run preview --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !isCI,
    timeout: 180_000,
  },
});

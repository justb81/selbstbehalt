// SPDX-License-Identifier: Apache-2.0
import { defineConfig, devices } from '@playwright/test';

const DEV_PORT = 5173;
const PREVIEW_PORT = 4173;
const DEV_URL = `http://localhost:${DEV_PORT}`;
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;
const isCI = !!process.env.CI;

// Optional escape hatch for environments that ship a Chromium whose build does
// not match the pinned Playwright (e.g. sandboxes with a preinstalled browser).
// Unset in CI, which installs the matching browser via `playwright install`.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
const chrome = { ...devices['Desktop Chrome'], launchOptions: { executablePath } };

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    // Most specs run against the Vite dev server, which exposes the dev-only
    // test hooks they rely on (e.g. the scan flow's `__selbstbehaltStubScan`).
    {
      name: 'chromium',
      testIgnore: '**/pwa.spec.ts',
      use: { ...chrome, baseURL: DEV_URL },
    },
    // The PWA checks need a real build: the service worker is only emitted and
    // active in a production build (devOptions.enabled is false), so they run
    // against `vite preview` of the built output (issue #27).
    {
      name: 'pwa',
      testMatch: '**/pwa.spec.ts',
      use: { ...chrome, baseURL: PREVIEW_URL },
    },
  ],
  // The production build is done once by the `test:e2e` script *before* Playwright
  // starts these servers — not inside a webServer command — so the build never
  // races the dev server's `svelte-kit sync`. `vite preview` then just serves the
  // pre-built `build/` output (it does not sync), and `vite dev` syncs only its
  // own `.svelte-kit/` artifacts, so the two run concurrently without clashing.
  webServer: [
    {
      command: `pnpm run dev --port ${DEV_PORT} --strictPort`,
      url: DEV_URL,
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
    {
      command: `pnpm run preview --port ${PREVIEW_PORT} --strictPort`,
      url: PREVIEW_URL,
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
  ],
});

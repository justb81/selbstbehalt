// SPDX-License-Identifier: Apache-2.0
//
// PWA acceptance checks (docs/design.md §6.3, issue #27): the app is installable
// (linked manifest with the required fields + icons), the service worker
// registers and precaches the shell, and the app shell loads offline.
import { expect, test } from '@playwright/test';

test('exposes an installable web app manifest per §6.3', async ({ page }) => {
  await page.goto('/');

  const href = await page.getAttribute('link[rel="manifest"]', 'href');
  expect(href).toBeTruthy();

  // Behind the §7.2 reverse-proxy Basic Auth the manifest must be fetched with
  // credentials, else the proxy 401s it and the app is not installable.
  const crossorigin = await page.getAttribute('link[rel="manifest"]', 'crossorigin');
  expect(crossorigin).toBe('use-credentials');

  const manifest = await page.evaluate(async (url) => {
    const response = await fetch(url!);
    return (await response.json()) as {
      name: string;
      theme_color: string;
      lang: string;
      categories: string[];
      icons: { sizes: string; purpose?: string }[];
    };
  }, href);

  expect(manifest.name).toBe('PKV Manager');
  expect(manifest.theme_color).toBe('#2563eb');
  expect(manifest.lang).toBe('de-DE');
  expect(manifest.categories).toEqual(expect.arrayContaining(['health', 'finance']));

  const sizes = manifest.icons.map((icon) => icon.sizes);
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
});

test('serves the declared icons', async ({ page, request }) => {
  await page.goto('/');
  for (const path of [
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/icon-512-maskable.png',
  ]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()['content-type']).toContain('image/png');
  }
});

test('registers a service worker and precaches the app shell', async ({ page }) => {
  await page.goto('/');

  const state = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return registration.active?.state ?? null;
  });
  expect(state).not.toBeNull();

  // The shell cache is populated with the precached app shell entries.
  const shellEntries = await page.evaluate(async () => {
    const keys = await caches.keys();
    const shell = keys.find((key) => key.startsWith('shell-'));
    if (!shell) return 0;
    return (await (await caches.open(shell)).keys()).length;
  });
  expect(shellEntries).toBeGreaterThan(0);
});

test('loads the app shell offline', async ({ page, context }) => {
  await page.goto('/');
  // Wait until the worker is active and the shell is cached before cutting off
  // the network.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const keys = await caches.keys();
        return keys.some((key) => key.startsWith('shell-'));
      }),
    )
    .toBe(true);

  await context.setOffline(true);
  await page.reload({ waitUntil: 'load' });

  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Verträge' })).toBeVisible();

  await context.setOffline(false);
});

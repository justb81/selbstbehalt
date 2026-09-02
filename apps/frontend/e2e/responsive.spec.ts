// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
// Responsive checks on common small Android/mobile viewports (issue #29): no
// page-level horizontal overflow, and the mobile bottom nav's overflow sheet
// stays reachable at the narrowest supported width.
import { expect, test } from '@playwright/test';

import { CONTRACT_ID, INVOICE_ID, mockBackend } from './fixtures';

const VIEWPORTS = [
  { name: '360×800 (small Android)', width: 360, height: 800 },
  { name: '390×844 (mid-range Android/iPhone-equivalent)', width: 390, height: 844 },
];

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth - doc.clientWidth;
  });
  expect(overflow, 'page should not scroll horizontally').toBeLessThanOrEqual(1);
}

for (const viewport of VIEWPORTS) {
  test.describe(`viewport ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('invoices list has no horizontal overflow and stays usable', async ({ page }) => {
      await mockBackend(page, { populated: true });
      await page.goto('/invoices');
      await expect(page.getByRole('table')).toBeVisible();
      await expectNoHorizontalOverflow(page);

      // Bottom nav and its center capture FAB remain visible and reachable.
      const bottomNav = page.getByRole('navigation', { name: 'Mobile Navigation' });
      await expect(bottomNav.getByRole('link', { name: 'Rechnung erfassen' })).toBeVisible();
    });

    test('invoice detail (positions table) has no horizontal overflow', async ({ page }) => {
      await mockBackend(page, { populated: true });
      await page.goto(`/invoices/${INVOICE_ID}`);
      await expect(page.getByRole('table')).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });

    // The insured-person form carries four repeaters (BRE ladder, Erstattungs-
    // staffel, Summengrenzen, Aufbaujahre). They are real tables now (issue
    // #465), so a narrow viewport scrolls them inside their own container
    // instead of dragging the whole page sideways.
    test('insured-person form repeaters scroll in their own container', async ({ page }) => {
      await mockBackend(page, { populated: true });
      await page.goto(`/contracts/${CONTRACT_ID}`);

      await page.getByRole('button', { name: '+ Person hinzufügen' }).click();
      await page.getByRole('checkbox', { name: 'BRE-Staffel konfigurieren' }).click();
      await expect(page.getByRole('columnheader', { name: 'Leistungsfreie Jahre' })).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await page.getByRole('checkbox', { name: 'Enthaltene Leistungen konfigurieren' }).click();
      await page.getByRole('button', { name: /Leistungsbereich hinzufügen/ }).click();
      for (const box of ['Erstattungsstaffel', 'Summengrenzen', 'Aufbaujahre (Zahnstaffel)']) {
        await page.getByRole('checkbox', { name: box }).click();
      }
      await expect(page.getByRole('columnheader', { name: 'Bis (€)' })).toBeVisible();
      await expectNoHorizontalOverflow(page);

      // Each table owns its scroll container, so a wide row stays inside it.
      const containers = page.locator('[data-slot="table-container"]');
      await expect(containers.first()).toBeVisible();
      for (const container of await containers.all()) {
        const overflows = await container.evaluate(
          (el) => getComputedStyle(el).overflowX === 'auto',
        );
        expect(overflows).toBe(true);
      }
    });

    test('bottom nav "Mehr" sheet reaches all overflow items without horizontal scroll', async ({
      page,
    }) => {
      await mockBackend(page, { populated: true });
      await page.goto('/insured');
      await expectNoHorizontalOverflow(page);

      await page.getByRole('button', { name: 'Mehr' }).click();
      await expect(page.getByRole('link', { name: 'Einstellungen' })).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await page.getByRole('link', { name: 'Einstellungen' }).click();
      await expect(page).toHaveURL(/\/settings$/);
      await expectNoHorizontalOverflow(page);
    });
  });
}

// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
// Issue #461: the /stats filters live in the URL, so a reload keeps the
// selection and the view is deep-linkable.
import { expect, test } from '@playwright/test';
import { INSURED_ID, INVOICE_LIST_ITEM, mockBackend } from './fixtures';

const currentYear = new Date().getFullYear();

test.describe('/stats filter state in the URL', () => {
  test.beforeEach(async ({ page }) => {
    await mockBackend(page, { populated: true });
  });

  test('a person deep-link survives a reload', async ({ page }) => {
    await page.goto(`/stats?person=${INSURED_ID}`);
    await expect(page.getByText('BRE-Verlauf', { exact: true })).toBeVisible();

    await page.reload();
    expect(new URL(page.url()).searchParams.get('person')).toBe(INSURED_ID);
    await expect(page.getByText('BRE-Verlauf', { exact: true })).toBeVisible();
  });

  test('an out-of-range year falls back to the current year without a redirect', async ({
    page,
  }) => {
    await page.goto('/stats?year=1999');
    await expect(page.getByText(`Rechnungen ${currentYear}`)).toBeVisible();
    // The invalid value is left in the URL — the fallback is a read-side
    // decision, not a rewrite that would clobber a bookmark.
    expect(new URL(page.url()).searchParams.get('year')).toBe('1999');
  });

  test('picking a year writes it back without a history entry', async ({ page }) => {
    // A second invoice year, so the year Select has something to switch *to* —
    // choosing the already-selected value is a Select no-op. Overridden here
    // rather than in the shared fixture, whose single invoice the dashboard and
    // archive specs count on.
    const priorYear = currentYear - 1;
    await page.route('**/api/invoices', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            json: [
              INVOICE_LIST_ITEM,
              {
                ...INVOICE_LIST_ITEM,
                id: '10000000-0000-4000-8000-0000000000ff',
                invoice_date: `${priorYear}-03-15`,
                payment_due_date: `${priorYear}-04-14`,
                invoice_number: `R-${priorYear}-001`,
              },
            ],
          })
        : route.fallback(),
    );

    // Via the dashboard, so there is a previous page for `goBack` to land on.
    await page.goto('/');
    await page.getByRole('link', { name: 'Auswertung' }).first().click();
    await expect(page.getByText(`Rechnungen ${currentYear}`)).toBeVisible();
    expect(new URL(page.url()).searchParams.has('year')).toBe(false);

    await page.locator('[data-slot="select-trigger"]').first().click();
    await page.getByRole('option', { name: String(priorYear) }).click();
    await expect(page).toHaveURL(new RegExp(`\\?year=${priorYear}$`));
    await expect(page.getByText(`Rechnungen ${priorYear}`)).toBeVisible();

    // replaceState: Zurück führt auf die vorige Seite, nicht durch die
    // Filterhistorie — der Filterwechsel hat keinen History-Eintrag erzeugt.
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  });
});

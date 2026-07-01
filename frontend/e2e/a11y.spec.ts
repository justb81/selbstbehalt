// SPDX-License-Identifier: Apache-2.0
// Accessibility regression coverage (issue #29): axe-core scans of the core
// flows plus a keyboard/skip-link check. Runs against the dev server like
// smoke.spec.ts / scan.spec.ts, with the backend mocked (fixtures.ts) — there
// is no live backend in this e2e project.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import {
  CONTRACT,
  CONTRACT_ID,
  INSURED,
  INSURED_ID,
  INVOICE,
  INVOICE_ID,
  mockBackend,
  PERSON,
  PERSON_ID,
} from './fixtures';

/** Runs an axe scan restricted to WCAG 2.0/2.1 A+AA and asserts zero violations. */
async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

test.describe('axe: core flows', () => {
  test('dashboard — empty and populated', async ({ page }) => {
    await mockBackend(page, { populated: false });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await expectNoViolations(page);

    await mockBackend(page, { populated: true });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Offene Rechnungen' })).toBeVisible();
    await expectNoViolations(page);
  });

  test('invoices list — empty and populated', async ({ page }) => {
    await mockBackend(page, { populated: false });
    await page.goto('/invoices');
    await expect(page.getByText('Noch keine Rechnungen vorhanden.')).toBeVisible();
    await expectNoViolations(page);

    await mockBackend(page, { populated: true });
    await page.goto('/invoices');
    await expect(page.getByRole('table')).toBeVisible();
    await expectNoViolations(page);
  });

  test('invoice detail — including the delete confirmation dialog', async ({ page }) => {
    await mockBackend(page, { populated: true });
    await page.goto(`/invoices/${INVOICE_ID}`);
    await expect(
      page.getByRole('heading', { level: 1, name: INVOICE.provider_name }),
    ).toBeVisible();
    await expectNoViolations(page);

    await page.getByRole('button', { name: 'Löschen' }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expectNoViolations(page);
  });

  test('invoice new form, including the OCR scanner panel', async ({ page }) => {
    await mockBackend(page, { populated: true });
    await page.goto('/invoices/new');
    await expect(page.getByRole('heading', { level: 1, name: 'Rechnung erfassen' })).toBeVisible();
    await expectNoViolations(page);

    await page.getByRole('button', { name: 'Rechnung scannen / hochladen' }).click();
    await expectNoViolations(page);
  });

  test('invoice edit form', async ({ page }) => {
    await mockBackend(page, { populated: true });
    await page.goto(`/invoices/${INVOICE_ID}/edit`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoViolations(page);
  });

  test('scan route redirects into the invoice form', async ({ page }) => {
    await mockBackend(page, { populated: true });
    await page.goto('/invoices/scan');
    await expect(page).toHaveURL(/\/invoices\/new$/);
    await expectNoViolations(page);
  });

  test('contracts list — empty and populated', async ({ page }) => {
    await mockBackend(page, { populated: false });
    await page.goto('/contracts');
    await expect(page.getByText('Noch keine Verträge angelegt.')).toBeVisible();
    await expectNoViolations(page);

    await mockBackend(page, { populated: true });
    await page.goto('/contracts');
    await expect(page.getByText(CONTRACT.insurer_name)).toBeVisible();
    await expectNoViolations(page);
  });

  test('contract detail', async ({ page }) => {
    await mockBackend(page, { populated: true });
    await page.goto(`/contracts/${CONTRACT_ID}`);
    await expect(
      page.getByRole('heading', { level: 1, name: CONTRACT.insurer_name }),
    ).toBeVisible();
    await expectNoViolations(page);
  });

  test('persons list and detail', async ({ page }) => {
    await mockBackend(page, { populated: false });
    await page.goto('/persons');
    await expect(page.getByText('Noch keine Personen angelegt.')).toBeVisible();
    await expectNoViolations(page);

    await mockBackend(page, { populated: true });
    await page.goto('/persons');
    await expect(page.getByText(PERSON.name)).toBeVisible();
    await expectNoViolations(page);

    await page.goto(`/persons/${PERSON_ID}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Personendetail' })).toBeVisible();
    await expect(page.getByText(PERSON.name)).toBeVisible();
    await expectNoViolations(page);
  });

  test('insured list and detail', async ({ page }) => {
    await mockBackend(page, { populated: false });
    await page.goto('/insured');
    await expect(page.getByText('Noch keine versicherten Personen vorhanden.')).toBeVisible();
    await expectNoViolations(page);

    await mockBackend(page, { populated: true });
    await page.goto('/insured');
    await expect(page.getByText(INSURED.tariff_name).first()).toBeVisible();
    await expectNoViolations(page);

    await page.goto(`/insured/${INSURED_ID}`);
    await expect(page.getByText(INSURED.tariff_name).first()).toBeVisible();
    await expectNoViolations(page);
  });

  test('settings', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Einstellungen' })).toBeVisible();
    await expectNoViolations(page);
  });
});

test.describe('keyboard operability', () => {
  test('skip-link is the first Tab stop and moves focus to the main content', async ({ page }) => {
    await mockBackend(page, { populated: false });
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'selbstbehalt' })).toBeVisible();

    await page.keyboard.press('Tab');
    const skipLink = page.getByRole('link', { name: 'Zum Inhalt springen' });
    await expect(skipLink).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
  });
});

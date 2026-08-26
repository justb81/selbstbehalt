// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
// Accessibility regression coverage (issues #29, #379): axe-core scans of every
// route and the states it renders — empty, populated, form error, open dialog or
// sheet — plus keyboard/focus tests for what axe structurally cannot see (focus
// traps, Escape, focus return, tab order). Runs against the dev server like
// smoke.spec.ts / scan.spec.ts, with the backend mocked (fixtures.ts) — there
// is no live backend in this e2e project.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

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

/** The mobile bottom nav is `sm:hidden`, so its tests need a sub-640px viewport. */
const MOBILE_VIEWPORT = { width: 390, height: 844 };

/** Runs an axe scan restricted to WCAG 2.0/2.1 A+AA and asserts zero violations. */
async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

/**
 * Presses Tab until `target` holds focus — i.e. asserts it is reachable by
 * keyboard at all, without hard-coding how many stops precede it.
 */
async function tabTo(page: Page, target: Locator, max = 40): Promise<void> {
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error(`element did not receive focus within ${max} Tab presses`);
}

/**
 * Tabs forward from the currently focused element until an element with id
 * `untilId` has focus, returning the ids seen along the way (`''` for elements
 * without one). Used to assert the *relative* order of the labelled fields
 * without pinning the unnamed stops (scanner buttons, dropzone) in between.
 *
 * Consecutive repeats are collapsed: Chromium's `<input type="date">` exposes
 * its day/month/year segments as separate Tab stops, all reported as the same
 * host element, which is one field for the purposes of field order.
 */
async function tabbedIdsUntil(page: Page, untilId: string, max = 60): Promise<string[]> {
  const seen: string[] = [];
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab');
    const id = await page.evaluate(() => document.activeElement?.id ?? '');
    if (id !== seen.at(-1)) seen.push(id);
    if (id === untilId) return seen;
  }
  throw new Error(`never reached #${untilId} within ${max} Tab presses; saw: ${seen.join(', ')}`);
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
    // The OCR scanner panel is always visible (no toggle), so it is covered here.
    await expect(page.getByLabel('Rechnungsdateien (Bilder oder PDFs)')).toBeAttached();
    await expectNoViolations(page);
  });

  // The page preview and the parsed position rows only exist after a scan, so
  // the unscanned form above cannot cover them. A <canvas> in particular is an
  // unlabelled graphic to axe unless it is named.
  test('invoice new form after a scan, including the page preview', async ({ page }) => {
    await mockBackend(page, { populated: true });
    await page.goto('/invoices/new');
    await expect(page.getByRole('heading', { level: 1, name: 'Rechnung erfassen' })).toBeVisible();

    // Drive the scan through the dev-only hook, as scan.spec.ts does: it
    // bypasses the headless-incompatible image codec and the model-downloading
    // OCR binding, while parsing, review and the preview render for real.
    await page.waitForFunction(
      () =>
        typeof (window as unknown as { __selbstbehaltStubScan?: unknown })
          .__selbstbehaltStubScan === 'function',
    );
    await page.evaluate(
      (text) =>
        (
          window as unknown as { __selbstbehaltStubScan: (t: string) => void }
        ).__selbstbehaltStubScan(text),
      [
        'Praxis Dr. med. Mustermann',
        'Rechnungsdatum: 15.03.2026',
        '250 Blutentnahme 2,3 5,36',
      ].join('\n'),
    );
    await page.setInputFiles('input[type="file"]', {
      name: 'rechnung.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
        'base64',
      ),
    });

    await expect(page.getByText('Gescannte Vorlage')).toBeVisible();
    await expect(page.getByRole('img', { name: /Vorschau der gescannten Rechnung/ })).toBeVisible();
    await expectNoViolations(page);
  });

  test('invoice edit form', async ({ page }) => {
    await mockBackend(page, { populated: true });
    await page.goto(`/invoices/${INVOICE_ID}/edit`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoViolations(page);
  });

  // /invoices/:id/submit renders three different bodies depending on the
  // invoice's derived status tracks (#230), and only the middle one is a form —
  // so all three are scanned.
  test('invoice submit form — blocked, create and correction mode', async ({ page }) => {
    // review = neu: not submittable yet, so the route explains why instead.
    await mockBackend(page, { populated: true });
    await page.goto(`/invoices/${INVOICE_ID}/submit`);
    await expect(page.getByRole('heading', { level: 1, name: 'Einreichung' })).toBeVisible();
    await expect(page.getByText('kann derzeit nicht (mehr) eingereicht werden')).toBeVisible();
    await expectNoViolations(page);

    // review = geprüft + nicht_eingereicht: the actual submission form.
    await mockBackend(page, { populated: true, invoiceStatus: { review: 'geprüft' } });
    await page.goto(`/invoices/${INVOICE_ID}/submit`);
    await expect(page.getByLabel('Eingereicht am')).toBeVisible();
    await expect(page.getByLabel('Einreichungsweg')).toBeVisible();
    await expect(page.getByLabel('Erwartete Erstattung (€)')).toBeVisible();
    await expectNoViolations(page);

    // submission = eingereicht: the same form as the correction mode, prefilled
    // from GET /api/invoices/:id/submission.
    await mockBackend(page, {
      populated: true,
      invoiceStatus: { review: 'geprüft', submission: 'eingereicht' },
    });
    await page.goto(`/invoices/${INVOICE_ID}/submit`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Einreichung bearbeiten' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Änderungen speichern' })).toBeVisible();
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

  // Both branches of the Versicherungsnehmer block: pick an existing person, or
  // create one inline. Each swaps in a different labelled control.
  test('contract new form — person picker and inline-new-person branch', async ({ page }) => {
    await mockBackend(page, { populated: false });
    await page.goto('/contracts/new');
    await expect(page.getByRole('heading', { level: 1, name: 'Neuer Vertrag' })).toBeVisible();
    await expect(page.getByText('Noch keine Personen vorhanden.')).toBeVisible();
    await expectNoViolations(page);

    await mockBackend(page, { populated: true });
    await page.goto('/contracts/new');
    await expect(page.getByLabel('Person auswählen *')).toBeVisible();
    await expectNoViolations(page);

    await page.getByRole('checkbox', { name: 'Neue Person anlegen' }).check();
    await expect(page.getByLabel('Name *')).toBeVisible();
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
    await expect(page.getByRole('heading', { level: 1, name: PERSON.name })).toBeVisible();
    await expectNoViolations(page);
  });

  test('person new form', async ({ page }) => {
    await mockBackend(page, { populated: true });
    await page.goto('/persons/new');
    await expect(page.getByRole('heading', { level: 1, name: 'Neue Person' })).toBeVisible();
    await expect(page.getByLabel('Name *')).toBeVisible();
    await expect(page.getByLabel('Geburtsdatum')).toBeVisible();
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

  test('stats — empty and populated', async ({ page }) => {
    await mockBackend(page, { populated: false });
    await page.goto('/stats');
    await expect(page.getByRole('heading', { level: 1, name: 'Auswertung' })).toBeVisible();
    await expect(
      page.getByText('Noch keine Rechnungen oder versicherten Personen für eine Auswertung'),
    ).toBeVisible();
    await expectNoViolations(page);

    await mockBackend(page, { populated: true });
    await page.goto('/stats');
    await expect(page.getByText('Kosten vs. Erstattungen', { exact: true })).toBeVisible();
    await expect(page.getByText('BRE-Verlauf', { exact: true })).toBeVisible();
    await expectNoViolations(page);
  });

  test('settings', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Einstellungen' })).toBeVisible();
    await expectNoViolations(page);
  });
});

// Validation errors are rendered by `<Alert role="alert">` and are the only DOM
// state in which the forms' error text exists at all — scanning the pristine
// form never covers it.
test.describe('axe: form validation error states', () => {
  test('person new form rejects a blank name', async ({ page }) => {
    await mockBackend(page, { populated: true });
    await page.goto('/persons/new');
    // A single space satisfies the native `required` check, so submission
    // reaches the app's own `name.trim()` validation.
    await page.getByLabel('Name *').fill(' ');
    await page.getByRole('button', { name: 'Person anlegen' }).click();

    await expect(page.getByRole('alert')).toHaveText('Bitte den Namen eingeben.');
    await expectNoViolations(page);
  });

  test('contract new form rejects a blank inline person name', async ({ page }) => {
    await mockBackend(page, { populated: true });
    await page.goto('/contracts/new');
    await page.getByLabel('Versicherungsgesellschaft *').fill('DEVK');
    await page.getByRole('checkbox', { name: 'Neue Person anlegen' }).check();
    await page.getByRole('button', { name: 'Vertrag anlegen' }).click();

    await expect(page.getByRole('alert')).toHaveText('Bitte den Namen der neuen Person eingeben.');
    await expectNoViolations(page);
  });

  test('invoice new form rejects a missing Leistungserbringer', async ({ page }) => {
    await mockBackend(page, { populated: true });
    await page.goto('/invoices/new');
    await expect(page.getByRole('heading', { level: 1, name: 'Rechnung erfassen' })).toBeVisible();
    // The form is `novalidate`, so its own checks run on an untouched form.
    await page.getByRole('button', { name: 'Rechnung speichern' }).click();

    await expect(page.getByRole('alert')).toHaveText('Bitte den Leistungserbringer eingeben.');
    await expectNoViolations(page);
  });
});

test.describe('axe: mobile bottom navigation', () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test('the open "Mehr" overflow sheet', async ({ page }) => {
    await mockBackend(page, { populated: true });
    await page.goto('/');
    await page.getByRole('button', { name: 'Mehr' }).click();
    await expect(page.getByRole('dialog', { name: 'Weitere Navigation' })).toBeVisible();
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

  // axe validates the dialog's static ARIA; the focus contract (trap, Escape,
  // return to the opener) is invisible to it and is what actually decides
  // whether a keyboard user can get back out of a destructive confirmation.
  test('delete confirmation traps focus, closes on Escape and restores the opener', async ({
    page,
  }) => {
    await mockBackend(page, { populated: true });
    await page.goto(`/invoices/${INVOICE_ID}`);
    // Exact: the dialog's own "Ja, löschen" button matches a substring search.
    const deleteButton = page.getByRole('button', { name: 'Löschen', exact: true });
    await expect(deleteButton).toBeVisible();

    await deleteButton.click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();

    // Opening moves focus into the dialog rather than leaving it on the opener.
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);

    // Tabbing cycles inside the dialog instead of escaping into the page behind.
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Tab');
      expect(
        await dialog.evaluate((el) => el.contains(document.activeElement)),
        `focus left the dialog after ${i + 1} Tab press(es)`,
      ).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(deleteButton).toBeFocused();
  });

  // The Rechnungskopf is the a11y-critical part of the capture flow: every
  // required field must be reachable by Tab, in the order it is read.
  test('invoice form exposes its fields to Tab in visual order', async ({ page }) => {
    await mockBackend(page, { populated: true });
    await page.goto('/invoices/new');
    const insured = page.locator('#field-insured');
    await expect(insured).toBeVisible();

    await insured.focus();
    const seen = await tabbedIdsUntil(page, 'field-notes');
    const formFields = [
      'field-date',
      'field-due-date',
      'field-number',
      'field-provider',
      'field-type',
      'field-total',
      'field-notes',
    ];
    // Filtered, not compared wholesale: the OCR scanner's own controls sit
    // between the person picker and the Rechnungskopf and are not this
    // assertion's subject.
    expect(seen.filter((id) => formFields.includes(id))).toEqual(formFields);
  });
});

test.describe('keyboard operability: mobile bottom navigation', () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test('"Mehr" sheet opens, is operable and closes by keyboard alone', async ({ page }) => {
    await mockBackend(page, { populated: true });
    await page.goto('/');
    const more = page.getByRole('button', { name: 'Mehr' });
    await expect(more).toBeVisible();

    // Reachable by Tab at all — it is the last stop of the bottom nav.
    await tabTo(page, more);
    await page.keyboard.press('Enter');

    const sheet = page.getByRole('dialog', { name: 'Weitere Navigation' });
    await expect(sheet).toBeVisible();
    expect(await sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);

    // Every overflow section is reachable from inside the sheet.
    const settingsLink = sheet.getByRole('link', { name: 'Einstellungen' });
    await tabTo(page, settingsLink);

    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(more).toBeFocused();
  });
});

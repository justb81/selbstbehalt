// SPDX-License-Identifier: Apache-2.0
import { expect, test, type Page } from '@playwright/test';

// A 1×1 PNG — enough for the real capture/preprocess path to decode a frame; the
// OCR step itself is stubbed (see below), so the recognised text is fixed.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const OCR_TEXT = [
  'Praxis Dr. med. Mustermann',
  'Rechnungsdatum: 15.03.2026',
  'Rechnungs-Nr: R-2026-001',
  '250  Blutentnahme         2,3    5,36',
  '75   Krankheitsbericht    3,5   26,53',
].join('\n');

const CONTRACT_ID = '11111111-1111-4111-8111-111111111111';
const INSURED_ID = '22222222-2222-4222-8222-222222222222';
const PERSON_ID = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-01-01T00:00:00.000Z';

/** Stubs the backend the scan flow talks to; returns the captured POST body. */
async function mockApi(page: Page): Promise<{ getPostedInvoice: () => unknown }> {
  let postedInvoice: unknown = null;

  await page.route('**/api/contracts', (route) =>
    route.fulfill({
      json: [
        {
          id: CONTRACT_ID,
          policyholder_id: PERSON_ID,
          insurer_name: 'AOK',
          contract_number: 'V-1',
          type: 'vollversicherung',
          start_date: '2020-01-01',
          created_at: NOW,
        },
      ],
    }),
  );

  await page.route(`**/api/contracts/${CONTRACT_ID}/insured`, (route) =>
    route.fulfill({
      json: [
        {
          id: INSURED_ID,
          contract_id: CONTRACT_ID,
          person_id: PERSON_ID,
          kvnr: 'A123456789',
          tariff_name: 'PrivatComfort',
          monthly_premium: 450,
          self_retention: 0,
          created_at: NOW,
        },
      ],
    }),
  );

  await page.route('**/api/invoices', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    postedInvoice = route.request().postDataJSON();
    const body = postedInvoice as Record<string, unknown>;
    await route.fulfill({
      json: {
        id: '44444444-4444-4444-8444-444444444444',
        insured_person_id: body.insured_person_id,
        invoice_date: body.invoice_date,
        invoice_number: body.invoice_number ?? null,
        provider_name: body.provider_name,
        provider_type: body.provider_type ?? null,
        total_amount: body.total_amount,
        self_paid_amount: 0,
        status: 'neu',
        created_at: NOW,
        positions: [],
      },
    });
  });

  return { getPostedInvoice: () => postedInvoice };
}

test('scan → parse → save files a metadata-only invoice', async ({ page }) => {
  const { getPostedInvoice } = await mockApi(page);

  await page.goto('/invoices/new');
  await expect(page.getByRole('heading', { level: 1, name: 'Rechnung erfassen' })).toBeVisible();

  // Open the OCR scanner section (issue #109: scanner is now inside the form).
  await page.getByRole('button', { name: 'Rechnung scannen / hochladen' }).click();

  // Drive the scan from fixture text via the dev-only hook: it bypasses the
  // headless-incompatible image codec and the model-downloading OCR binding,
  // while the upload UI, parsing, and save all run for real.
  await page.waitForFunction(
    () =>
      typeof (window as unknown as { __selbstbehaltStubScan?: unknown }).__selbstbehaltStubScan ===
      'function',
  );
  await page.evaluate(
    (text) =>
      (window as unknown as { __selbstbehaltStubScan: (t: string) => void }).__selbstbehaltStubScan(
        text,
      ),
    OCR_TEXT,
  );

  // Upload a fixture image; the flow preprocesses, OCRs and parses it.
  await page.setInputFiles('input[type="file"]', {
    name: 'rechnung.png',
    mimeType: 'image/png',
    buffer: PNG_1x1,
  });

  // Review screen: parsed header + the §5-flagged position are shown.
  await expect(page.getByLabel('Leistungserbringer')).toHaveValue('Praxis Dr. med. Mustermann');
  await expect(page.getByLabel('Rechnungsdatum')).toHaveValue('2026-03-15');
  await expect(page.getByText(/Steigerungsfaktor/)).toBeVisible();

  // shadcn Select is not a native <select> — open the trigger, then click the option.
  await page.getByLabel('Versicherte Person').click();
  await page.getByRole('option', { name: 'AOK · PrivatComfort' }).click();
  await page.getByRole('button', { name: 'Rechnung speichern' }).click();

  // Lands on the invoice detail (where the Günstigerprüfung lives).
  await expect(page).toHaveURL(/\/invoices\/44444444-4444-4444-8444-444444444444$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Rechnungsdetail' })).toBeVisible();

  // Privacy: only metadata is sent — no image, no raw file (§8.2). OCR text is
  // saved by default so the user can re-parse later; it can be opted out in the UI.
  const posted = getPostedInvoice() as Record<string, unknown>;
  expect(posted.insured_person_id).toBe(INSURED_ID);
  expect(posted.provider_name).toBe('Praxis Dr. med. Mustermann');
  expect(posted.total_amount).toBeCloseTo(31.89);
  expect(posted.ocr_raw).toBe(OCR_TEXT);
  expect(posted).not.toHaveProperty('file_path');
  expect(Array.isArray(posted.positions)).toBe(true);
});

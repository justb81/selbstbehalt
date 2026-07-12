// SPDX-License-Identifier: Apache-2.0
// Verifies the shared InvoiceList on the Rechnungsarchiv: Person tabs, the
// provider-type column, and the whole row being a link to the detail.
import { expect, test, type Page } from '@playwright/test';

const NOW = '2026-01-01T00:00:00.000Z';

const P_ALICE = '20000000-0000-4000-8000-000000000001';
const P_BOB = '20000000-0000-4000-8000-000000000002';
const CONTRACT_ID = '20000000-0000-4000-8000-000000000003';
const IP_A = '20000000-0000-4000-8000-000000000004';
const IP_B = '20000000-0000-4000-8000-000000000005';
const INV_A = '20000000-0000-4000-8000-000000000006';
const INV_B = '20000000-0000-4000-8000-000000000007';

const ALICE = { id: P_ALICE, name: 'Alice Anders', birth_date: null, created_at: NOW };
const BOB = { id: P_BOB, name: 'Bob Berg', birth_date: null, created_at: NOW };

const CONTRACT = {
  id: CONTRACT_ID,
  policyholder_id: P_ALICE,
  insurer_name: 'AOK',
  contract_number: 'V-1',
  type: 'vollversicherung',
  start_date: '2020-01-01',
  end_date: null,
  notes: null,
  created_at: NOW,
};

function insured(id: string, personId: string) {
  return {
    id,
    contract_id: CONTRACT_ID,
    person_id: personId,
    kvnr: null,
    tariff_name: null,
    monthly_premium: 450,
    self_retention: 0,
    bre_structure: null,
    included_benefits: null,
    start_date: null,
    end_date: null,
    notes: null,
    created_at: NOW,
  };
}

function invoiceItem(over: {
  id: string;
  insured_person_id: string;
  provider_name: string;
  provider_type: string;
  total_amount: number;
}) {
  return {
    invoice_date: '2026-03-15',
    invoice_number: 'R-001',
    status: { review: 'neu', payment: 'offen', submission: 'nicht_eingereicht', paid_on: null },
    file_path: null,
    ocr_raw: null,
    notes: null,
    eligible_amount: null,
    self_paid_amount: 0,
    created_at: NOW,
    ...over,
  };
}

const INVOICE_A = invoiceItem({
  id: INV_A,
  insured_person_id: IP_A,
  provider_name: 'Dr. Arzt',
  provider_type: 'arzt',
  total_amount: 100,
});
const INVOICE_B = invoiceItem({
  id: INV_B,
  insured_person_id: IP_B,
  provider_name: 'Zahnarzt Weber',
  provider_type: 'zahnarzt',
  total_amount: 200,
});

async function mock(page: Page): Promise<void> {
  await page.route('**/api/persons', (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: [ALICE, BOB] }) : r.fallback(),
  );
  await page.route('**/api/contracts', (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: [CONTRACT] }) : r.fallback(),
  );
  await page.route('**/api/contracts/*/insured', (r) =>
    r.request().method() === 'GET'
      ? r.fulfill({ json: [insured(IP_A, P_ALICE), insured(IP_B, P_BOB)] })
      : r.fallback(),
  );
  await page.route('**/api/invoices*', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    if (new URL(route.request().url()).pathname === '/api/invoices') {
      return route.fulfill({ json: [INVOICE_A, INVOICE_B] });
    }
    return route.fallback();
  });
  // Detail fetch after a row click — enough to keep the detail page happy.
  await page.route('**/api/invoices/*', (r) =>
    r.request().method() === 'GET'
      ? r.fulfill({ json: { ...INVOICE_A, positions: [] } })
      : r.fallback(),
  );
}

test('Person tabs, provider-type column and whole-row link', async ({ page }) => {
  await mock(page);
  await page.goto('/invoices');

  await expect(page.getByRole('heading', { level: 1, name: 'Rechnungen' })).toBeVisible();

  // Both invoices show, with their provider-type badges.
  await expect(page.getByRole('link', { name: 'Dr. Arzt' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Zahnarzt Weber' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Arzt', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Zahnarzt', exact: true })).toBeVisible();

  // Person tabs render and filter the list.
  await expect(page.getByRole('tab', { name: 'Alle' })).toBeVisible();
  await page.getByRole('tab', { name: 'Bob Berg' }).click();
  await expect(page.getByRole('link', { name: 'Dr. Arzt' })).toBeHidden();
  await expect(page.getByRole('link', { name: 'Zahnarzt Weber' })).toBeVisible();

  await page.getByRole('tab', { name: 'Alle' }).click();
  await expect(page.getByRole('link', { name: 'Dr. Arzt' })).toBeVisible();

  // The whole row is clickable: clicking the amount cell (not the link text)
  // lands on the invoice detail. `force` bypasses the actionability guard that
  // (correctly) reports the stretched-link overlay intercepting the cell — the
  // trusted click still hits that overlay and navigates.
  await page.getByRole('cell', { name: /100,00/ }).click({ force: true });
  await expect(page).toHaveURL(new RegExp(`/invoices/${INV_A}$`));
});

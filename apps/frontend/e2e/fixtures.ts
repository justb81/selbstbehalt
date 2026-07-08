// SPDX-License-Identifier: Apache-2.0
// Shared read-only backend mocks for e2e specs that need a populated app without
// a live backend (this e2e project only starts the frontend dev/preview servers).
import type { Page } from '@playwright/test';

export const NOW = '2026-01-01T00:00:00.000Z';
export const PERSON_ID = '10000000-0000-4000-8000-000000000001';
export const CONTRACT_ID = '10000000-0000-4000-8000-000000000002';
export const INSURED_ID = '10000000-0000-4000-8000-000000000003';
export const INVOICE_ID = '10000000-0000-4000-8000-000000000004';
const POSITION_OK_ID = '10000000-0000-4000-8000-000000000005';
const POSITION_FLAGGED_ID = '10000000-0000-4000-8000-000000000006';

export const PERSON = {
  id: PERSON_ID,
  name: 'Max Mustermann',
  birth_date: '1985-06-15',
  created_at: NOW,
};

export const CONTRACT = {
  id: CONTRACT_ID,
  policyholder_id: PERSON_ID,
  insurer_name: 'AOK',
  contract_number: 'V-1',
  type: 'vollversicherung',
  start_date: '2020-01-01',
  end_date: null,
  notes: null,
  created_at: NOW,
};

export const INSURED = {
  id: INSURED_ID,
  contract_id: CONTRACT_ID,
  person_id: PERSON_ID,
  kvnr: 'A123456789',
  tariff_name: 'PrivatComfort',
  monthly_premium: 450,
  self_retention: 500,
  bre_structure: null,
  included_benefits: null,
  start_date: null,
  end_date: null,
  notes: null,
  created_at: NOW,
};

const POSITIONS = [
  {
    id: POSITION_OK_ID,
    invoice_id: INVOICE_ID,
    goae_number: '1',
    goae_category: 'GOÄ',
    quantity: 1,
    treatment_date: '2026-03-15',
    description: 'Beratung',
    multiplier: 2.3,
    base_amount: 10,
    charged_amount: 23,
    eligible_amount: 23,
    refund_amount: null,
    is_valid: true,
    flag_reason: null,
  },
  {
    id: POSITION_FLAGGED_ID,
    invoice_id: INVOICE_ID,
    goae_number: '5',
    goae_category: 'GOÄ',
    quantity: 1,
    treatment_date: '2026-03-15',
    description: 'Untersuchung',
    multiplier: 3.5,
    base_amount: 10,
    charged_amount: 35,
    eligible_amount: 31.89,
    refund_amount: null,
    is_valid: false,
    flag_reason: 'Steigerungsfaktor überschreitet den zulässigen Höchstwert (2,3)',
  },
];

// `GET /api/invoices` returns bare invoices (invoiceListSchema); positions are
// only present on the `GET /api/invoices/:id` detail shape — mixing them up trips
// the client's strict Zod validation and silently renders an error state.
export const INVOICE_LIST_ITEM = {
  id: INVOICE_ID,
  insured_person_id: INSURED_ID,
  invoice_date: '2026-03-15',
  invoice_number: 'R-2026-001',
  provider_name: 'Praxis Dr. med. Mustermann',
  provider_type: null,
  total_amount: 58,
  status: 'neu',
  file_path: null,
  ocr_raw: null,
  notes: null,
  eligible_amount: 54.89,
  self_paid_amount: 0,
  created_at: NOW,
};

export const INVOICE = { ...INVOICE_LIST_ITEM, positions: POSITIONS };

export const BRE_HISTORY = {
  insured_person_id: INSURED_ID,
  years: [
    { year: 2025, streak_years: 1, bre_amount: 0, projected_bre: 900 },
    { year: 2026, streak_years: 2, bre_amount: 900, projected_bre: 1800 },
  ],
};

/** Wires up read-only mocks for the backend the covered routes call. */
export async function mockBackend(
  page: Page,
  { populated }: { populated: boolean },
): Promise<void> {
  const persons = populated ? [PERSON] : [];
  const contracts = populated ? [CONTRACT] : [];
  const insured = populated ? [INSURED] : [];
  const invoices = populated ? [INVOICE_LIST_ITEM] : [];

  await page.route('**/api/persons', (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: persons }) : route.fallback(),
  );
  await page.route('**/api/persons/*', (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: PERSON }) : route.fallback(),
  );
  await page.route('**/api/contracts', (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: contracts }) : route.fallback(),
  );
  await page.route('**/api/contracts/*', (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: CONTRACT }) : route.fallback(),
  );
  await page.route('**/api/contracts/*/insured', (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: insured }) : route.fallback(),
  );
  await page.route('**/api/insured/*', (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: INSURED }) : route.fallback(),
  );
  await page.route('**/api/invoices*', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const url = new URL(route.request().url());
    if (url.pathname === '/api/invoices') return route.fulfill({ json: invoices });
    return route.fallback();
  });
  await page.route('**/api/invoices/*', (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: INVOICE }) : route.fallback(),
  );
  await page.route('**/api/stats/year/*', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const year = Number(new URL(route.request().url()).pathname.split('/').pop());
    return route.fulfill({
      json: populated
        ? {
            year,
            invoice_count: 1,
            total_amount: 58,
            eligible_amount: 54.89,
            self_paid_amount: 0,
            refund_amount: 0,
            bre_amount: 0,
          }
        : {
            year,
            invoice_count: 0,
            total_amount: 0,
            eligible_amount: 0,
            self_paid_amount: 0,
            refund_amount: 0,
            bre_amount: 0,
          },
    });
  });
  await page.route('**/api/stats/bre/*', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          json: populated ? BRE_HISTORY : { insured_person_id: INSURED_ID, years: [] },
        })
      : route.fallback(),
  );
  // Positions roll-up per Leistungsjahr (#239) — feeds the Selbstbehalt radar (#234).
  await page.route('**/api/stats/positions/*', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          json: populated
            ? {
                insured_person_id: INSURED_ID,
                years: [
                  {
                    year: new Date().getFullYear(),
                    charged_amount: 58,
                    eligible_amount: 54.89,
                    refund_amount: 0,
                  },
                ],
              }
            : { insured_person_id: INSURED_ID, years: [] },
        })
      : route.fallback(),
  );
}

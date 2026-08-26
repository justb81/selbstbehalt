// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
//
// Client↔Server-Integration against the real API (issue #378). The frontend
// validates every response with a strict Zod schema, so a drift between what the
// server sends and what the client expects surfaces as a silent error state —
// a class of bug the fully mocked suite cannot find by construction, because it
// asserts against hand-written responses. Every page here therefore renders
// real data end-to-end: the list and the detail shape of the same invoice, the
// per-Leistungsjahr roll-ups, the year statistics, and the real 404 path.

import { expect, test } from './backend';
import { CURRENT_YEAR, scenarios } from './scenarios';

test('Rechnungsarchiv: Listen- und Detail-Shape derselben Rechnung', async ({ page, seed }) => {
  const { invoices, persons } = await scenarios.familie_zwei_vertraege(seed);

  await page.goto('/invoices');
  await expect(page.getByRole('heading', { level: 1, name: 'Rechnungen' })).toBeVisible();

  // All three invoices come from `GET /api/invoices` (the bare list shape).
  await expect(page.getByRole('link', { name: 'Praxis Dr. Müller' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Kinderarztpraxis Sonne' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Klinik am Park' })).toBeVisible();

  // Person tabs are built from the real persons + insured_persons endpoints.
  await expect(page.getByRole('tab', { name: 'Alle' })).toBeVisible();
  await page.getByRole('tab', { name: persons.jonas.name }).click();
  await expect(page.getByRole('link', { name: 'Praxis Dr. Müller' })).toBeHidden();
  await expect(page.getByRole('link', { name: 'Klinik am Park' })).toBeVisible();

  // …and the detail shape (`GET /api/invoices/:id`, invoice + positions) parses too.
  await page.getByRole('link', { name: 'Klinik am Park' }).click();
  await expect(page).toHaveURL(new RegExp(`/invoices/${invoices.jonas.id}$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Klinik am Park' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '0034' })).toBeVisible();
});

test('Versicherte Person: Roll-up je Leistungsjahr über zwei Jahre', async ({ page, seed }) => {
  const { insured, invoice, selfPaidAmount } = await scenarios.staffel_zwei_leistungsjahre(seed);

  await page.goto(`/insured/${insured.id}`);
  // The heading names the person; her tariff sits in the badge row (#358).
  await expect(page.getByRole('heading', { level: 1, name: 'Miriam Kraus' })).toBeVisible();
  await expect(page.getByText('Tarif: ZahnStaffel')).toBeVisible();
  await expect(page.getByText('Selbstbehalt: 400,00')).toBeVisible();

  // The invoice's positions fall into two Leistungsjahre, so the Günstigerprüfung
  // is shown per year — driven by `treatment_date`, not by `invoice_date`.
  await expect(
    page.getByRole('heading', { name: 'Günstigerprüfung je Leistungsjahr' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: String(CURRENT_YEAR) })).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 3, name: String(CURRENT_YEAR - 1) }),
  ).toBeVisible();

  // Realised reimbursements for the current year exceed the Selbstbehalt.
  await expect(page.getByText('Staffel gerissen', { exact: true })).toBeVisible();

  // The server recomputed self_paid_amount when the refund was recorded.
  expect((await seed.getInvoice(invoice.id)).self_paid_amount).toBeCloseTo(selfPaidAmount, 2);
});

test('Auswertung: Jahreskennzahlen kommen aus /api/stats/year', async ({ page, seed }) => {
  await scenarios.staffel_zwei_leistungsjahre(seed);

  await page.goto('/stats');
  await expect(page.getByRole('heading', { level: 1, name: 'Auswertung' })).toBeVisible();

  const kpi = (description: string) =>
    page
      .locator('[data-slot="card"]')
      .filter({ hasText: description })
      .locator('[data-slot="card-content"] p')
      .first();

  await expect(kpi(`Rechnungen ${CURRENT_YEAR}`)).toHaveText('1');
  await expect(kpi('Gesamtkosten')).toHaveText(/2\.000,00/);
  // Σ refund_amount of the positions whose submission was reimbursed this year.
  await expect(kpi('Erstattet')).toHaveText(/1\.320,00/);
});

test('Stammdaten: Personen und Verträge kommen aus der echten API', async ({ page, seed }) => {
  const { persons, contracts } = await scenarios.familie_zwei_vertraege(seed);

  await page.goto('/persons');
  await expect(page.getByText(persons.erika.name)).toBeVisible();
  await expect(page.getByText(persons.jonas.name)).toBeVisible();

  await page.goto('/contracts');
  await expect(page.getByText(contracts.familienvertrag.insurer_name)).toBeVisible();
  await expect(page.getByText(contracts.partnervertrag.insurer_name)).toBeVisible();
});

test('Fehlerpfad: ein echtes 404 des Servers landet im Fehlerzustand', async ({ page }) => {
  await page.goto('/invoices/00000000-0000-4000-8000-000000000000');

  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible();
  await expect(page.getByRole('button', { name: 'Erneut versuchen' })).toBeVisible();
});

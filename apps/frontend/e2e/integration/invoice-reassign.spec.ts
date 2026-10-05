// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
//
// „Person ändern" (issue #533): a mixed-up Rechnungsempfänger is corrected even on
// an invoice the edit form locks (paid and submitted). The status tracks must
// survive the move; only the assignment and the tariff estimate change.

import { expect, test } from './backend';
import { scenarios } from './scenarios';

test('eine bezahlte, eingereichte Rechnung lässt sich einer anderen Person zuordnen', async ({
  page,
  seed,
}) => {
  const { invoices, insured } = await scenarios.familie_zwei_vertraege(seed);
  const invoice = invoices.lena;

  await page.goto(`/invoices/${invoice.id}`);
  await expect(page.getByRole('heading', { level: 1, name: invoice.provider_name })).toBeVisible();
  // Locked for editing …
  await expect(page.getByRole('link', { name: 'Bearbeiten' })).toHaveCount(0);

  // … but the person can still be changed.
  await page.getByRole('button', { name: 'Person ändern' }).click();
  const dialog = page.getByRole('alertdialog');
  await dialog.getByLabel('Versicherte Person').click();
  await page.getByRole('option', { name: /Erika Mustermann/ }).click();
  await dialog.getByRole('button', { name: 'Person ändern' }).click();
  await expect(dialog).toBeHidden();

  const summary = page.locator('[data-slot="card"]').filter({ hasText: 'Versicherte Person' });
  await expect(summary).toContainText('Erika Mustermann');

  const persisted = await seed.getInvoice(invoice.id);
  expect(persisted.insured_person_id).toBe(insured.erika.id);
  expect(persisted.status).toMatchObject({ payment: 'bezahlt', submission: 'eingereicht' });
});

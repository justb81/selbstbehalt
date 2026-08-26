// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
//
// The full invoice lifecycle driven through the UI against a real backend
// (issue #378). This is the check the mocked suite cannot do: every transition
// is written to SQLite as a status event, read back through the derived
// `status` object, and the amounts (`self_paid_amount`, per-position
// `refund_amount`) are recomputed server-side. A reload plus a direct API read
// at the end prove the state came from the database, not from component state.

import { expect, test } from './backend';
import { CURRENT_YEAR, scenarios } from './scenarios';

const PAID_ON = `${CURRENT_YEAR}-02-01`;

/** Per-position refund amounts of a persisted invoice, keyed by GOÄ-Ziffer. */
function refundsByZiffer(
  positions: { goae_number: string; refund_amount?: number | null }[],
): Record<string, number | null | undefined> {
  return Object.fromEntries(positions.map((p) => [p.goae_number, p.refund_amount]));
}

test('Prüfung, Zahlung und Einreichung/Erstattung laufen end-to-end durch', async ({
  page,
  seed,
}) => {
  const { invoice } = await scenarios.baseline(seed);

  await page.goto(`/invoices/${invoice.id}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Praxis Dr. Nowak' })).toBeVisible();

  const workflow = page.locator('[data-slot="card"]').filter({ hasText: 'Workflow' });
  await expect(workflow).toContainText('Geprüft');
  await expect(workflow).toContainText('Offen');
  await expect(workflow).toContainText('Nicht eingereicht');

  // ── Track 1: Prüfung zurücknehmen und erneut prüfen ───────────────────────
  await workflow.getByRole('button', { name: 'Prüfung zurücknehmen' }).click();
  await expect(workflow).toContainText('Neu');
  // Both other tracks stay locked until the invoice is geprüft.
  await expect(workflow).toContainText('Erst nach der Prüfung möglich.');

  await workflow.getByRole('button', { name: 'Als geprüft markieren' }).click();
  await expect(workflow).toContainText('Geprüft');

  // ── Track 2: Zahlung an den Arzt ──────────────────────────────────────────
  await workflow.getByRole('button', { name: 'Als bezahlt markieren' }).click();
  await page.getByLabel('Zahlungsdatum').fill(PAID_ON);
  await workflow.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(workflow).toContainText('Bezahlt');

  // ── Track 3: Einreichung ──────────────────────────────────────────────────
  await workflow.getByRole('button', { name: 'Einreichen …' }).click();
  await expect(page).toHaveURL(new RegExp(`/invoices/${invoice.id}/submit$`));
  await page.getByRole('button', { name: 'Einreichung speichern' }).click();
  await expect(page).toHaveURL(new RegExp(`/invoices/${invoice.id}$`));
  await expect(workflow).toContainText('Eingereicht');

  // ── Track 3: Erstattung je Position erfassen ──────────────────────────────
  // Only the compliant Ziffer is reimbursable; the flagged one is rejected (0 €).
  await workflow.getByRole('button', { name: 'Erstattung erfassen' }).click();
  await workflow.getByRole('tab', { name: 'Je Position' }).click();
  await workflow.getByLabel('Erstattungsbetrag für Position 0001').fill('10.72');
  await workflow.getByLabel('Erstattungsbetrag für Position 0005').fill('0');
  await workflow.getByRole('button', { name: 'Erstattung speichern' }).click();
  await expect(workflow).toContainText('Erstattet');

  // ── Persistiert? Neu laden und beim Server gegenprüfen ────────────────────
  await page.reload();
  await expect(workflow).toContainText('Geprüft');
  await expect(workflow).toContainText('Bezahlt');
  await expect(workflow).toContainText('Erstattet');

  const persisted = await seed.getInvoice(invoice.id);
  expect(persisted.status).toMatchObject({
    review: 'geprüft',
    payment: 'bezahlt',
    submission: 'erstattet',
    paid_on: PAID_ON,
  });
  expect(refundsByZiffer(persisted.positions)).toEqual({ '0001': 10.72, '0005': 0 });
  // self_paid_amount = Σ charged − Σ refund, recomputed by the server.
  expect(persisted.self_paid_amount).toBeCloseTo(16.31, 2);
});

test('Statusverlauf und Sperren spiegeln die echten Serverregeln', async ({ page, seed }) => {
  const { invoice } = await scenarios.baseline(seed);
  await seed.markPaid(invoice.id, PAID_ON);

  await page.goto(`/invoices/${invoice.id}`);
  const workflow = page.locator('[data-slot="card"]').filter({ hasText: 'Workflow' });
  await expect(workflow).toContainText('Bezahlt');

  // Edit-lock (paid or submitted) — the detail page hides "Bearbeiten"…
  await expect(page.getByRole('link', { name: 'Bearbeiten' })).toHaveCount(0);
  // …and the review track can no longer be reverted while a payment is booked.
  await expect(workflow.getByRole('button', { name: 'Prüfung zurücknehmen' })).toBeDisabled();

  // The append-only event log is served by the backend, not synthesised client-side.
  await expect(workflow).toContainText('GOÄ-Prüfung abgeschlossen');
});

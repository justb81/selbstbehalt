// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
/**
 * Whether an invoice has anything to submit to the insurer at all.
 *
 * Some invoices are generally non-reimbursable under the tariff — the typical case
 * is a pure Hilfsmittel-Rechnung (Sanitätshaus: Einlagen, Bandagen) in a tariff
 * without a Hilfsmittel-Baustein. They are still recorded: their cost belongs in the
 * Jahresauswertung and they are a real payment obligation. What must **not** happen
 * is that they look like unfinished work in the Einreichungs-Track, or that their
 * amount lands in `R_Y` and consumes the Selbstbehalt.
 *
 * The `R_Y` half is handled by the Erstattungs-Engine: a benefit area the tariff has
 * no rule for yields `eligible_amount = 0`, and `aggregateByYear` /
 * `GET /api/stats/positions` then sum zero for it. This helper covers the
 * process half — it is a **display** predicate, deliberately derived rather than a
 * persisted flag or a fourth `submission` status, so it cannot drift out of sync with
 * the amounts it describes.
 *
 * Pure and injection-free.
 */
import type { Invoice } from '@selbstbehalt/shared';

/** The minimum an invoice must expose to judge whether submitting it is pointless. */
export type ReimbursabilityInvoice = Pick<Invoice, 'eligible_amount' | 'status'>;

/**
 * True when the tariff reimburses nothing for this invoice and no submission has
 * happened — i.e. "Einreichen entfällt" rather than "noch nicht eingereicht".
 *
 * Three cases it deliberately excludes:
 *  - `eligible_amount === null` means **unknown**, not zero: the insured person has no
 *    `included_benefits`/`start_date`, or the invoice has no positions. Strict `=== 0`
 *    keeps those on the ordinary "nicht eingereicht" path.
 *  - An already `eingereicht`/`erstattet` invoice was evidently worth submitting;
 *    its history wins over the estimate.
 *  - A mixed invoice (GOÄ 400 € + Hilfsmittel 300 €) has `eligible_amount = 400` and
 *    is submitted normally — only the Hilfsmittel share goes unreimbursed.
 */
export function isNonReimbursable(invoice: ReimbursabilityInvoice): boolean {
  return invoice.eligible_amount === 0 && invoice.status.submission === 'nicht_eingereicht';
}

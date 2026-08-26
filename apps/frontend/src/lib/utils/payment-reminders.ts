// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
//
// Fälligkeits-Kennzeichnung für Rechnungen (issue #288) — marries the user's
// settings (default payment term, reminder lead time, on/off) with the pure
// Zahlungsziel math in `@selbstbehalt/shared` (`utils/payment-due.ts`).
//
// The app deliberately has no push/OS notifications: there is no server to send
// them and a self-hosted PWA cannot schedule them reliably. "Benachrichtigung"
// here means silent UI marking — a badge on the invoice and a count on the
// dashboard — so the lead time only decides when something is *flagged*.
//
// Pure and deterministic: the reference day is injectable via `asOf`.

import {
  daysUntilDue,
  paymentDueState,
  resolvePaymentDueDate,
  type DateInput,
  type Invoice,
  type PaymentDueState,
} from '@selbstbehalt/shared';

/** Settings-derived inputs for the classification. */
export interface PaymentDueOptions {
  /** Reminder lead time in days, or `null` when Fälligkeits-Hinweise are off. */
  leadDays: number | null;
  /** Standard-Zahlungsfrist, applied to invoices without a stored Zahlungsziel. */
  termDays: number;
  /** Reference day; defaults to today. */
  asOf?: DateInput;
}

/** An invoice together with its resolved Zahlungsziel and state. */
export interface DueInvoice {
  invoice: Invoice;
  /** The effective Zahlungsziel (stored, or derived from the invoice date). */
  dueDate: string;
  /** Calendar days until `dueDate`; negative once it has passed. */
  days: number;
  state: PaymentDueState;
}

/** Every state that exists purely to draw attention to a Zahlungsziel. */
const SUPPRESSED_WHEN_OFF: Partial<Record<PaymentDueState, PaymentDueState>> = {
  ueberfaellig: 'offen',
  faellig_bald: 'offen',
  terminiert_spaet: 'terminiert',
};

/**
 * Classifies one invoice against its Zahlungsziel. With `leadDays: null`
 * (Fälligkeits-Hinweise off) every attention-drawing state collapses to its
 * neutral counterpart, so no consumer can flag anything behind the user's back.
 */
export function classifyInvoiceDue(invoice: Invoice, options: PaymentDueOptions): DueInvoice {
  const { leadDays, termDays, asOf } = options;
  const dueDate = resolvePaymentDueDate(invoice, termDays);
  const state = paymentDueState({
    dueDate,
    payment: invoice.status.payment,
    paidOn: invoice.status.paid_on,
    asOf,
    leadDays: leadDays ?? 0,
  });
  return {
    invoice,
    dueDate,
    days: daysUntilDue(dueDate, asOf),
    state: leadDays === null ? (SUPPRESSED_WHEN_OFF[state] ?? state) : state,
  };
}

/** Overdue first, then by Zahlungsziel, then by provider for a stable order. */
function byUrgency(a: DueInvoice, b: DueInvoice): number {
  return (
    a.dueDate.localeCompare(b.dueDate) ||
    a.invoice.provider_name.localeCompare(b.invoice.provider_name, 'de')
  );
}

/** The invoices needing attention, grouped by what is wrong with them. */
export interface DueSummary {
  /** Unpaid and past their Zahlungsziel. */
  overdue: DueInvoice[];
  /** Unpaid and due within the lead time (including today). */
  dueSoon: DueInvoice[];
  /** Paid as a Terminüberweisung whose scheduled day is after the Zahlungsziel. */
  scheduledLate: DueInvoice[];
}

/**
 * Buckets a list of invoices for the dashboard. Empty across the board when
 * Fälligkeits-Hinweise are switched off.
 */
export function summarizeDueInvoices(
  invoices: readonly Invoice[],
  options: PaymentDueOptions,
): DueSummary {
  const summary: DueSummary = { overdue: [], dueSoon: [], scheduledLate: [] };
  if (options.leadDays === null) return summary;

  for (const invoice of invoices) {
    const due = classifyInvoiceDue(invoice, options);
    if (due.state === 'ueberfaellig') summary.overdue.push(due);
    else if (due.state === 'faellig_bald') summary.dueSoon.push(due);
    else if (due.state === 'terminiert_spaet') summary.scheduledLate.push(due);
  }

  summary.overdue.sort(byUrgency);
  summary.dueSoon.sort(byUrgency);
  summary.scheduledLate.sort(byUrgency);
  return summary;
}

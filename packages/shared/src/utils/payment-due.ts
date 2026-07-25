// SPDX-License-Identifier: Apache-2.0
//
// Zahlungsziel-Helfer — pure, deterministic math around an invoice's payment due
// date (docs/design.md §3.2, issue #288).
//
// Domain background: a doctor's invoice is formally due immediately, but the
// payer only falls into Verzug 30 days after the invoice date — so the realistic
// Zahlungsziel is `invoice_date + 30 days` unless the invoice names its own term
// ("zahlbar innerhalb 14 Tagen", "Zahlbar bis 15.08.2026").
//
// Two dates must not be conflated:
//   - `payment_due_date` — when the invoice *must be* paid (this module).
//   - `status.paid_on`   — when it *was* paid, derived from the `bezahlt` event.
//     A Terminüberweisung (scheduled bank transfer) is recorded as `bezahlt` with
//     a `paid_on` in the future: the payment is arranged but not yet executed, so
//     such an invoice is never overdue — see `paymentDueState`.
//
// Design rules (as everywhere in this package): pure and deterministic, with the
// reference day injectable via `asOf` — no hidden `Date.now()` in the math.

import { addDays, differenceInCalendarDays } from 'date-fns';

import type { PaymentStatus } from '../enums.js';
import { toCalendarDate, type DateInput } from './bre.js';
import { toIsoDate } from './date.js';

/**
 * Default payment term in days. §286 Abs. 3 BGB puts a consumer into Verzug 30
 * days after receiving the invoice, which is the realistic Zahlungsziel when the
 * invoice itself is silent (or only says "sofort fällig").
 */
export const DEFAULT_PAYMENT_TERM_DAYS = 30;

/** Default lead time for flagging an upcoming Zahlungsziel in the UI. */
export const DEFAULT_PAYMENT_REMINDER_LEAD_DAYS = 7;

/** Adds `days` calendar days to an ISO date (`YYYY-MM-DD`), returning ISO again. */
export function addDaysIso(iso: string, days: number): string {
  return toIsoDate(addDays(toCalendarDate(iso), days));
}

/** The Zahlungsziel implied by an invoice date and a payment term. */
export function defaultPaymentDueDate(
  invoiceDate: string,
  termDays: number = DEFAULT_PAYMENT_TERM_DAYS,
): string {
  return addDaysIso(invoiceDate, termDays);
}

/**
 * The effective Zahlungsziel of an invoice: the stored `payment_due_date` when
 * present, otherwise `invoice_date + termDays`. Invoices created before the field
 * existed carry `null` and therefore follow the currently configured term rather
 * than a frozen value.
 */
export function resolvePaymentDueDate(
  invoice: { invoice_date: string; payment_due_date?: string | null },
  termDays: number = DEFAULT_PAYMENT_TERM_DAYS,
): string {
  return invoice.payment_due_date ?? defaultPaymentDueDate(invoice.invoice_date, termDays);
}

/**
 * Calendar days from `asOf` until `dueDate`: `0` on the due date itself, negative
 * once it has passed.
 */
export function daysUntilDue(dueDate: string, asOf: DateInput = new Date()): number {
  return differenceInCalendarDays(toCalendarDate(dueDate), toCalendarDate(asOf));
}

/**
 * How an invoice stands relative to its Zahlungsziel.
 *
 * - `ueberfaellig` — unpaid and the Zahlungsziel has passed.
 * - `faellig_bald` — unpaid and due within the reminder lead time (incl. today).
 * - `offen` — unpaid, but still further out than the lead time.
 * - `terminiert` — paid with a `paid_on` in the future (Terminüberweisung), on time.
 * - `terminiert_spaet` — same, but the scheduled day lies after the Zahlungsziel.
 * - `bezahlt` — paid, the payment day has arrived or passed.
 */
export type PaymentDueState =
  'ueberfaellig' | 'faellig_bald' | 'offen' | 'terminiert' | 'terminiert_spaet' | 'bezahlt';

/**
 * Classifies an invoice against its Zahlungsziel. A `bezahlt` invoice is never
 * overdue — a Terminüberweisung (future `paid_on`) counts as arranged, and only
 * the *lateness of the scheduled day* is worth flagging.
 */
export function paymentDueState({
  dueDate,
  payment,
  paidOn,
  asOf = new Date(),
  leadDays = DEFAULT_PAYMENT_REMINDER_LEAD_DAYS,
}: {
  dueDate: string;
  payment: PaymentStatus;
  paidOn?: string | null;
  asOf?: DateInput;
  leadDays?: number;
}): PaymentDueState {
  if (payment === 'bezahlt') {
    if (!paidOn || daysUntilDue(paidOn, asOf) <= 0) return 'bezahlt';
    return daysUntilDue(dueDate, paidOn) < 0 ? 'terminiert_spaet' : 'terminiert';
  }
  const days = daysUntilDue(dueDate, asOf);
  if (days < 0) return 'ueberfaellig';
  return days <= leadDays ? 'faellig_bald' : 'offen';
}

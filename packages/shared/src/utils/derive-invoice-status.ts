// SPDX-License-Identifier: Apache-2.0
//
// The invoice lifecycle has no denormalised status column: `invoice_status_events`
// is the single source of truth, and the current state is *derived* here as the
// latest event per track. Payment and submission are independent tracks, so the
// derived value is a small multivalue object rather than one linear status.

import { z } from 'zod';

import { isoDate } from '../common.js';
import {
  paymentStatusSchema,
  reviewStatusSchema,
  submissionStatusSchema,
  type StatusTrack,
} from '../enums.js';
import type { InvoiceStatusEvent } from '../schemas/invoice-status-event.js';

/**
 * Derived lifecycle state of an invoice — the latest value of each of the three
 * tracks (server-computed, read-only on the client). `paid_on` is the ISO date of
 * the most recent `bezahlt` payment event, or null while payment is `offen`.
 */
export const invoiceStatusSchema = z
  .object({
    review: reviewStatusSchema,
    payment: paymentStatusSchema,
    submission: submissionStatusSchema,
    paid_on: isoDate.nullable(),
  })
  .strict();
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;

/** Ground state of each track (= no event recorded for that track yet). */
const GROUND_STATE: InvoiceStatus = {
  review: 'neu',
  payment: 'offen',
  submission: 'nicht_eingereicht',
  paid_on: null,
};

/**
 * Picks the last-recorded event of a track. `events` must be in append order
 * (oldest first) — the authoritative order of transitions is the order they were
 * recorded, NOT `changed_at`, since a payment event's `changed_at` carries the
 * user-supplied Zahlungsdatum (which may be back- or future-dated).
 */
function latestOfTrack(
  events: readonly InvoiceStatusEvent[],
  track: StatusTrack,
): InvoiceStatusEvent | undefined {
  let latest: InvoiceStatusEvent | undefined;
  for (const e of events) {
    if (e.track === track) latest = e;
  }
  return latest;
}

/**
 * Derives the current {@link InvoiceStatus} from an invoice's status-event log.
 * The log MUST be passed in append order (oldest first); the backend orders by
 * rowid and the `invoice_current_status` view mirrors this. Deterministic — no clock.
 */
export function deriveInvoiceStatus(events: readonly InvoiceStatusEvent[]): InvoiceStatus {
  const review = latestOfTrack(events, 'review');
  const payment = latestOfTrack(events, 'payment');
  const submission = latestOfTrack(events, 'submission');

  const paymentStatus = (payment?.status as InvoiceStatus['payment']) ?? GROUND_STATE.payment;
  return {
    review: (review?.status as InvoiceStatus['review']) ?? GROUND_STATE.review,
    payment: paymentStatus,
    submission: (submission?.status as InvoiceStatus['submission']) ?? GROUND_STATE.submission,
    paid_on: paymentStatus === 'bezahlt' && payment ? payment.changed_at.slice(0, 10) : null,
  };
}

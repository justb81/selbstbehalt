// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import type { InvoiceStatusEvent } from '../schemas/invoice-status-event.js';
import { deriveInvoiceStatus } from './derive-invoice-status.js';

const INV = '3f9a8c2e-1d4b-4c6a-9e2f-7b1c0d5e6a7f';
let seq = 0;
function ev(
  track: InvoiceStatusEvent['track'],
  status: InvoiceStatusEvent['status'],
  changed_at: string,
): InvoiceStatusEvent {
  seq += 1;
  return {
    id: `${INV.slice(0, 34)}${seq.toString().padStart(2, '0')}`,
    invoice_id: INV,
    track,
    status,
    changed_at,
  };
}

describe('deriveInvoiceStatus', () => {
  it('returns the ground state for an empty log', () => {
    expect(deriveInvoiceStatus([])).toEqual({
      review: 'neu',
      payment: 'offen',
      submission: 'nicht_eingereicht',
      paid_on: null,
    });
  });

  it('takes the latest event of each track independently', () => {
    const status = deriveInvoiceStatus([
      ev('review', 'neu', '2026-06-01T09:00:00Z'),
      ev('review', 'geprüft', '2026-06-01T10:00:00Z'),
      ev('submission', 'eingereicht', '2026-06-02T08:00:00Z'),
      ev('submission', 'erstattet', '2026-06-09T08:00:00Z'),
    ]);
    expect(status.review).toBe('geprüft');
    expect(status.submission).toBe('erstattet');
    // payment never moved
    expect(status.payment).toBe('offen');
    expect(status.paid_on).toBeNull();
  });

  it('represents submitted+reimbursed but not yet paid (the parallel-track case)', () => {
    const status = deriveInvoiceStatus([
      ev('review', 'geprüft', '2026-06-01T10:00:00Z'),
      ev('submission', 'eingereicht', '2026-06-01T11:00:00Z'),
      ev('submission', 'erstattet', '2026-06-08T11:00:00Z'),
    ]);
    expect(status).toEqual({
      review: 'geprüft',
      payment: 'offen',
      submission: 'erstattet',
      paid_on: null,
    });
  });

  it('sets paid_on to the date of the latest bezahlt event', () => {
    const status = deriveInvoiceStatus([
      ev('review', 'geprüft', '2026-06-01T10:00:00Z'),
      ev('payment', 'bezahlt', '2026-07-01T14:30:00Z'),
    ]);
    expect(status.payment).toBe('bezahlt');
    expect(status.paid_on).toBe('2026-07-01');
  });

  it('clears paid_on when payment was reverted back to offen', () => {
    const status = deriveInvoiceStatus([
      ev('payment', 'bezahlt', '2026-07-01T14:30:00Z'),
      ev('payment', 'offen', '2026-07-02T09:00:00Z'),
    ]);
    expect(status.payment).toBe('offen');
    expect(status.paid_on).toBeNull();
  });

  it('takes the last-recorded event per track by append order, not by changed_at', () => {
    // A future-dated Zahlungsdatum must not outrank a later-recorded revert: the log
    // is ordered by record order, not changed_at.
    const paidFuture = ev('payment', 'bezahlt', '2026-12-31T00:00:00Z');
    const revertedNow = ev('payment', 'offen', '2026-07-02T09:00:00Z');
    expect(deriveInvoiceStatus([paidFuture, revertedNow]).payment).toBe('offen');
    expect(deriveInvoiceStatus([paidFuture, revertedNow]).paid_on).toBeNull();
  });
});

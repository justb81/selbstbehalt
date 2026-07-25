// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import {
  addDaysIso,
  daysUntilDue,
  defaultPaymentDueDate,
  DEFAULT_PAYMENT_TERM_DAYS,
  paymentDueState,
  resolvePaymentDueDate,
} from './payment-due.js';

describe('addDaysIso', () => {
  it('adds days within a month', () => {
    expect(addDaysIso('2026-03-01', 14)).toBe('2026-03-15');
  });

  it('crosses month and year boundaries', () => {
    expect(addDaysIso('2026-12-20', 30)).toBe('2027-01-19');
  });

  it('handles leap days', () => {
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('accepts negative offsets', () => {
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('defaultPaymentDueDate', () => {
  it('defaults to 30 days after the invoice date', () => {
    expect(DEFAULT_PAYMENT_TERM_DAYS).toBe(30);
    expect(defaultPaymentDueDate('2026-06-01')).toBe('2026-07-01');
  });

  it('honours an explicit term', () => {
    expect(defaultPaymentDueDate('2026-06-01', 14)).toBe('2026-06-15');
  });
});

describe('resolvePaymentDueDate', () => {
  it('prefers the stored Zahlungsziel', () => {
    expect(
      resolvePaymentDueDate({ invoice_date: '2026-06-01', payment_due_date: '2026-06-10' }),
    ).toBe('2026-06-10');
  });

  it('falls back to invoice_date + term when null or absent', () => {
    expect(resolvePaymentDueDate({ invoice_date: '2026-06-01', payment_due_date: null }, 14)).toBe(
      '2026-06-15',
    );
    expect(resolvePaymentDueDate({ invoice_date: '2026-06-01' })).toBe('2026-07-01');
  });
});

describe('daysUntilDue', () => {
  it('counts calendar days ahead', () => {
    expect(daysUntilDue('2026-06-10', '2026-06-01')).toBe(9);
  });

  it('is 0 on the due date and negative afterwards', () => {
    expect(daysUntilDue('2026-06-10', '2026-06-10')).toBe(0);
    expect(daysUntilDue('2026-06-10', '2026-06-12')).toBe(-2);
  });

  it('ignores the time of day of a Date input', () => {
    expect(daysUntilDue('2026-06-10', new Date(2026, 5, 9, 23, 59))).toBe(1);
  });
});

describe('paymentDueState — unpaid invoices', () => {
  const unpaid = { payment: 'offen' as const, paidOn: null, leadDays: 7 };

  it('is überfällig once the Zahlungsziel has passed', () => {
    expect(paymentDueState({ ...unpaid, dueDate: '2026-06-10', asOf: '2026-06-11' })).toBe(
      'ueberfaellig',
    );
  });

  it('is fällig bald on the due date and inside the lead time', () => {
    expect(paymentDueState({ ...unpaid, dueDate: '2026-06-10', asOf: '2026-06-10' })).toBe(
      'faellig_bald',
    );
    expect(paymentDueState({ ...unpaid, dueDate: '2026-06-10', asOf: '2026-06-03' })).toBe(
      'faellig_bald',
    );
  });

  it('is offen outside the lead time', () => {
    expect(paymentDueState({ ...unpaid, dueDate: '2026-06-10', asOf: '2026-06-02' })).toBe('offen');
  });

  it('respects a custom lead time', () => {
    expect(
      paymentDueState({ ...unpaid, dueDate: '2026-06-10', asOf: '2026-06-02', leadDays: 14 }),
    ).toBe('faellig_bald');
  });
});

describe('paymentDueState — paid and scheduled (Terminüberweisung) invoices', () => {
  const paid = { payment: 'bezahlt' as const, leadDays: 7 };

  it('is bezahlt when the payment day has arrived or passed', () => {
    expect(
      paymentDueState({ ...paid, dueDate: '2026-06-10', paidOn: '2026-06-05', asOf: '2026-06-05' }),
    ).toBe('bezahlt');
    expect(
      paymentDueState({ ...paid, dueDate: '2026-06-10', paidOn: '2026-06-05', asOf: '2026-06-20' }),
    ).toBe('bezahlt');
  });

  it('is bezahlt without a paid_on', () => {
    expect(
      paymentDueState({ ...paid, dueDate: '2026-06-10', paidOn: null, asOf: '2026-06-20' }),
    ).toBe('bezahlt');
  });

  it('is terminiert while the scheduled day still lies ahead', () => {
    expect(
      paymentDueState({ ...paid, dueDate: '2026-06-10', paidOn: '2026-06-08', asOf: '2026-06-01' }),
    ).toBe('terminiert');
  });

  it('is terminiert on the Zahlungsziel itself', () => {
    expect(
      paymentDueState({ ...paid, dueDate: '2026-06-10', paidOn: '2026-06-10', asOf: '2026-06-01' }),
    ).toBe('terminiert');
  });

  it('flags a scheduled day after the Zahlungsziel', () => {
    expect(
      paymentDueState({ ...paid, dueDate: '2026-06-10', paidOn: '2026-06-15', asOf: '2026-06-01' }),
    ).toBe('terminiert_spaet');
  });

  it('never reports a scheduled payment as überfällig', () => {
    // Zahlungsziel already passed, but the transfer is booked for tomorrow.
    expect(
      paymentDueState({ ...paid, dueDate: '2026-06-01', paidOn: '2026-06-11', asOf: '2026-06-10' }),
    ).toBe('terminiert_spaet');
  });
});

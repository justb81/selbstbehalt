// SPDX-License-Identifier: Apache-2.0
import type { Invoice, PaymentStatus } from '@selbstbehalt/shared';
import { describe, expect, it } from 'vitest';

import { classifyInvoiceDue, summarizeDueInvoices } from './payment-reminders';

const ASOF = '2026-06-10';
const OPTIONS = { leadDays: 7, termDays: 30, asOf: ASOF };

function invoice(overrides: {
  id?: string;
  invoice_date?: string;
  payment_due_date?: string | null;
  payment?: PaymentStatus;
  paid_on?: string | null;
  provider_name?: string;
}): Invoice {
  return {
    id: overrides.id ?? '11111111-1111-4111-8111-111111111111',
    created_at: '2026-06-01T10:00:00Z',
    insured_person_id: '22222222-2222-4222-8222-222222222222',
    invoice_date: overrides.invoice_date ?? '2026-06-01',
    payment_due_date: overrides.payment_due_date ?? null,
    invoice_number: null,
    provider_name: overrides.provider_name ?? 'Dr. Müller',
    provider_type: 'arzt',
    total_amount: 85,
    eligible_amount: null,
    self_paid_amount: 85,
    status: {
      review: 'geprüft',
      payment: overrides.payment ?? 'offen',
      submission: 'nicht_eingereicht',
      paid_on: overrides.paid_on ?? null,
    },
    file_path: null,
    ocr_raw: null,
    notes: null,
  };
}

describe('classifyInvoiceDue', () => {
  it('uses the stored Zahlungsziel', () => {
    const due = classifyInvoiceDue(invoice({ payment_due_date: '2026-06-12' }), OPTIONS);
    expect(due.dueDate).toBe('2026-06-12');
    expect(due.days).toBe(2);
    expect(due.state).toBe('faellig_bald');
  });

  it('derives the Zahlungsziel from the invoice date and term when none is stored', () => {
    const due = classifyInvoiceDue(invoice({ invoice_date: '2026-06-01' }), OPTIONS);
    expect(due.dueDate).toBe('2026-07-01');
    expect(due.state).toBe('offen');
  });

  it('honours a changed default term for invoices without a stored Zahlungsziel', () => {
    const due = classifyInvoiceDue(invoice({ invoice_date: '2026-06-01' }), {
      ...OPTIONS,
      termDays: 14,
    });
    expect(due.dueDate).toBe('2026-06-15');
    expect(due.state).toBe('faellig_bald');
  });

  it('marks a passed Zahlungsziel as überfällig', () => {
    const due = classifyInvoiceDue(invoice({ payment_due_date: '2026-06-05' }), OPTIONS);
    expect(due.state).toBe('ueberfaellig');
    expect(due.days).toBe(-5);
  });

  it('treats a Terminüberweisung (bezahlt, paid_on in the future) as terminiert', () => {
    const due = classifyInvoiceDue(
      invoice({ payment_due_date: '2026-06-20', payment: 'bezahlt', paid_on: '2026-06-15' }),
      OPTIONS,
    );
    expect(due.state).toBe('terminiert');
  });

  it('never reports a scheduled payment as überfällig, even past the Zahlungsziel', () => {
    const due = classifyInvoiceDue(
      invoice({ payment_due_date: '2026-06-05', payment: 'bezahlt', paid_on: '2026-06-14' }),
      OPTIONS,
    );
    expect(due.state).toBe('terminiert_spaet');
  });

  it('flags a Terminüberweisung scheduled after the Zahlungsziel', () => {
    const due = classifyInvoiceDue(
      invoice({ payment_due_date: '2026-06-12', payment: 'bezahlt', paid_on: '2026-06-20' }),
      OPTIONS,
    );
    expect(due.state).toBe('terminiert_spaet');
  });

  it('treats an executed payment as bezahlt', () => {
    const due = classifyInvoiceDue(
      invoice({ payment_due_date: '2026-06-12', payment: 'bezahlt', paid_on: '2026-06-08' }),
      OPTIONS,
    );
    expect(due.state).toBe('bezahlt');
  });

  it('suppresses every attention state when Fälligkeits-Hinweise are off', () => {
    const off = { ...OPTIONS, leadDays: null };
    expect(classifyInvoiceDue(invoice({ payment_due_date: '2026-06-05' }), off).state).toBe(
      'offen',
    );
    expect(classifyInvoiceDue(invoice({ payment_due_date: '2026-06-12' }), off).state).toBe(
      'offen',
    );
    expect(
      classifyInvoiceDue(
        invoice({ payment_due_date: '2026-06-12', payment: 'bezahlt', paid_on: '2026-06-20' }),
        off,
      ).state,
    ).toBe('terminiert');
  });
});

describe('summarizeDueInvoices', () => {
  const invoices = [
    invoice({ id: 'a', payment_due_date: '2026-06-08', provider_name: 'Dr. B' }),
    invoice({ id: 'b', payment_due_date: '2026-06-01', provider_name: 'Dr. A' }),
    invoice({ id: 'c', payment_due_date: '2026-06-12' }),
    invoice({ id: 'd', payment_due_date: '2026-08-01' }),
    invoice({
      id: 'e',
      payment_due_date: '2026-06-12',
      payment: 'bezahlt',
      paid_on: '2026-06-20',
    }),
    invoice({
      id: 'f',
      payment_due_date: '2026-06-30',
      payment: 'bezahlt',
      paid_on: '2026-06-05',
    }),
  ];

  it('buckets invoices by what needs attention', () => {
    const summary = summarizeDueInvoices(invoices, OPTIONS);
    expect(summary.overdue.map((d) => d.invoice.id)).toEqual(['b', 'a']);
    expect(summary.dueSoon.map((d) => d.invoice.id)).toEqual(['c']);
    expect(summary.scheduledLate.map((d) => d.invoice.id)).toEqual(['e']);
  });

  it('sorts by Zahlungsziel, then provider', () => {
    const sameDay = [
      invoice({ id: 'y', payment_due_date: '2026-06-05', provider_name: 'Dr. Zweit' }),
      invoice({ id: 'x', payment_due_date: '2026-06-05', provider_name: 'Dr. Erst' }),
    ];
    expect(summarizeDueInvoices(sameDay, OPTIONS).overdue.map((d) => d.invoice.id)).toEqual([
      'x',
      'y',
    ]);
  });

  it('returns nothing when Fälligkeits-Hinweise are off', () => {
    expect(summarizeDueInvoices(invoices, { ...OPTIONS, leadDays: null })).toEqual({
      overdue: [],
      dueSoon: [],
      scheduledLate: [],
    });
  });

  it('handles an empty list', () => {
    expect(summarizeDueInvoices([], OPTIONS)).toEqual({
      overdue: [],
      dueSoon: [],
      scheduledLate: [],
    });
  });
});

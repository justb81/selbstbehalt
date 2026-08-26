// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
import type { Invoice, PaymentStatus } from '@selbstbehalt/shared';
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';

import PaymentDueBadge from './PaymentDueBadge.svelte';

const ASOF = '2026-06-10';

function invoice(overrides: {
  invoice_date?: string;
  payment_due_date?: string | null;
  payment?: PaymentStatus;
  paid_on?: string | null;
}): Invoice {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    created_at: '2026-06-01T10:00:00Z',
    insured_person_id: '22222222-2222-4222-8222-222222222222',
    invoice_date: overrides.invoice_date ?? '2026-06-01',
    payment_due_date: overrides.payment_due_date ?? null,
    invoice_number: null,
    provider_name: 'Dr. Müller',
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

const props = (inv: Invoice) => ({ invoice: inv, leadDays: 7, termDays: 30, asOf: ASOF });

describe('PaymentDueBadge', () => {
  it('renders nothing for an invoice due far out', () => {
    const { container } = render(PaymentDueBadge, {
      props: props(invoice({ payment_due_date: '2026-08-01' })),
    });
    expect(container.textContent?.trim()).toBe('');
  });

  it('renders nothing for a paid invoice', () => {
    const { container } = render(PaymentDueBadge, {
      props: props(invoice({ payment: 'bezahlt', paid_on: '2026-06-05' })),
    });
    expect(container.textContent?.trim()).toBe('');
  });

  it('renders nothing when Fälligkeits-Hinweise are off', () => {
    const { container } = render(PaymentDueBadge, {
      props: { ...props(invoice({ payment_due_date: '2026-06-01' })), leadDays: null },
    });
    expect(container.textContent?.trim()).toBe('');
  });

  it('labels an overdue invoice with the number of days', () => {
    render(PaymentDueBadge, { props: props(invoice({ payment_due_date: '2026-06-05' })) });
    expect(screen.getByText('5 Tage überfällig')).toBeInTheDocument();
  });

  it('uses the singular for a single overdue day', () => {
    render(PaymentDueBadge, { props: props(invoice({ payment_due_date: '2026-06-09' })) });
    expect(screen.getByText('1 Tag überfällig')).toBeInTheDocument();
  });

  it('labels an invoice due today', () => {
    render(PaymentDueBadge, { props: props(invoice({ payment_due_date: ASOF })) });
    expect(screen.getByText('Heute fällig')).toBeInTheDocument();
  });

  it('labels an invoice due within the lead time', () => {
    render(PaymentDueBadge, { props: props(invoice({ payment_due_date: '2026-06-13' })) });
    expect(screen.getByText('Fällig in 3 Tagen')).toBeInTheDocument();
  });

  it('uses the singular for a single remaining day', () => {
    render(PaymentDueBadge, { props: props(invoice({ payment_due_date: '2026-06-11' })) });
    expect(screen.getByText('Fällig in 1 Tag')).toBeInTheDocument();
  });

  it('labels a Terminüberweisung with its scheduled day', () => {
    render(PaymentDueBadge, {
      props: props(
        invoice({ payment_due_date: '2026-06-30', payment: 'bezahlt', paid_on: '2026-06-20' }),
      ),
    });
    expect(screen.getByText('Zahlung terminiert zum 20.06.2026')).toBeInTheDocument();
  });

  it('warns when the Zahlungstermin lies after the Zahlungsziel', () => {
    render(PaymentDueBadge, {
      props: props(
        invoice({ payment_due_date: '2026-06-15', payment: 'bezahlt', paid_on: '2026-06-20' }),
      ),
    });
    expect(screen.getByText('Zahlungstermin nach Zahlungsziel 15.06.2026')).toBeInTheDocument();
  });

  it('derives the Zahlungsziel from the invoice date when none is stored', () => {
    render(PaymentDueBadge, {
      props: { ...props(invoice({ invoice_date: '2026-05-20' })), termDays: 14 },
    });
    // 20.05. + 14 days = 03.06. → 7 days overdue on 10.06.
    expect(screen.getByText('7 Tage überfällig')).toBeInTheDocument();
  });
});

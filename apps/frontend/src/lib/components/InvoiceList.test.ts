// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { InsuredPerson, Invoice, Person } from '@selbstbehalt/shared';

// Route helper stub — expand the [id] pattern so hrefs are assertable.
vi.mock('$app/paths', () => ({
  resolve: (pattern: string, params?: Record<string, string>) =>
    params ? pattern.replace(/\[(\w+)\]/g, (_, k) => params[k] ?? `[${k}]`) : pattern,
}));

import InvoiceList from './InvoiceList.svelte';

function invoice(overrides: Partial<Invoice> & Pick<Invoice, 'id' | 'insured_person_id'>): Invoice {
  return {
    invoice_date: '2025-03-15',
    invoice_number: null,
    provider_name: 'Dr. Test',
    provider_type: 'arzt',
    total_amount: 100,
    self_paid_amount: 0,
    eligible_amount: null,
    status: 'neu',
    file_path: null,
    ocr_raw: null,
    notes: null,
    created_at: '2025-03-15T10:00:00Z',
    ...overrides,
  };
}

function person(id: string, name: string): Person {
  return { id, name, birth_date: null, created_at: '2025-01-01T00:00:00Z' };
}

function insured(id: string, personId: string): InsuredPerson {
  return {
    id,
    person_id: personId,
    contract_id: 'c-1',
    kvnr: null,
    tariff_name: null,
    monthly_premium: 500,
    self_retention: 0,
    bre_structure: null,
    included_benefits: null,
    start_date: null,
    end_date: null,
    notes: null,
    created_at: '2025-01-01T00:00:00Z',
  };
}

const INVOICES: Invoice[] = [
  invoice({
    id: 'inv-a',
    insured_person_id: 'ip-a',
    provider_name: 'Dr. Arzt',
    provider_type: 'arzt',
  }),
  invoice({
    id: 'inv-b',
    insured_person_id: 'ip-b',
    provider_name: 'Zahnarzt Weber',
    provider_type: 'zahnarzt',
  }),
];
const PERSONS = [person('p-a', 'Alice'), person('p-b', 'Bob')];
const INSURED = [insured('ip-a', 'p-a'), insured('ip-b', 'p-b')];

describe('InvoiceList', () => {
  it('renders a clickable row linking to the invoice detail', () => {
    render(InvoiceList, { props: { invoices: INVOICES } });
    const link = screen.getByRole('link', { name: 'Dr. Arzt' });
    expect(link).toHaveAttribute('href', '/invoices/inv-a');
  });

  it('shows the provider type as a column value', () => {
    render(InvoiceList, { props: { invoices: INVOICES } });
    expect(screen.getByText('Arzt')).toBeInTheDocument();
    expect(screen.getByText('Zahnarzt')).toBeInTheDocument();
  });

  it('renders Person tabs and filters by the selected person', async () => {
    const user = userEvent.setup();
    render(InvoiceList, {
      props: { invoices: INVOICES, persons: PERSONS, insuredPersons: INSURED },
    });

    expect(screen.getByRole('tab', { name: 'Alle' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dr. Arzt' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zahnarzt Weber' })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Bob' }));

    expect(screen.queryByRole('link', { name: 'Dr. Arzt' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zahnarzt Weber' })).toBeInTheDocument();
  });

  it('hides the Person filter when scoped (no person mapping provided)', () => {
    render(InvoiceList, { props: { invoices: INVOICES } });
    expect(screen.queryByRole('tab', { name: 'Alle' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dr. Arzt' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zahnarzt Weber' })).toBeInTheDocument();
  });

  it('offers a create button in the empty state when a href is given', () => {
    render(InvoiceList, { props: { invoices: [], newInvoiceHref: '/invoices/new' } });
    expect(screen.getByText('Noch keine Rechnungen vorhanden.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Erste Rechnung erfassen' })).toHaveAttribute(
      'href',
      '/invoices/new',
    );
  });
});

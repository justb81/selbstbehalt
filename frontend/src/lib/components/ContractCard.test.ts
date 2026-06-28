// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/paths', () => ({
  resolve: (pattern: string, params?: Record<string, string>) => {
    if (!params) return pattern;
    return pattern.replace(/\[(\w+)\]/g, (_, k) => params[k] ?? `[${k}]`);
  },
}));

import ContractCard from './ContractCard.svelte';
import type { Contract } from '@selbstbehalt/shared';

const BASE_CONTRACT: Contract = {
  id: 'c-1',
  insurer_name: 'Testversicherung AG',
  type: 'vollversicherung',
  contract_number: null,
  start_date: '2022-01-01',
  end_date: null,
  notes: null,
  policyholder_id: 'p-1',
  created_at: '2022-01-01T00:00:00Z',
};

describe('ContractCard', () => {
  it('renders the insurer name and contract type', () => {
    render(ContractCard, { props: { contract: BASE_CONTRACT } });
    expect(screen.getByText('Testversicherung AG')).toBeInTheDocument();
    expect(screen.getByText('Vollversicherung')).toBeInTheDocument();
  });

  it('shows the contract number when present', () => {
    render(ContractCard, { props: { contract: { ...BASE_CONTRACT, contract_number: 'V-123' } } });
    expect(screen.getByText(/V-123/)).toBeInTheDocument();
  });

  it('omits the contract number when absent', () => {
    render(ContractCard, { props: { contract: BASE_CONTRACT } });
    expect(screen.queryByText(/Nr\./)).not.toBeInTheDocument();
  });

  it('shows "seit" with start_date when no end_date', () => {
    render(ContractCard, { props: { contract: BASE_CONTRACT } });
    expect(screen.getByText(/seit 2022-01-01/)).toBeInTheDocument();
  });

  it('shows "bis" with end_date when present', () => {
    render(ContractCard, {
      props: { contract: { ...BASE_CONTRACT, end_date: '2024-12-31' } },
    });
    expect(screen.getByText(/bis 2024-12-31/)).toBeInTheDocument();
  });

  it('renders insured persons count with singular form', () => {
    render(ContractCard, { props: { contract: BASE_CONTRACT, insuredCount: 1 } });
    expect(screen.getByText(/1 versicherte Person\b/)).toBeInTheDocument();
  });

  it('renders insured persons count with plural form', () => {
    render(ContractCard, { props: { contract: BASE_CONTRACT, insuredCount: 3 } });
    expect(screen.getByText(/3 versicherte Personen/)).toBeInTheDocument();
  });

  it('links to the contract detail page', () => {
    render(ContractCard, { props: { contract: BASE_CONTRACT } });
    expect(screen.getByRole('link')).toHaveAttribute('href', '/contracts/c-1');
  });
});

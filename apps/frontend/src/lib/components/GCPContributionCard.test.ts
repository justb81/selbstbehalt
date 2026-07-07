// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/paths', () => ({
  resolve: (pattern: string, params?: Record<string, string>) => {
    if (!params) return pattern;
    return pattern.replace(/\[(\w+)\]/g, (_, k) => params[k] ?? `[${k}]`);
  },
}));

import GCPContributionCard from './GCPContributionCard.svelte';

const BASE = {
  year: 2024,
  amount: 150,
  totalR_Y: 400,
  selbstbehalt: 600,
  alreadyBroken: false,
};

describe('GCPContributionCard', () => {
  it('shows empty-state message when contributions is empty', () => {
    render(GCPContributionCard, {
      props: { contributions: [], insuredPersonId: 'ip-1' },
    });
    expect(screen.getByText(/Kein.*Leistungsdatum/)).toBeInTheDocument();
  });

  it('renders the service year heading', () => {
    render(GCPContributionCard, {
      props: { contributions: [BASE], insuredPersonId: 'ip-1' },
    });
    expect(screen.getByText('Leistungsjahr 2024')).toBeInTheDocument();
  });

  it('links to the insured person page', () => {
    render(GCPContributionCard, {
      props: { contributions: [BASE], insuredPersonId: 'ip-42' },
    });
    const link = screen.getByRole('link', { name: /Vollständiges Verdikt/ });
    expect(link).toHaveAttribute('href', '/insured/ip-42');
  });

  it('shows the insuredLabel in the link', () => {
    render(GCPContributionCard, {
      props: { contributions: [BASE], insuredPersonId: 'ip-1', insuredLabel: 'Mein Tarif' },
    });
    expect(screen.getByText(/Mein Tarif/)).toBeInTheDocument();
  });

  it('shows "under threshold" message when totalR_Y < selbstbehalt', () => {
    render(GCPContributionCard, {
      props: { contributions: [BASE], insuredPersonId: 'ip-1' },
    });
    expect(screen.getByText(/liegt noch unter dem Selbstbehalt/)).toBeInTheDocument();
  });

  it('shows "over threshold" message when totalR_Y > selbstbehalt', () => {
    render(GCPContributionCard, {
      props: {
        contributions: [{ ...BASE, totalR_Y: 800, selbstbehalt: 600 }],
        insuredPersonId: 'ip-1',
      },
    });
    expect(screen.getByText(/übersteigt den Selbstbehalt/)).toBeInTheDocument();
  });

  it('shows "Staffel gebrochen" badge and message when alreadyBroken', () => {
    render(GCPContributionCard, {
      props: {
        // Broken = reimbursements already exceed the deductible.
        contributions: [{ ...BASE, totalR_Y: 800, selbstbehalt: 600, alreadyBroken: true }],
        insuredPersonId: 'ip-1',
      },
    });
    expect(screen.getByText('Staffel gebrochen')).toBeInTheDocument();
    expect(
      screen.getByText(/übersteigen den Selbstbehalt.*BRE-Staffel.*gebrochen/),
    ).toBeInTheDocument();
  });

  it('renders multiple years', () => {
    render(GCPContributionCard, {
      props: {
        contributions: [
          { ...BASE, year: 2024 },
          { ...BASE, year: 2023 },
        ],
        insuredPersonId: 'ip-1',
      },
    });
    expect(screen.getByText('Leistungsjahr 2024')).toBeInTheDocument();
    expect(screen.getByText('Leistungsjahr 2023')).toBeInTheDocument();
  });
});

// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { InsuredPerson } from '@selbstbehalt/shared';

import type { SBRadar } from '$lib/utils/selbstbehalt-radar';
import PersonStatusCard from './PersonStatusCard.svelte';

const INSURED_PERSON: InsuredPerson = {
  id: 'ip-1',
  person_id: 'p-1',
  contract_id: 'c-1',
  kvnr: 'A123456789',
  tariff_name: 'Komfort',
  monthly_premium: 500,
  self_retention: 600,
  bre_structure: {
    type: 'staffel',
    levels: [{ claim_free_years: 1, bre_years: 1, pct_of_premium: 100 }],
    current_streak_start: '2024-01-01',
  },
  included_benefits: null,
  start_date: '2022-01-01',
  end_date: null,
  notes: null,
  created_at: '2022-01-01T00:00:00Z',
};

function radar(overrides: Partial<SBRadar> = {}): SBRadar {
  return {
    year: 2026,
    R_Y: 300,
    selbstbehalt: 600,
    npvThreshold: 400,
    gcpThreshold: 1000,
    sbExhaustion: 0.5,
    restBisEinreichen: 700,
    state: 'unter_sb',
    alreadyBroken: false,
    gcp: null,
    ...overrides,
  };
}

describe('PersonStatusCard', () => {
  it('renders one link wrapping the label, Ampel badge, radar and BRE row', () => {
    render(PersonStatusCard, {
      props: { insuredPerson: INSURED_PERSON, radar: radar(), href: '/insured/ip-1' },
    });

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/insured/ip-1');
    expect(screen.getByText('Komfort')).toBeInTheDocument();
    expect(screen.getByText('Unter Selbstbehalt')).toBeInTheDocument();
    expect(screen.getByText(/Jahr.*leistungsfrei/)).toBeInTheDocument();
  });

  it('renders exactly one Ampel-relevant progress bar for the radar and one for BRE', () => {
    render(PersonStatusCard, {
      props: { insuredPerson: INSURED_PERSON, radar: radar(), href: '/insured/ip-1' },
    });
    expect(screen.getAllByRole('progressbar')).toHaveLength(2);
  });

  it('falls back to KVNR/generic label like the standalone components', () => {
    render(PersonStatusCard, {
      props: {
        insuredPerson: { ...INSURED_PERSON, tariff_name: null },
        radar: radar(),
        href: '/insured/ip-1',
      },
    });
    expect(screen.getByText('A123456789')).toBeInTheDocument();
  });
});

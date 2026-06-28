// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';

import BRETracker from './BRETracker.svelte';
import type { InsuredPerson } from '@selbstbehalt/shared';

const BASE_PERSON: InsuredPerson = {
  id: 'ip-1',
  person_id: 'p-1',
  contract_id: 'c-1',
  kvnr: 'A123456789',
  tariff_name: 'Komfort',
  monthly_premium: 500,
  self_retention: 600,
  bre_structure: null,
  included_benefits: null,
  start_date: '2022-01-01',
  end_date: null,
  notes: null,
  created_at: '2022-01-01T00:00:00Z',
  updated_at: '2022-01-01T00:00:00Z',
};

const PERSON_WITH_BRE: InsuredPerson = {
  ...BASE_PERSON,
  bre_structure: {
    type: 'staffel',
    levels: [{ leistungsfrei_months: 12, bre_months: 1, pct_of_premium: 100 }],
    current_streak_start: '2024-01-01',
  },
};

describe('BRETracker', () => {
  it('shows the tariff name as the label', () => {
    render(BRETracker, { props: { insuredPerson: BASE_PERSON } });
    expect(screen.getByText('Komfort')).toBeInTheDocument();
  });

  it('falls back to KVNR when no tariff name', () => {
    render(BRETracker, { props: { insuredPerson: { ...BASE_PERSON, tariff_name: null } } });
    expect(screen.getByText('A123456789')).toBeInTheDocument();
  });

  it('falls back to generic label when neither tariff nor KVNR', () => {
    render(BRETracker, {
      props: { insuredPerson: { ...BASE_PERSON, tariff_name: null, kvnr: null } },
    });
    expect(screen.getByText('Versicherte Person')).toBeInTheDocument();
  });

  it('shows "Keine BRE-Staffel konfiguriert" when bre_structure is null', () => {
    render(BRETracker, { props: { insuredPerson: BASE_PERSON } });
    expect(screen.getByText(/Keine BRE-Staffel konfiguriert/)).toBeInTheDocument();
  });

  it('renders a progress bar when BRE structure is configured', () => {
    render(BRETracker, { props: { insuredPerson: PERSON_WITH_BRE } });
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('shows streak months in full mode', () => {
    render(BRETracker, { props: { insuredPerson: PERSON_WITH_BRE, compact: false } });
    expect(screen.getByText(/Monate leistungsfrei/)).toBeInTheDocument();
  });

  it('shows streak in compact form when compact=true', () => {
    render(BRETracker, { props: { insuredPerson: PERSON_WITH_BRE, compact: true } });
    expect(screen.getByText(/Mo\./)).toBeInTheDocument();
  });
});

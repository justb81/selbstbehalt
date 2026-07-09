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
};

const PERSON_WITH_BRE: InsuredPerson = {
  ...BASE_PERSON,
  bre_structure: {
    type: 'staffel',
    levels: [{ claim_free_years: 1, bre_years: 1, pct_of_premium: 100 }],
    current_streak_start: '2024-01-01',
  },
};

const PERSON_AT_MAX_LEVEL: InsuredPerson = {
  ...BASE_PERSON,
  bre_structure: {
    type: 'staffel',
    levels: [{ claim_free_years: 1, bre_years: 1, pct_of_premium: 100 }],
    // Streak start far enough in the past that no further level remains.
    current_streak_start: '2000-01-01',
  },
};

const PERSON_BELOW_NEXT_LEVEL: InsuredPerson = {
  ...BASE_PERSON,
  bre_structure: {
    type: 'staffel',
    levels: [
      { claim_free_years: 1, bre_years: 1, pct_of_premium: 50 },
      { claim_free_years: 3, bre_years: 3, pct_of_premium: 100 },
    ],
    // Recent enough that a next level is always still ahead.
    current_streak_start: '2026-01-01',
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

  it('shows streak years in full mode', () => {
    render(BRETracker, { props: { insuredPerson: PERSON_WITH_BRE, compact: false } });
    expect(screen.getByText(/Jahr.*leistungsfrei/)).toBeInTheDocument();
  });

  it('shows streak in compact form when compact=true', () => {
    render(BRETracker, { props: { insuredPerson: PERSON_WITH_BRE, compact: true } });
    expect(screen.getByText(/J\./)).toBeInTheDocument();
  });

  it('gives the progress bar an accessible name', () => {
    render(BRETracker, { props: { insuredPerson: PERSON_WITH_BRE } });
    expect(screen.getByRole('progressbar')).toHaveAccessibleName();
  });

  it('shows a next-level hint in compact mode', () => {
    render(BRETracker, { props: { insuredPerson: PERSON_BELOW_NEXT_LEVEL, compact: true } });
    expect(screen.getByText(/Nächste Stufe in \d+ Jahr/)).toBeInTheDocument();
  });

  it('shows "Höchste Stufe erreicht" once the top level is reached', () => {
    render(BRETracker, { props: { insuredPerson: PERSON_AT_MAX_LEVEL, compact: true } });
    expect(screen.getByText('Höchste Stufe erreicht')).toBeInTheDocument();
  });

  it('labels the compact BRE amount', () => {
    render(BRETracker, { props: { insuredPerson: PERSON_WITH_BRE, compact: true } });
    expect(screen.getByText(/^BRE: /)).toBeInTheDocument();
  });
});

describe('BRETracker — bare variant', () => {
  it('renders the streak/progress body without a card wrapper or name header', () => {
    render(BRETracker, { props: { insuredPerson: PERSON_WITH_BRE, bare: true } });
    expect(screen.getByText(/Jahr.*leistungsfrei/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByText('Komfort')).not.toBeInTheDocument();
  });

  it('ignores href when bare is set', () => {
    render(BRETracker, {
      props: { insuredPerson: PERSON_WITH_BRE, bare: true, compact: true, href: '/insured/abc' },
    });
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows the "Keine BRE-Staffel konfiguriert" fallback when bare', () => {
    render(BRETracker, { props: { insuredPerson: BASE_PERSON, bare: true } });
    expect(screen.getByText(/Keine BRE-Staffel konfiguriert/)).toBeInTheDocument();
  });

  it('labels the bare BRE amount and shows the next-level hint', () => {
    render(BRETracker, { props: { insuredPerson: PERSON_BELOW_NEXT_LEVEL, bare: true } });
    expect(screen.getByText(/^BRE: /)).toBeInTheDocument();
    expect(screen.getByText(/Nächste Stufe in \d+ Jahr/)).toBeInTheDocument();
  });
});

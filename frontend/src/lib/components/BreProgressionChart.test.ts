// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';

import type { BREHistoryYear } from '@selbstbehalt/shared';

import BreProgressionChart from './BreProgressionChart.svelte';

const YEARS: BREHistoryYear[] = [
  { year: 2022, streak_years: 1, bre_amount: 0, projected_bre: 300 },
  { year: 2023, streak_years: 2, bre_amount: 300, projected_bre: 600 },
  { year: 2024, streak_years: 0, bre_amount: 0, projected_bre: null },
];

describe('BreProgressionChart', () => {
  it('renders an SVG chart for the given years', () => {
    const { container } = render(BreProgressionChart, { props: { data: YEARS } });
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders a legend entry for the actual and projected series', async () => {
    render(BreProgressionChart, { props: { data: YEARS } });
    // The Legend is loaded via a dynamic import, so it appears asynchronously.
    expect(await screen.findByText('Tatsächlich')).toBeInTheDocument();
    expect(screen.getByText('Prognostiziert')).toBeInTheDocument();
  });

  it('renders a tick label for every year', () => {
    render(BreProgressionChart, { props: { data: YEARS } });
    expect(screen.getByText('2022')).toBeInTheDocument();
    expect(screen.getByText('2023')).toBeInTheDocument();
    expect(screen.getByText('2024')).toBeInTheDocument();
  });

  it('renders without a chart when there is no data', () => {
    const { container } = render(BreProgressionChart, { props: { data: [] } });
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});

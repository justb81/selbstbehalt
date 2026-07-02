// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';

import type { YearStats } from '@selbstbehalt/shared';

import CostsRefundsChart from './CostsRefundsChart.svelte';

const YEARS: YearStats[] = [
  {
    year: 2023,
    invoice_count: 4,
    total_amount: 1200,
    eligible_amount: 900,
    self_paid_amount: 300,
    refund_amount: 500,
    bre_amount: 200,
  },
  {
    year: 2024,
    invoice_count: 6,
    total_amount: 1800,
    eligible_amount: 1400,
    self_paid_amount: 400,
    refund_amount: 950,
    bre_amount: 0,
  },
];

describe('CostsRefundsChart', () => {
  it('renders an SVG chart for the given years', () => {
    const { container } = render(CostsRefundsChart, { props: { data: YEARS } });
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders a legend entry per series', async () => {
    render(CostsRefundsChart, { props: { data: YEARS } });
    // The Legend is loaded via a dynamic import, so it appears asynchronously.
    expect(await screen.findByText('Gesamtkosten')).toBeInTheDocument();
    expect(screen.getByText('Erstattet')).toBeInTheDocument();
    expect(screen.getByText('Selbst getragen')).toBeInTheDocument();
  });

  it('renders a tick label for every year', () => {
    render(CostsRefundsChart, { props: { data: YEARS } });
    expect(screen.getByText('2023')).toBeInTheDocument();
    expect(screen.getByText('2024')).toBeInTheDocument();
  });

  it('renders without a chart when there is no data', () => {
    const { container } = render(CostsRefundsChart, { props: { data: [] } });
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});

// SPDX-License-Identifier: Apache-2.0
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

import GCPCard from './GCPCard.svelte';
import type { GCP_Result } from '$lib/utils/guenstiger-pruefung';

const BREAKDOWN: GCP_Result['breakdown'] = {
  year: 2024,
  relevantAmount: 700,
  selbstbehalt: 500,
  refundAfterDeductible: 200,
  currentStreakYears: 0,
  alreadyReimbursed: 0,
  alreadyBroken: false,
  lostBREValue_NPV: 97,
  ladderTerms: [{ j: 0, gross: 100, probability: 1, monthsToPayout: 6, discounted: 97 }],
  discountRate: 0.03,
  claimFreeProbability: 0.7,
};

const SUBMIT_RESULT: GCP_Result = {
  recommendation: 'einreichen',
  netBenefitOfSubmitting: 150,
  explanation: 'Einreichung lohnt sich.',
  breakdown: BREAKDOWN,
};

const SELFPAY_RESULT: GCP_Result = {
  recommendation: 'selbst_zahlen',
  netBenefitOfSubmitting: -100,
  explanation: 'Selbst zahlen lohnt sich.',
  breakdown: BREAKDOWN,
};

/** Year still under the deductible: nothing reimbursed, streak safe, no BRE at stake. */
const UNDER_THRESHOLD_RESULT: GCP_Result = {
  recommendation: 'selbst_zahlen',
  netBenefitOfSubmitting: 0,
  explanation: 'Die erstattungsfähige Jahressumme liegt noch unter dem Selbstbehalt.',
  breakdown: {
    year: 2024,
    relevantAmount: 300,
    selbstbehalt: 500,
    refundAfterDeductible: 0,
    currentStreakYears: 1,
    alreadyReimbursed: 0,
    alreadyBroken: false,
    lostBREValue_NPV: 0,
    ladderTerms: [],
    discountRate: 0.03,
    claimFreeProbability: 0.7,
  },
};

describe('GCPCard', () => {
  it('shows "Einreichen empfohlen" for the submit recommendation', () => {
    render(GCPCard, { props: { result: SUBMIT_RESULT } });
    expect(screen.getByText('Einreichen empfohlen')).toBeInTheDocument();
  });

  it('shows "Selbst zahlen empfohlen" for the self-pay recommendation', () => {
    render(GCPCard, { props: { result: SELFPAY_RESULT } });
    expect(screen.getByText('Selbst zahlen empfohlen')).toBeInTheDocument();
  });

  it('renders the explanation text', () => {
    render(GCPCard, { props: { result: SUBMIT_RESULT } });
    expect(screen.getByText('Einreichung lohnt sich.')).toBeInTheDocument();
  });

  it('shows positive net benefit as "Vorteil Einreichen"', () => {
    render(GCPCard, { props: { result: SUBMIT_RESULT } });
    expect(screen.getByText(/Vorteil Einreichen/)).toBeInTheDocument();
  });

  it('shows negative net benefit as "Vorteil Selbst zahlen"', () => {
    render(GCPCard, { props: { result: SELFPAY_RESULT } });
    expect(screen.getByText(/Vorteil Selbst zahlen/)).toBeInTheDocument();
  });

  it('shows "Beide Optionen gleichwertig" when net benefit is zero (over threshold)', () => {
    render(GCPCard, { props: { result: { ...SUBMIT_RESULT, netBenefitOfSubmitting: 0 } } });
    expect(screen.getByText('Beide Optionen gleichwertig')).toBeInTheDocument();
  });

  it('shows the neutral under-threshold state instead of a self-pay warning', () => {
    render(GCPCard, { props: { result: UNDER_THRESHOLD_RESULT } });
    expect(screen.getByText('Noch unter Selbstbehalt')).toBeInTheDocument();
    expect(screen.getByText('BRE-Staffel nicht gefährdet')).toBeInTheDocument();
    // Must NOT frame the forfeitable BRE as a self-pay advantage below the deductible.
    expect(screen.queryByText(/Vorteil Selbst zahlen/)).not.toBeInTheDocument();
  });

  it('renders no action buttons when no callbacks provided', () => {
    render(GCPCard, { props: { result: SUBMIT_RESULT } });
    expect(screen.queryByRole('button', { name: 'Einreichen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Selbst zahlen' })).not.toBeInTheDocument();
  });

  it('calls onSubmit when the submit button is clicked', async () => {
    const onSubmit = vi.fn();
    render(GCPCard, { props: { result: SUBMIT_RESULT, onSubmit } });
    await fireEvent.click(screen.getByRole('button', { name: 'Einreichen' }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('calls onSelfPay when the self-pay button is clicked', async () => {
    const onSelfPay = vi.fn();
    render(GCPCard, { props: { result: SUBMIT_RESULT, onSubmit: vi.fn(), onSelfPay } });
    await fireEvent.click(screen.getByRole('button', { name: 'Selbst zahlen' }));
    expect(onSelfPay).toHaveBeenCalledOnce();
  });

  it('disables action buttons when loading=true', () => {
    render(GCPCard, {
      props: { result: SUBMIT_RESULT, onSubmit: vi.fn(), onSelfPay: vi.fn(), loading: true },
    });
    expect(screen.getByRole('button', { name: 'Einreichen' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Selbst zahlen' })).toBeDisabled();
  });

  it('renders the breakdown summary toggle', () => {
    render(GCPCard, { props: { result: SUBMIT_RESULT } });
    expect(screen.getByText('Rechenweg anzeigen')).toBeInTheDocument();
  });
});

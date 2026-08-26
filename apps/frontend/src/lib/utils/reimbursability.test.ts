// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { isNonReimbursable, type ReimbursabilityInvoice } from './reimbursability';

const invoice = (
  eligible_amount: number | null,
  submission: ReimbursabilityInvoice['status']['submission'],
): ReimbursabilityInvoice => ({
  eligible_amount,
  status: { review: 'geprüft', payment: 'offen', submission, paid_on: null },
});

describe('isNonReimbursable', () => {
  it('flags a tariff-wise zero invoice that was never submitted', () => {
    expect(isNonReimbursable(invoice(0, 'nicht_eingereicht'))).toBe(true);
  });

  it('does not flag an unknown amount — null is not zero', () => {
    // No included_benefits/start_date on the insured person, or no positions at all.
    expect(isNonReimbursable(invoice(null, 'nicht_eingereicht'))).toBe(false);
  });

  it('does not flag an invoice with a reimbursable share', () => {
    expect(isNonReimbursable(invoice(400, 'nicht_eingereicht'))).toBe(false);
  });

  it('respects a submission that already happened', () => {
    expect(isNonReimbursable(invoice(0, 'eingereicht'))).toBe(false);
    expect(isNonReimbursable(invoice(0, 'erstattet'))).toBe(false);
  });

  it('is independent of the review and payment tracks', () => {
    const neuAndPaid: ReimbursabilityInvoice = {
      eligible_amount: 0,
      status: {
        review: 'neu',
        payment: 'bezahlt',
        submission: 'nicht_eingereicht',
        paid_on: '2026-03-01',
      },
    };
    expect(isNonReimbursable(neuAndPaid)).toBe(true);
  });
});

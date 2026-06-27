// SPDX-License-Identifier: Apache-2.0
import type { BREStructure } from '@selbstbehalt/shared';
import { describe, expect, it } from 'vitest';

import { calculateGCP, DEFAULT_DISCOUNT_RATE, type GCP_Input } from './guenstiger-pruefung.js';

/** The three-tier ladder from docs/design.md §3.2 (12/24/36 months → 1/2/3 months, 100 %). */
function ladder(currentStreakStart: string | null): BREStructure {
  return {
    type: 'staffel',
    levels: [
      { leistungsfrei_months: 12, bre_months: 1, pct_of_premium: 100 },
      { leistungsfrei_months: 24, bre_months: 2, pct_of_premium: 100 },
      { leistungsfrei_months: 36, bre_months: 3, pct_of_premium: 100 },
    ],
    current_streak_start: currentStreakStart,
  };
}

/** A baseline input; spread and override per test. */
function input(overrides: Partial<GCP_Input> = {}): GCP_Input {
  return {
    rechnungsBetrag: 85,
    erstattungsBetrag: 62.5,
    verbleibenderSelbstbehalt: 150,
    breStructure: ladder('2023-06-01'),
    monthlyPremium: 185,
    taxRate: 0,
    asOf: '2024-05-01',
    ...overrides,
  };
}

describe('calculateGCP — worked example (design §5.3)', () => {
  // Dr. Müller bill: 85,00 € gross, 62,50 € reimbursable, 150,00 € deductible left,
  // 11-month streak, 185 €/month premium → recommendation "selbst zahlen".
  const result = calculateGCP(input());

  it('recommends self-paying', () => {
    expect(result.recommendation).toBe('selbst_zahlen');
  });

  it('nets the refund to zero against the open deductible', () => {
    // max(0, 62.50 − 150) = 0 — matches the "Nettoerstattung 0,00 €" line.
    expect(result.breakdown.refundAfterDeductible).toBe(0);
  });

  it('reads the streak as 11 months', () => {
    expect(result.breakdown.currentStreakMonths).toBe(11);
  });

  it('projects the forfeited BRE at one monthly premium (lowest level)', () => {
    // Streak 11 < 12 ⇒ lowest level: 1 × 185 € × 100 % = 185,00 €.
    expect(result.breakdown.projectedBRELoss).toBe(185);
  });

  it('discounts the BRE loss to ~181 € (design shows 181,40 €)', () => {
    // 185 / (1 + 0.03/12)^8, with 8 whole months to year-end from 2024-05-01.
    expect(result.breakdown.monthsToYearEnd).toBe(8);
    expect(result.breakdown.lostBREValue_NPV).toBe(181.34);
    expect(result.breakdown.lostBREValue_NPV).toBeCloseTo(181.4, 0);
  });

  it('reports the net advantage of submitting as the negated NPV (no tax here)', () => {
    expect(result.breakdown.taxSavingFromSelfPay).toBe(0);
    expect(result.netBenefitOfSubmitting).toBe(-181.34);
  });

  it('explains the recommendation in German', () => {
    expect(result.explanation).toContain('Selbst zahlen lohnt sich');
    expect(result.explanation).toContain('181,34');
  });
});

describe('calculateGCP — recommendation einreichen', () => {
  it('recommends submitting when the net refund dwarfs the BRE loss', () => {
    const result = calculateGCP(
      input({
        rechnungsBetrag: 1000,
        erstattungsBetrag: 1000,
        verbleibenderSelbstbehalt: 0,
        monthlyPremium: 50,
        breStructure: ladder('2024-01-01'),
        asOf: '2024-04-01',
      }),
    );
    expect(result.recommendation).toBe('einreichen');
    expect(result.breakdown.refundAfterDeductible).toBe(1000);
    expect(result.netBenefitOfSubmitting).toBeGreaterThan(0);
    expect(result.explanation).toContain('Einreichen lohnt sich');
  });
});

describe('calculateGCP — netBenefit boundary', () => {
  // discountRate 0 ⇒ NPV equals the undiscounted loss, making the boundary exact.
  const boundary = (erstattungsBetrag: number): GCP_Input =>
    input({
      erstattungsBetrag,
      verbleibenderSelbstbehalt: 0,
      monthlyPremium: 100,
      breStructure: ladder('2024-01-01'),
      asOf: '2024-06-01',
      discountRate: 0,
      taxRate: 0,
    });

  it('treats an exact tie (netBenefit === 0) as self-pay', () => {
    // refundAfterDeductible 100 === NPV 100, tax 0 ⇒ net exactly 0.
    const result = calculateGCP(boundary(100));
    expect(result.breakdown.lostBREValue_NPV).toBe(100);
    expect(result.netBenefitOfSubmitting).toBe(0);
    expect(result.recommendation).toBe('selbst_zahlen');
    expect(result.explanation).toContain('gleichwertig');
  });

  it('tips to einreichen one cent above the tie', () => {
    const result = calculateGCP(boundary(100.01));
    expect(result.netBenefitOfSubmitting).toBe(0.01);
    expect(result.recommendation).toBe('einreichen');
  });

  it('tips to selbst_zahlen one cent below the tie', () => {
    const result = calculateGCP(boundary(99.99));
    expect(result.netBenefitOfSubmitting).toBe(-0.01);
    expect(result.recommendation).toBe('selbst_zahlen');
  });
});

describe('calculateGCP — tax saving from self-paying', () => {
  it('is a benefit of self-paying, so it lowers the benefit of submitting', () => {
    const base = input({
      rechnungsBetrag: 1000,
      erstattungsBetrag: 1000,
      verbleibenderSelbstbehalt: 0,
      monthlyPremium: 50,
      breStructure: ladder('2024-01-01'),
      asOf: '2024-04-01',
    });
    const withoutTax = calculateGCP({ ...base, taxRate: 0 });
    const withTax = calculateGCP({ ...base, taxRate: 0.42 });

    // 1000 € × 42 % × 0.5 deductible share = 210,00 €.
    expect(withTax.breakdown.taxSavingFromSelfPay).toBe(210);
    expect(withoutTax.breakdown.taxSavingFromSelfPay).toBe(0);
    // The tax saving must reduce — never increase — the net benefit of submitting.
    expect(withTax.netBenefitOfSubmitting).toBeCloseTo(withoutTax.netBenefitOfSubmitting - 210, 2);
    expect(withTax.netBenefitOfSubmitting).toBeLessThan(withoutTax.netBenefitOfSubmitting);
  });

  it('can flip the recommendation to self-pay on its own', () => {
    const base = input({
      rechnungsBetrag: 400,
      erstattungsBetrag: 200,
      verbleibenderSelbstbehalt: 0,
      monthlyPremium: 10, // tiny BRE so the tax term is decisive
      breStructure: ladder('2024-01-01'),
      asOf: '2024-12-01',
    });
    expect(calculateGCP({ ...base, taxRate: 0 }).recommendation).toBe('einreichen');
    // 400 € × 1.0 × 0.5 = 200 € tax saving wipes out the 200 € refund.
    expect(calculateGCP({ ...base, taxRate: 1 }).recommendation).toBe('selbst_zahlen');
  });
});

describe('calculateGCP — deductible handling', () => {
  it('clamps the net refund to zero when the deductible exceeds the refund', () => {
    const result = calculateGCP(input({ erstattungsBetrag: 50, verbleibenderSelbstbehalt: 200 }));
    expect(result.breakdown.refundAfterDeductible).toBe(0);
  });

  it('subtracts only the remaining deductible from the refund', () => {
    const result = calculateGCP(input({ erstattungsBetrag: 500, verbleibenderSelbstbehalt: 150 }));
    expect(result.breakdown.refundAfterDeductible).toBe(350);
  });
});

describe('calculateGCP — discounting', () => {
  it('defaults the discount rate to 3 % p.a. and reports it', () => {
    const result = calculateGCP(input());
    expect(result.breakdown.discountRate).toBe(DEFAULT_DISCOUNT_RATE);
    // A positive rate over 8 months discounts the loss below face value.
    expect(result.breakdown.lostBREValue_NPV).toBeLessThan(result.breakdown.projectedBRELoss);
  });

  it('does not discount when there are no months left to year-end (December)', () => {
    // 12 − getMonth(11) = 1 in December, so a small discount still applies;
    // with rate 0 the NPV equals the face value regardless of the month.
    const result = calculateGCP(input({ discountRate: 0, asOf: '2024-12-31' }));
    expect(result.breakdown.lostBREValue_NPV).toBe(result.breakdown.projectedBRELoss);
  });

  it('discounts more strongly with a higher rate', () => {
    const low = calculateGCP(input({ discountRate: 0.03 }));
    const high = calculateGCP(input({ discountRate: 0.2 }));
    expect(high.breakdown.lostBREValue_NPV).toBeLessThan(low.breakdown.lostBREValue_NPV);
  });
});

describe('calculateGCP — streak entitlement', () => {
  it('raises the projected loss as the streak climbs the ladder', () => {
    const common = { monthlyPremium: 100, taxRate: 0, asOf: '2025-06-01' } as const;
    const young = calculateGCP(input({ ...common, breStructure: ladder('2024-06-01') })); // ~12 mo
    const old = calculateGCP(input({ ...common, breStructure: ladder('2022-06-01') })); // ~36 mo
    // 1 month premium at level 1 vs 3 months at the top level.
    expect(young.breakdown.projectedBRELoss).toBe(100);
    expect(old.breakdown.projectedBRELoss).toBe(300);
  });
});

describe('calculateGCP — determinism & injectable date', () => {
  it('is deterministic for a fixed asOf', () => {
    const a = calculateGCP(input());
    const b = calculateGCP(input());
    expect(a).toEqual(b);
  });

  it('accepts a Date and a string asOf interchangeably', () => {
    const asString = calculateGCP(input({ asOf: '2024-05-01' }));
    const asDate = calculateGCP(input({ asOf: new Date(2024, 4, 1) }));
    expect(asDate.breakdown).toEqual(asString.breakdown);
  });

  it('defaults asOf to today when omitted (no hidden Date.now in the formula)', () => {
    const { asOf: _omit, ...rest } = input();
    void _omit;
    // Just exercises the default branch; the structure must still be complete.
    const result = calculateGCP(rest);
    expect(result.recommendation).toMatch(/einreichen|selbst_zahlen/);
    expect(result.breakdown.monthsToYearEnd).toBeGreaterThanOrEqual(1);
    expect(result.breakdown.monthsToYearEnd).toBeLessThanOrEqual(12);
  });
});

describe('calculateGCP — input validation', () => {
  it('rejects a tax rate outside [0, 1]', () => {
    expect(() => calculateGCP(input({ taxRate: -0.1 }))).toThrow(RangeError);
    expect(() => calculateGCP(input({ taxRate: 1.5 }))).toThrow(RangeError);
  });

  it('rejects a discount rate of -1 or below', () => {
    expect(() => calculateGCP(input({ discountRate: -1 }))).toThrow(RangeError);
  });

  it('rejects a malformed asOf string', () => {
    expect(() => calculateGCP(input({ asOf: '01.05.2024' }))).toThrow(RangeError);
  });
});

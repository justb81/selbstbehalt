// SPDX-License-Identifier: Apache-2.0
import type { BREStructure } from '@selbstbehalt/shared';
import { describe, expect, it } from 'vitest';

import {
  aggregateByYear,
  calculateBRELadderNPV,
  calculateGCP,
  DEFAULT_CLAIM_FREE_PROBABILITY,
  DEFAULT_DISCOUNT_RATE,
  DEFAULT_PAYOUT_MONTH,
  type GCP_InvoiceData,
  type GCP_YearInput,
} from './guenstiger-pruefung.js';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

/**
 * Maps an old-linear status name to the derived {review, submission} tracks that
 * aggregateByYear reads. `neu` → unreviewed (skipped); `erstattet` → reimbursed
 * (refund); everything else → reviewed-but-not-reimbursed (estimate). Payment is
 * irrelevant to the aggregation, so it is omitted.
 */
function st(
  s: 'neu' | 'geprüft' | 'bezahlt' | 'eingereicht' | 'erstattet',
): GCP_InvoiceData['status'] {
  return {
    review: s === 'neu' ? 'neu' : 'geprüft',
    submission:
      s === 'erstattet' ? 'erstattet' : s === 'eingereicht' ? 'eingereicht' : 'nicht_eingereicht',
  };
}

/**
 * Three-tier ladder: 1/2/3 claim-free years → 1/2/3 months' premium at 100%.
 * With monthlyPremium=100: B(1)=100, B(2)=200, B(3)=300.
 */
function ladder(currentStreakStart: string | null): BREStructure {
  return {
    type: 'staffel',
    levels: [
      { claim_free_years: 1, bre_years: 1, pct_of_premium: 100 },
      { claim_free_years: 2, bre_years: 2, pct_of_premium: 100 },
      { claim_free_years: 3, bre_years: 3, pct_of_premium: 100 },
    ],
    current_streak_start: currentStreakStart,
  };
}

/**
 * Baseline GCP_YearInput; spread and override per test. Defaults to `selbstbehalt: 0`
 * so the bare fixture already crosses the deductible and the NPV/ladder is computed
 * — tests that need the under-deductible case set `selbstbehalt` explicitly.
 */
function input(overrides: Partial<GCP_YearInput> = {}): GCP_YearInput {
  return {
    year: 2024,
    erstattungsBetrag: 250,
    alreadyReimbursed: 0,
    selbstbehalt: 0,
    breStructure: ladder('2023-06-01'), // ~0 complete years at 2024-05-01
    monthlyPremium: 100,
    asOf: '2024-05-01',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// aggregateByYear
// ---------------------------------------------------------------------------

describe('aggregateByYear — basic grouping', () => {
  it('returns empty array for no invoices', () => {
    expect(aggregateByYear([])).toEqual([]);
  });

  it('ignores neu invoices entirely', () => {
    const invoices: GCP_InvoiceData[] = [
      {
        status: st('neu'),
        positions: [{ treatment_date: '2024-03-15', eligible_amount: 500 }],
      },
    ];
    expect(aggregateByYear(invoices)).toEqual([]);
  });

  it('aggregates eligible_amount for geprüft invoices', () => {
    const invoices: GCP_InvoiceData[] = [
      {
        status: st('geprüft'),
        positions: [
          { treatment_date: '2024-03-01', eligible_amount: 100 },
          { treatment_date: '2024-08-15', eligible_amount: 150 },
        ],
      },
    ];
    const result = aggregateByYear(invoices);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ year: 2024, R_Y: 250, alreadyReimbursed: 0 });
  });

  it('aggregates eligible_amount for bezahlt invoices', () => {
    const invoices: GCP_InvoiceData[] = [
      {
        status: st('bezahlt'),
        positions: [{ treatment_date: '2024-06-01', eligible_amount: 200 }],
      },
    ];
    const [r] = aggregateByYear(invoices);
    expect(r).toMatchObject({ year: 2024, R_Y: 200, alreadyReimbursed: 0 });
  });

  it('aggregates eligible_amount for eingereicht invoices', () => {
    const invoices: GCP_InvoiceData[] = [
      {
        status: st('eingereicht'),
        positions: [{ treatment_date: '2024-01-20', eligible_amount: 80 }],
      },
    ];
    const [r] = aggregateByYear(invoices);
    expect(r).toMatchObject({ year: 2024, R_Y: 80, alreadyReimbursed: 0 });
  });

  it('uses refund_amount for erstattet invoices, not eligible_amount', () => {
    const invoices: GCP_InvoiceData[] = [
      {
        status: st('erstattet'),
        positions: [{ treatment_date: '2024-05-01', eligible_amount: 200, refund_amount: 180 }],
      },
    ];
    const [r] = aggregateByYear(invoices);
    expect(r?.R_Y).toBe(180);
    expect(r?.alreadyReimbursed).toBe(180);
  });

  it('accumulates alreadyReimbursed from an erstattet position with refund_amount > 0', () => {
    const invoices: GCP_InvoiceData[] = [
      {
        status: st('erstattet'),
        positions: [{ treatment_date: '2024-04-01', eligible_amount: 100, refund_amount: 50 }],
      },
    ];
    const [r] = aggregateByYear(invoices);
    expect(r?.alreadyReimbursed).toBe(50);
    expect(r?.R_Y).toBe(50);
  });

  it('records zero alreadyReimbursed when erstattet has refund_amount = 0 (rejected)', () => {
    const invoices: GCP_InvoiceData[] = [
      {
        status: st('erstattet'),
        positions: [{ treatment_date: '2024-04-01', eligible_amount: 100, refund_amount: 0 }],
      },
    ];
    const [r] = aggregateByYear(invoices);
    expect(r?.alreadyReimbursed).toBe(0);
    expect(r?.R_Y).toBe(0);
  });
});

describe('aggregateByYear — multiple invoices, one year', () => {
  it('sums amounts across multiple invoices in the same year', () => {
    const invoices: GCP_InvoiceData[] = [
      {
        status: st('geprüft'),
        positions: [{ treatment_date: '2024-02-10', eligible_amount: 300 }],
      },
      {
        status: st('bezahlt'),
        positions: [{ treatment_date: '2024-09-05', eligible_amount: 220 }],
      },
    ];
    const [r] = aggregateByYear(invoices);
    expect(r).toMatchObject({ year: 2024, R_Y: 520, alreadyReimbursed: 0 });
  });

  it('accumulates realised reimbursement from the erstattet invoices of a year', () => {
    const invoices: GCP_InvoiceData[] = [
      {
        status: st('bezahlt'),
        positions: [{ treatment_date: '2024-03-01', eligible_amount: 400 }],
      },
      {
        status: st('erstattet'),
        positions: [{ treatment_date: '2024-07-01', eligible_amount: 200, refund_amount: 200 }],
      },
    ];
    const [r] = aggregateByYear(invoices);
    expect(r?.alreadyReimbursed).toBe(200);
    // R_Y = bezahlt eligible_amount + erstattet refund_amount
    expect(r?.R_Y).toBe(600);
  });
});

describe('aggregateByYear — invoice spanning two service years (Sammelrechnung)', () => {
  it('splits positions into their respective treatment years', () => {
    const invoices: GCP_InvoiceData[] = [
      {
        status: st('geprüft'),
        positions: [
          { treatment_date: '2023-12-20', eligible_amount: 150 }, // year 2023
          { treatment_date: '2024-01-10', eligible_amount: 250 }, // year 2024
        ],
      },
    ];
    const results = aggregateByYear(invoices).sort((a, b) => a.year - b.year);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ year: 2023, R_Y: 150, alreadyReimbursed: 0 });
    expect(results[1]).toMatchObject({ year: 2024, R_Y: 250, alreadyReimbursed: 0 });
  });

  it('alreadyReimbursed is year-scoped: one year does not affect another', () => {
    const invoices: GCP_InvoiceData[] = [
      {
        status: st('erstattet'),
        positions: [
          { treatment_date: '2023-11-01', eligible_amount: 100, refund_amount: 100 }, // 2023
          { treatment_date: '2024-02-01', eligible_amount: 80, refund_amount: 0 }, // 2024, rejected
        ],
      },
    ];
    const results = aggregateByYear(invoices).sort((a, b) => a.year - b.year);
    expect(results[0]).toMatchObject({ year: 2023, alreadyReimbursed: 100 });
    expect(results[1]).toMatchObject({ year: 2024, alreadyReimbursed: 0 });
  });
});

describe('aggregateByYear — treats null/undefined amounts as zero', () => {
  it('treats missing eligible_amount as 0', () => {
    const invoices: GCP_InvoiceData[] = [
      {
        status: st('geprüft'),
        positions: [{ treatment_date: '2024-06-01' }],
      },
    ];
    const [r] = aggregateByYear(invoices);
    expect(r?.R_Y).toBe(0);
  });

  it('treats null refund_amount as 0 (no realised reimbursement)', () => {
    const invoices: GCP_InvoiceData[] = [
      {
        status: st('erstattet'),
        positions: [{ treatment_date: '2024-06-01', eligible_amount: 100, refund_amount: null }],
      },
    ];
    const [r] = aggregateByYear(invoices);
    expect(r?.alreadyReimbursed).toBe(0);
    expect(r?.R_Y).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// calculateGCP — core NPV and decision
// ---------------------------------------------------------------------------

describe('calculateGCP — below Selbstbehalt', () => {
  it('yields refundAfterDeductible = 0 when R_Y < S', () => {
    const result = calculateGCP(input({ erstattungsBetrag: 300, selbstbehalt: 500 }));
    expect(result.breakdown.refundAfterDeductible).toBe(0);
  });

  it('recommends selbst_zahlen when R_Y < S (no refund regardless)', () => {
    const result = calculateGCP(input({ erstattungsBetrag: 300, selbstbehalt: 500 }));
    expect(result.recommendation).toBe('selbst_zahlen');
  });

  it('charges no BRE cost below the deductible — submitting there is inconsequential', () => {
    const result = calculateGCP(input({ erstattungsBetrag: 300, selbstbehalt: 500 }));
    expect(result.breakdown.lostBREValue_NPV).toBe(0);
    expect(result.breakdown.ladderTerms).toHaveLength(0);
    expect(result.netBenefitOfSubmitting).toBe(0);
    expect(result.explanation).toContain('unter dem Selbstbehalt');
  });
});

describe('calculateGCP — above Selbstbehalt', () => {
  it('correctly computes refundAfterDeductible = R_Y - S', () => {
    const result = calculateGCP(
      input({ erstattungsBetrag: 800, selbstbehalt: 500, monthlyPremium: 10 }),
    );
    expect(result.breakdown.refundAfterDeductible).toBe(300);
  });

  it('only starts charging the BRE cost for the amount that crosses the deductible', () => {
    // At exactly S: still under the threshold (no payout, no BRE cost).
    const atThreshold = calculateGCP(input({ erstattungsBetrag: 500, selbstbehalt: 500 }));
    expect(atThreshold.breakdown.lostBREValue_NPV).toBe(0);
    expect(atThreshold.breakdown.ladderTerms).toHaveLength(0);

    // One euro over S: the streak is now at stake, so the NPV kicks in.
    const overThreshold = calculateGCP(input({ erstattungsBetrag: 501, selbstbehalt: 500 }));
    expect(overThreshold.breakdown.refundAfterDeductible).toBe(1);
    expect(overThreshold.breakdown.lostBREValue_NPV).toBeGreaterThan(0);
    expect(overThreshold.breakdown.ladderTerms.length).toBeGreaterThanOrEqual(1);
  });
});

describe('calculateGCP — Sofort-Term NPV (j=0)', () => {
  it('calculates gross as B(min(s+1, nMax)) with s=0', () => {
    // s=0 (streak started 2023-06-01, asOf 2024-05-01 → 0 complete years)
    // B(min(1,3)) = B(1) = 1 × 100€ × 100% = 100€
    const result = calculateGCP(input({ monthlyPremium: 100 }));
    expect(result.breakdown.ladderTerms[0]?.gross).toBe(100);
  });

  it('calculates gross as B(min(s+1, nMax)) with s=2 (streak 2 years)', () => {
    // s=2 (streak since 2022-04-01, asOf 2024-05-01 → 2 complete years)
    // B(min(3,3)) = B(3) = 3 × 100€ = 300€
    const result = calculateGCP(
      input({ breStructure: ladder('2022-04-01'), monthlyPremium: 100, asOf: '2024-05-01' }),
    );
    expect(result.breakdown.currentStreakYears).toBe(2);
    expect(result.breakdown.ladderTerms[0]?.gross).toBe(300);
  });

  it('caps gross at nMax when streak already at top', () => {
    // s=5 (way beyond nMax=3); B(min(6,3)) = B(3) = 300€
    const result = calculateGCP(
      input({ breStructure: ladder('2018-01-01'), monthlyPremium: 100, asOf: '2024-05-01' }),
    );
    expect(result.breakdown.currentStreakYears).toBeGreaterThanOrEqual(3);
    expect(result.breakdown.ladderTerms[0]?.gross).toBe(300);
  });

  it('probability is 1 for j=0', () => {
    const result = calculateGCP(input());
    expect(result.breakdown.ladderTerms[0]?.probability).toBe(1);
  });

  it('produces at least one ladder term (j=0 always present when the deductible is crossed)', () => {
    const result = calculateGCP(input());
    expect(result.breakdown.ladderTerms.length).toBeGreaterThanOrEqual(1);
    expect(result.breakdown.ladderTerms[0]?.j).toBe(0);
  });
});

describe('calculateGCP — τ₀ discounting', () => {
  it('discounts BRE over 12 months (July decision, payout July Y+1)', () => {
    // asOf = 2024-07-01 (July of Y), payoutMonth=7, year=2024
    // τ₀ = (2025-2024)*12 + (7-1-6) = 12 months
    const result = calculateGCP(input({ asOf: '2024-07-01', year: 2024, discountRate: 0.03 }));
    expect(result.breakdown.ladderTerms[0]?.monthsToPayout).toBe(12);
    const gross = result.breakdown.ladderTerms[0]!.gross;
    const expected = roundCents(gross / Math.pow(1 + 0.03 / 12, 12));
    expect(result.breakdown.ladderTerms[0]?.discounted).toBe(expected);
    // Total NPV ≥ j=0 term (multi-year sum includes j≥1 recovery terms)
    expect(result.breakdown.lostBREValue_NPV).toBeGreaterThanOrEqual(expected);
  });

  it('τ₀ = 6 for a December service year decided in January (Dezember-Position)', () => {
    // Year Y=2024, asOf = 2025-01-15 (January), payoutMonth=7
    // τ₀ = (2025-2024)*12 + (7-1-0) = 0 + 6 = 6 months
    const result = calculateGCP(input({ year: 2024, asOf: '2025-01-15' }));
    expect(result.breakdown.ladderTerms[0]?.monthsToPayout).toBe(6);
  });

  it('τ₀ = 0 for a past year (rückwirkendes Jahr — no discounting on j=0)', () => {
    // Year Y=2023, asOf=2025-01-01, payoutMonth=7 → payout was July 2024 (past)
    // τ₀ = max(0, (2024-2025)*12 + (6-0)) = max(0,-6) = 0
    const result = calculateGCP(input({ year: 2023, asOf: '2025-01-01' }));
    expect(result.breakdown.ladderTerms[0]?.monthsToPayout).toBe(0);
    // j=0: discounted = gross * 1 / (1+i/12)^0 = gross (no discounting)
    const j0 = result.breakdown.ladderTerms[0]!;
    expect(j0.discounted).toBe(j0.gross);
    // j≥1 terms may still be discounted (τ_j > 0 for future years)
    expect(result.breakdown.lostBREValue_NPV).toBeGreaterThanOrEqual(j0.discounted);
  });

  it('τ₀ = 0 when asOf is exactly the payout month of Y+1', () => {
    // asOf = 2025-07-01 (July Y+1), year=2024, payoutMonth=7
    // τ₀ = (2025-2025)*12 + (6-6) = 0
    const result = calculateGCP(input({ year: 2024, asOf: '2025-07-01' }));
    expect(result.breakdown.ladderTerms[0]?.monthsToPayout).toBe(0);
  });

  it('discounts more strongly with a higher discount rate', () => {
    const low = calculateGCP(input({ discountRate: 0.03, asOf: '2024-01-01' }));
    const high = calculateGCP(input({ discountRate: 0.2, asOf: '2024-01-01' }));
    expect(high.breakdown.lostBREValue_NPV).toBeLessThan(low.breakdown.lostBREValue_NPV);
  });

  it('does not discount when discountRate = 0', () => {
    const result = calculateGCP(input({ discountRate: 0, asOf: '2024-01-01' }));
    // When discountRate=0 each term's time-discount factor is 1 → discounted = gross * probability
    result.breakdown.ladderTerms.forEach((t) => {
      expect(t.discounted).toBeCloseTo(roundCents(t.gross * t.probability), 2);
    });
    const sumDiscounted = result.breakdown.ladderTerms.reduce((s, t) => s + t.discounted, 0);
    expect(result.breakdown.lostBREValue_NPV).toBeCloseTo(sumDiscounted, 2);
  });

  it('respects a custom payoutMonth', () => {
    // payoutMonth = 12 (December), asOf = 2024-07-01, year=2024
    // payoutYear=2025, τ₀ = (2025-2024)*12 + (12-1-6) = 12+5 = 17 months
    const result = calculateGCP(input({ year: 2024, asOf: '2024-07-01', payoutMonth: 12 }));
    expect(result.breakdown.ladderTerms[0]?.monthsToPayout).toBe(17);
  });
});

// ---------------------------------------------------------------------------
// calculateGCP — streak-break threshold (design §5.2.1, point 2)
// ---------------------------------------------------------------------------

describe('calculateGCP — streak breaks only above the Selbstbehalt', () => {
  it('a realised refund BELOW the deductible does NOT break the streak', () => {
    // The user's exact scenario: a small reimbursement has flowed, but stays well
    // under the annual Selbstbehalt → the year is still leistungsfrei, streak intact.
    const result = calculateGCP(
      input({ alreadyReimbursed: 50, erstattungsBetrag: 300, selbstbehalt: 500 }),
    );
    expect(result.breakdown.alreadyBroken).toBe(false);
    expect(result.breakdown.lostBREValue_NPV).toBe(0);
    expect(result.explanation).not.toContain('gebrochen');
    expect(result.explanation).toContain('unter dem Selbstbehalt');
  });

  it('realised refunds that EXCEED the deductible break the streak', () => {
    const result = calculateGCP(
      input({ alreadyReimbursed: 600, erstattungsBetrag: 900, selbstbehalt: 500 }),
    );
    expect(result.breakdown.alreadyBroken).toBe(true);
    expect(result.breakdown.lostBREValue_NPV).toBe(0);
    expect(result.recommendation).toBe('einreichen');
  });

  it('realised refunds exactly at the deductible do not break the streak', () => {
    // "übersteigen" = strictly greater than; at exactly S nothing is paid above it.
    const result = calculateGCP(
      input({ alreadyReimbursed: 500, erstattungsBetrag: 500, selbstbehalt: 500 }),
    );
    expect(result.breakdown.alreadyBroken).toBe(false);
  });
});

describe('calculateGCP — alreadyBroken special case', () => {
  it('sets lostBREValue_NPV = 0 when realised reimbursements exceed S', () => {
    const result = calculateGCP(
      input({ alreadyReimbursed: 600, erstattungsBetrag: 800, selbstbehalt: 500 }),
    );
    expect(result.breakdown.alreadyBroken).toBe(true);
    expect(result.breakdown.lostBREValue_NPV).toBe(0);
    expect(result.breakdown.ladderTerms).toHaveLength(0);
  });

  it('always recommends einreichen once the streak is already broken', () => {
    const result = calculateGCP(
      input({ alreadyReimbursed: 600, erstattungsBetrag: 800, selbstbehalt: 500 }),
    );
    expect(result.recommendation).toBe('einreichen');
  });

  it('explanation states the streak is already broken', () => {
    const result = calculateGCP(
      input({ alreadyReimbursed: 600, erstattungsBetrag: 800, selbstbehalt: 500 }),
    );
    expect(result.explanation).toContain('bereits');
    expect(result.explanation).toContain('Einreichen empfohlen');
  });
});

describe('calculateGCP — recommendation thresholds', () => {
  it('treats exact tie (netBenefit = 0) as selbst_zahlen', () => {
    // Use a single-level ladder (nMax=1) so the NPV has exactly one term (j=0).
    // discountRate=0, s=0 → NPV = B(1)-B(0) = 100. erstattungsBetrag=100, selbstbehalt=0
    // → refundAfterDeductible=100, netBenefit = 100-100 = 0.
    const singleLevel: BREStructure = {
      type: 'staffel',
      levels: [{ claim_free_years: 1, bre_years: 1, pct_of_premium: 100 }],
      current_streak_start: '2023-06-01',
    };
    const result = calculateGCP({
      year: 2024,
      erstattungsBetrag: 100,
      alreadyReimbursed: 0,
      selbstbehalt: 0,
      breStructure: singleLevel,
      monthlyPremium: 100,
      discountRate: 0,
      asOf: '2024-05-01',
    });
    expect(result.netBenefitOfSubmitting).toBe(0);
    expect(result.recommendation).toBe('selbst_zahlen');
    expect(result.explanation).toContain('gleichwertig');
  });

  it('tips to einreichen one cent above the tie', () => {
    const singleLevel: BREStructure = {
      type: 'staffel',
      levels: [{ claim_free_years: 1, bre_years: 1, pct_of_premium: 100 }],
      current_streak_start: '2023-06-01',
    };
    const result = calculateGCP({
      year: 2024,
      erstattungsBetrag: 100.01,
      alreadyReimbursed: 0,
      selbstbehalt: 0,
      breStructure: singleLevel,
      monthlyPremium: 100,
      discountRate: 0,
      asOf: '2024-05-01',
    });
    expect(result.netBenefitOfSubmitting).toBeCloseTo(0.01, 2);
    expect(result.recommendation).toBe('einreichen');
  });

  it('tips to selbst_zahlen one cent below the tie', () => {
    const singleLevel: BREStructure = {
      type: 'staffel',
      levels: [{ claim_free_years: 1, bre_years: 1, pct_of_premium: 100 }],
      current_streak_start: '2023-06-01',
    };
    const result = calculateGCP({
      year: 2024,
      erstattungsBetrag: 99.99,
      alreadyReimbursed: 0,
      selbstbehalt: 0,
      breStructure: singleLevel,
      monthlyPremium: 100,
      discountRate: 0,
      asOf: '2024-05-01',
    });
    expect(result.recommendation).toBe('selbst_zahlen');
  });

  it('recommends einreichen when refund far exceeds NPV', () => {
    const result = calculateGCP(
      input({
        erstattungsBetrag: 2000,
        selbstbehalt: 0,
        monthlyPremium: 50,
        breStructure: ladder('2024-01-01'),
        asOf: '2024-04-01',
      }),
    );
    expect(result.recommendation).toBe('einreichen');
    expect(result.netBenefitOfSubmitting).toBeGreaterThan(0);
  });
});

describe('calculateGCP — breakdown fields', () => {
  it('reports the service year in breakdown', () => {
    const result = calculateGCP(input({ year: 2023 }));
    expect(result.breakdown.year).toBe(2023);
  });

  it('reports the relevant amount, Selbstbehalt and realised reimbursement', () => {
    const result = calculateGCP(
      input({ erstattungsBetrag: 800, selbstbehalt: 500, alreadyReimbursed: 120 }),
    );
    expect(result.breakdown.relevantAmount).toBe(800);
    expect(result.breakdown.selbstbehalt).toBe(500);
    expect(result.breakdown.alreadyReimbursed).toBe(120);
  });

  it('reports currentStreakYears correctly', () => {
    // streak started 2022-04-01, asOf 2024-05-01 → 2 complete years
    const result = calculateGCP(input({ breStructure: ladder('2022-04-01'), asOf: '2024-05-01' }));
    expect(result.breakdown.currentStreakYears).toBe(2);
  });

  it('reports default constants', () => {
    const result = calculateGCP(input());
    expect(result.breakdown.discountRate).toBe(DEFAULT_DISCOUNT_RATE);
    expect(result.breakdown.claimFreeProbability).toBe(DEFAULT_CLAIM_FREE_PROBABILITY);
  });

  it('reports injected claimFreeProbability (stored for issue #141)', () => {
    const result = calculateGCP(input({ claimFreeProbability: 0.5 }));
    expect(result.breakdown.claimFreeProbability).toBe(0.5);
  });
});

describe('calculateGCP — explanation contains year', () => {
  it('einreichen explanation references the service year', () => {
    const result = calculateGCP(
      input({ year: 2023, erstattungsBetrag: 2000, selbstbehalt: 0, monthlyPremium: 10 }),
    );
    expect(result.recommendation).toBe('einreichen');
    expect(result.explanation).toContain('2023');
    expect(result.explanation).toContain('Einreichen lohnt sich');
  });

  it('selbst_zahlen explanation references the service year (over threshold)', () => {
    // erstattungsBetrag 50 > S 0 → crosses the deductible, but the BRE at stake
    // outweighs the tiny net refund → self-pay.
    const result = calculateGCP(input({ year: 2025, erstattungsBetrag: 50, selbstbehalt: 0 }));
    expect(result.recommendation).toBe('selbst_zahlen');
    expect(result.explanation).toContain('2025');
    expect(result.explanation).toContain('Selbst zahlen lohnt sich');
  });
});

describe('calculateGCP — determinism & injectable date', () => {
  it('is deterministic for a fixed asOf', () => {
    expect(calculateGCP(input())).toEqual(calculateGCP(input()));
  });

  it('accepts a Date and a string asOf interchangeably', () => {
    const asString = calculateGCP(input({ asOf: '2024-05-01' }));
    const asDate = calculateGCP(input({ asOf: new Date(2024, 4, 1) }));
    expect(asDate.breakdown).toEqual(asString.breakdown);
  });
});

describe('calculateGCP — input validation', () => {
  it('rejects discountRate ≤ −1', () => {
    expect(() => calculateGCP(input({ discountRate: -1 }))).toThrow(RangeError);
    expect(() => calculateGCP(input({ discountRate: -2 }))).toThrow(RangeError);
  });

  it('accepts discountRate = 0', () => {
    expect(() => calculateGCP(input({ discountRate: 0 }))).not.toThrow();
  });

  it('rejects claimFreeProbability outside [0, 1]', () => {
    expect(() => calculateGCP(input({ claimFreeProbability: -0.1 }))).toThrow(RangeError);
    expect(() => calculateGCP(input({ claimFreeProbability: 1.1 }))).toThrow(RangeError);
  });

  it('accepts claimFreeProbability at boundary values 0 and 1', () => {
    expect(() => calculateGCP(input({ claimFreeProbability: 0 }))).not.toThrow();
    expect(() => calculateGCP(input({ claimFreeProbability: 1 }))).not.toThrow();
  });

  it('rejects payoutMonth outside [1, 12]', () => {
    expect(() => calculateGCP(input({ payoutMonth: 0 }))).toThrow(RangeError);
    expect(() => calculateGCP(input({ payoutMonth: 13 }))).toThrow(RangeError);
  });

  it('rejects a malformed asOf string', () => {
    expect(() => calculateGCP(input({ asOf: '01.05.2024' }))).toThrow(RangeError);
  });
});

describe('calculateGCP — acceptance criteria (design §5.2 / issue #140)', () => {
  it('Selbstbehalt goes in once per year (not per invoice)', () => {
    // Two invoices, same year, combined R_Y = 800; S = 500 → refundAfterDeductible = 300
    const result = calculateGCP(
      input({ erstattungsBetrag: 800, selbstbehalt: 500, monthlyPremium: 10 }),
    );
    expect(result.breakdown.refundAfterDeductible).toBe(300);
  });

  it('December service, January decision → τ₀ correctly references July of Y+1', () => {
    // Y=2024 (December treatment), asOf = 2025-01-15 → payout July 2025 → τ₀ = 6
    const result = calculateGCP(input({ year: 2024, asOf: '2025-01-15', payoutMonth: 7 }));
    expect(result.breakdown.ladderTerms[0]?.monthsToPayout).toBe(6);
  });

  it('alreadyBroken ⇒ einreichen without BRE deduction (R_Y > S)', () => {
    const result = calculateGCP(
      input({ alreadyReimbursed: 600, erstattungsBetrag: 800, selbstbehalt: 500 }),
    );
    expect(result.breakdown.lostBREValue_NPV).toBe(0);
    expect(result.recommendation).toBe('einreichen');
  });

  it('past year τ₀ = 0 — no discounting on already-realised loss', () => {
    const result = calculateGCP(input({ year: 2022, asOf: '2025-01-01', payoutMonth: 7 }));
    // payout was July 2023, which is in the past → τ₀ = 0 → discounted = gross
    expect(result.breakdown.ladderTerms[0]?.monthsToPayout).toBe(0);
    expect(result.breakdown.ladderTerms[0]?.discounted).toBe(
      result.breakdown.ladderTerms[0]!.gross,
    );
  });
});

// ---------------------------------------------------------------------------
// DEFAULT exports
// ---------------------------------------------------------------------------

describe('exported constants', () => {
  it('DEFAULT_DISCOUNT_RATE is 0.03', () => {
    expect(DEFAULT_DISCOUNT_RATE).toBe(0.03);
  });

  it('DEFAULT_CLAIM_FREE_PROBABILITY is 0.7', () => {
    expect(DEFAULT_CLAIM_FREE_PROBABILITY).toBe(0.7);
  });

  it('DEFAULT_PAYOUT_MONTH is 7 (July)', () => {
    expect(DEFAULT_PAYOUT_MONTH).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Multi-year NPV (issue #141, design §5.2.4 + §5.2.5)
// ---------------------------------------------------------------------------

/**
 * Ladder matching design §5.2.5 reference example:
 *   B(0)=0, B(1)=200, B(2)=350, B(3)=500; nMax=3.
 */
function ladderDesign525(currentStreakStart: string | null): BREStructure {
  return {
    type: 'staffel',
    levels: [
      { claim_free_years: 1, fixed_amount_eur: 200 },
      { claim_free_years: 2, fixed_amount_eur: 350 },
      { claim_free_years: 3, fixed_amount_eur: 500 },
    ],
    current_streak_start: currentStreakStart,
  };
}

describe('calculateGCP — multi-year NPV (issue #141, design §5.2.4)', () => {
  it('reproduces design §5.2.5 example: B=[0,200,350,500], s=2, i=3%, p=0.7, τ_j=12*(j+1) → ≈751€', () => {
    // s=2 (streak started 2022-07-01, asOf=2024-07-01 → exactly 2 years)
    // payoutMonth=7, year=2024, asOf=2024-07-01 → τ_0=12, τ_1=24, τ_2=36
    const result = calculateGCP({
      year: 2024,
      erstattungsBetrag: 10_000, // large → always einreichen, focus on NPV
      alreadyReimbursed: 0,
      selbstbehalt: 0,
      breStructure: ladderDesign525('2022-07-01'),
      monthlyPremium: 1, // B values are fixed_amount_eur → monthlyPremium doesn't matter
      discountRate: 0.03,
      claimFreeProbability: 0.7,
      payoutMonth: 7,
      asOf: '2024-07-01',
    });
    // Three terms: j=0 (gap=500), j=1 (gap=300), j=2 (gap=150)
    expect(result.breakdown.ladderTerms).toHaveLength(3);
    // Exact NPV ≈ 750.21 € with per-cent rounding; design §5.2.5 says "≈751€" (unrounded).
    expect(result.breakdown.lostBREValue_NPV).toBeCloseTo(750.21, 0);
  });

  it('p=1 (no dampening): all recovery terms have full weight', () => {
    const result = calculateGCP({
      year: 2024,
      erstattungsBetrag: 10_000,
      alreadyReimbursed: 0,
      selbstbehalt: 0,
      breStructure: ladder('2023-01-01'),
      monthlyPremium: 100,
      discountRate: 0,
      claimFreeProbability: 1,
      payoutMonth: 7,
      asOf: '2024-07-01',
    });
    // p=1, discountRate=0 → NPV = Σ gross over all terms
    const sumGross = result.breakdown.ladderTerms.reduce((s, t) => s + t.gross, 0);
    expect(result.breakdown.lostBREValue_NPV).toBeCloseTo(sumGross, 2);
    result.breakdown.ladderTerms.forEach((t) => {
      expect(t.probability).toBeCloseTo(1, 5);
    });
  });

  it('p=0: only j=0 term contributes (j≥1 have weight 0)', () => {
    // p=0 → p^j = 0 for j≥1 → discounted = 0 for j≥1
    const result = calculateGCP({
      year: 2024,
      erstattungsBetrag: 10_000,
      alreadyReimbursed: 0,
      selbstbehalt: 0,
      breStructure: ladder('2022-01-01'), // s=2 so there are recovery terms
      monthlyPremium: 100,
      discountRate: 0,
      claimFreeProbability: 0,
      payoutMonth: 7,
      asOf: '2024-07-01',
    });
    const j1Plus = result.breakdown.ladderTerms.filter((t) => t.j > 0);
    j1Plus.forEach((t) => {
      expect(t.probability).toBe(0);
      expect(t.discounted).toBe(0);
    });
    // Total NPV = only j=0 term
    const j0 = result.breakdown.ladderTerms.find((t) => t.j === 0)!;
    expect(result.breakdown.lostBREValue_NPV).toBeCloseTo(j0.discounted, 2);
  });

  it('s ≥ nMax: only immediate term (both reset-paths reach nMax, no recovery gap)', () => {
    // nMax=1: j=0 only (j=1 would be j < 1, loop doesn't run)
    const singleLevelLadder: BREStructure = {
      type: 'staffel',
      levels: [{ claim_free_years: 1, bre_years: 1, pct_of_premium: 100 }],
      current_streak_start: '2020-01-01', // s=4 >> nMax=1
    };
    const result = calculateGCP({
      year: 2024,
      erstattungsBetrag: 10_000,
      alreadyReimbursed: 0,
      selbstbehalt: 0,
      breStructure: singleLevelLadder,
      monthlyPremium: 100,
      discountRate: 0,
      claimFreeProbability: 0.7,
      payoutMonth: 7,
      asOf: '2024-07-01',
    });
    expect(result.breakdown.ladderTerms).toHaveLength(1);
    expect(result.breakdown.ladderTerms[0]?.j).toBe(0);
  });

  it('alreadyBroken → NPV=0, no ladder terms (inherited from #140, unaffected by #141)', () => {
    const result = calculateGCP({
      year: 2024,
      erstattungsBetrag: 10_000,
      alreadyReimbursed: 10_000, // fully realised → exceeds S=0 → streak broken
      selbstbehalt: 0,
      breStructure: ladder('2022-01-01'),
      monthlyPremium: 100,
      discountRate: 0.03,
      claimFreeProbability: 0.7,
      payoutMonth: 7,
      asOf: '2024-07-01',
    });
    expect(result.breakdown.alreadyBroken).toBe(true);
    expect(result.breakdown.lostBREValue_NPV).toBe(0);
    expect(result.breakdown.ladderTerms).toHaveLength(0);
  });

  it('multi-year NPV is larger than single-term NPV for p=1', () => {
    const base = {
      year: 2024,
      erstattungsBetrag: 10_000,
      alreadyReimbursed: 0,
      selbstbehalt: 0,
      breStructure: ladder('2023-01-01'), // s=1 → still has recovery transient
      monthlyPremium: 100,
      discountRate: 0.03,
      payoutMonth: 7,
      asOf: '2024-07-01',
    };
    const multi = calculateGCP({ ...base, claimFreeProbability: 1 });
    const single = calculateGCP({ ...base, claimFreeProbability: 0 });
    expect(multi.breakdown.lostBREValue_NPV).toBeGreaterThan(single.breakdown.lostBREValue_NPV);
  });
});

// ---------------------------------------------------------------------------
// calculateBRELadderNPV — the shared, ungated ladder-NPV helper (issue #234)
// ---------------------------------------------------------------------------

describe('calculateBRELadderNPV', () => {
  it('reproduces the design §5.2.5 example independently of any Selbstbehalt: ≈751 €', () => {
    // Same fixture as the calculateGCP §5.2.5 test — the helper computes the loss
    // directly, with no R_Y / deductible gating.
    const { npv, ladderTerms } = calculateBRELadderNPV({
      year: 2024,
      breStructure: ladderDesign525('2022-07-01'), // s=2
      monthlyPremium: 1,
      discountRate: 0.03,
      claimFreeProbability: 0.7,
      payoutMonth: 7,
      asOf: '2024-07-01',
    });
    expect(ladderTerms).toHaveLength(3); // j=0 gap 500, j=1 gap 300, j=2 gap 150
    expect(npv).toBeCloseTo(750.21, 0);
  });

  it('matches calculateGCP.breakdown.lostBREValue_NPV when the year crosses the deductible', () => {
    // The engine and the helper must agree — single source of the ladder math.
    const shared = {
      year: 2024,
      breStructure: ladder('2022-04-01'), // s=2
      monthlyPremium: 100,
      discountRate: 0.03,
      claimFreeProbability: 0.7,
      payoutMonth: 7,
      asOf: '2024-05-01',
    };
    const helper = calculateBRELadderNPV(shared);
    const gcp = calculateGCP({
      ...shared,
      erstattungsBetrag: 10_000, // well above S → crosses the deductible
      alreadyReimbursed: 0,
      selbstbehalt: 500,
    });
    expect(helper.npv).toBe(gcp.breakdown.lostBREValue_NPV);
    expect(helper.ladderTerms).toEqual(gcp.breakdown.ladderTerms);
  });

  it('returns the potential loss even when the engine reports 0 (year under the deductible)', () => {
    // This is exactly why the helper exists: the threshold marker S + NPV must be
    // drawable while the year is still under S, where calculateGCP reports NPV = 0.
    const shared = {
      year: 2024,
      breStructure: ladder('2022-04-01'),
      monthlyPremium: 100,
      discountRate: 0.03,
      claimFreeProbability: 0.7,
      payoutMonth: 7,
      asOf: '2024-05-01',
    };
    const gcpUnder = calculateGCP({
      ...shared,
      erstattungsBetrag: 100,
      alreadyReimbursed: 0,
      selbstbehalt: 500, // R_Y < S → engine NPV = 0
    });
    expect(gcpUnder.breakdown.lostBREValue_NPV).toBe(0);
    expect(calculateBRELadderNPV(shared).npv).toBeGreaterThan(0);
  });

  it('applies the documented defaults for discountRate, claimFreeProbability, payoutMonth', () => {
    const withDefaults = calculateBRELadderNPV({
      year: 2024,
      breStructure: ladder('2022-04-01'),
      monthlyPremium: 100,
      asOf: '2024-05-01',
    });
    const explicit = calculateBRELadderNPV({
      year: 2024,
      breStructure: ladder('2022-04-01'),
      monthlyPremium: 100,
      discountRate: DEFAULT_DISCOUNT_RATE,
      claimFreeProbability: DEFAULT_CLAIM_FREE_PROBABILITY,
      payoutMonth: DEFAULT_PAYOUT_MONTH,
      asOf: '2024-05-01',
    });
    expect(withDefaults).toEqual(explicit);
  });

  it('validates its inputs like the engine', () => {
    const base = {
      year: 2024,
      breStructure: ladder('2022-04-01'),
      monthlyPremium: 100,
      asOf: '2024-05-01',
    };
    expect(() => calculateBRELadderNPV({ ...base, discountRate: -1 })).toThrow(RangeError);
    expect(() => calculateBRELadderNPV({ ...base, claimFreeProbability: 1.1 })).toThrow(RangeError);
    expect(() => calculateBRELadderNPV({ ...base, payoutMonth: 13 })).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Helper used in discounted assertions
// ---------------------------------------------------------------------------

function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

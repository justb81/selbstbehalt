// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import type { IncludedBenefits } from '@selbstbehalt/shared';

import { computeErstattung, type ErstattungInput } from './erstattungs-engine';

/** The KFO benefit verbatim from docs/design.md §3.2. */
const KFO_BENEFITS: IncludedBenefits = {
  benefits: [
    {
      category: 'kieferorthopaedie',
      waiting_period_months: 8,
      beihilfe_satz: 0,
      tiers: [
        { up_to: 500, pct: 100 },
        { up_to: null, pct: 70 },
      ],
      limits: [
        { scope: 'behandlung', max_amount: 3000 },
        { scope: 'jahr', max_amount: null, age_max: 18 },
      ],
      annual_staffel: [
        { policy_year: 1, cumulative_cap: 1000 },
        { policy_year: 2, cumulative_cap: 2000 },
        { policy_year: 5, cumulative_cap: null },
      ],
    },
  ],
};

function input(overrides: Partial<ErstattungInput>): ErstattungInput {
  return {
    positions: [],
    benefits: { benefits: [] },
    invoiceDate: '2030-06-01',
    coverageStart: '2024-01-01',
    ...overrides,
  };
}

describe('computeErstattung — Schwellen-Staffel (tiers)', () => {
  it('splits the §3.2 KFO example into tranches (500 @ 100 %, rest @ 70 %)', () => {
    // coverage long enough that the annual_staffel cap is already unlimited (year ≥ 5).
    const result = computeErstattung(
      input({
        positions: [{ category: 'kieferorthopaedie', chargedAmount: 2000 }],
        benefits: KFO_BENEFITS,
        invoiceDate: '2030-06-01',
        patientAge: 10,
      }),
    );
    // 500 × 100 % + 1500 × 70 % = 1550
    expect(result.eligibleAmount).toBe(1550);
    expect(result.byCategory[0]).toMatchObject({
      category: 'kieferorthopaedie',
      chargedAmount: 2000,
      eligibleAmount: 1550,
      appliedPct: 77.5,
      cappedBy: 'tier',
    });
  });

  it('treats a missing tiers list as 100 % base', () => {
    const result = computeErstattung(
      input({
        positions: [{ category: 'ambulant', chargedAmount: 120 }],
        benefits: { benefits: [{ category: 'ambulant' }] },
      }),
    );
    expect(result.eligibleAmount).toBe(120);
    expect(result.byCategory[0]?.cappedBy).toBeNull();
    expect(result.byCategory[0]?.appliedPct).toBe(100);
  });
});

describe('computeErstattung — Summengrenzen (limits)', () => {
  it('caps the KFO example at the per-treatment limit of 3000 €', () => {
    const result = computeErstattung(
      input({
        positions: [{ category: 'kieferorthopaedie', chargedAmount: 5000 }],
        benefits: KFO_BENEFITS,
        invoiceDate: '2030-06-01',
        patientAge: 10,
      }),
    );
    // tiers: 500 + 4500 × 70 % = 3650, then capped to the behandlung limit 3000.
    expect(result.eligibleAmount).toBe(3000);
    expect(result.byCategory[0]?.cappedBy).toBe('limit');
  });

  it('subtracts prior claims from a per-year limit', () => {
    const benefits: IncludedBenefits = {
      benefits: [{ category: 'heilmittel', limits: [{ scope: 'jahr', max_amount: 600 }] }],
    };
    const result = computeErstattung(
      input({
        positions: [{ category: 'heilmittel', chargedAmount: 500 }],
        benefits,
        priorClaimsByCategory: { heilmittel: 400 },
      }),
    );
    // 600 annual limit − 400 already used = 200 left.
    expect(result.eligibleAmount).toBe(200);
    expect(result.byCategory[0]?.cappedBy).toBe('limit');
  });

  it('applies an age-bound limit only inside the age range', () => {
    const benefits: IncludedBenefits = {
      benefits: [
        {
          category: 'kieferorthopaedie',
          limits: [{ scope: 'behandlung', max_amount: 500, age_max: 12 }],
        },
      ],
    };
    const within = computeErstattung(
      input({
        positions: [{ category: 'kieferorthopaedie', chargedAmount: 800 }],
        benefits,
        patientAge: 10,
      }),
    );
    expect(within.eligibleAmount).toBe(500);
    expect(within.byCategory[0]?.cappedBy).toBe('limit');

    const above = computeErstattung(
      input({
        positions: [{ category: 'kieferorthopaedie', chargedAmount: 800 }],
        benefits,
        patientAge: 30,
      }),
    );
    // Patient out of the age range → the limit does not apply.
    expect(above.eligibleAmount).toBe(800);
    expect(above.byCategory[0]?.cappedBy).toBeNull();
  });

  it('skips an age-bound limit when the patient age is unknown', () => {
    const benefits: IncludedBenefits = {
      benefits: [
        {
          category: 'kieferorthopaedie',
          limits: [{ scope: 'behandlung', max_amount: 500, age_max: 12 }],
        },
      ],
    };
    const result = computeErstattung(
      input({
        positions: [{ category: 'kieferorthopaedie', chargedAmount: 800 }],
        benefits,
      }),
    );
    expect(result.eligibleAmount).toBe(800);
    expect(result.byCategory[0]?.note).toContain('Alter unbekannt');
  });
});

describe('computeErstattung — Aufbaujahres-Staffel (annual_staffel)', () => {
  const ZAHN_BENEFITS: IncludedBenefits = {
    benefits: [
      {
        category: 'zahnersatz',
        tiers: [{ up_to: null, pct: 80 }],
        annual_staffel: [
          { policy_year: 1, cumulative_cap: 1000 },
          { policy_year: 2, cumulative_cap: 2000 },
          { policy_year: 4, cumulative_cap: null },
        ],
      },
    ],
  };

  it('caps at the first policy year cumulative limit', () => {
    const result = computeErstattung(
      input({
        positions: [{ category: 'zahnersatz', chargedAmount: 2000 }],
        benefits: ZAHN_BENEFITS,
        invoiceDate: '2024-06-01', // policy year 1
        coverageStart: '2024-01-01',
      }),
    );
    // tiers 80 % → 1600, capped to the year-1 cumulative limit 1000.
    expect(result.eligibleAmount).toBe(1000);
    expect(result.byCategory[0]?.cappedBy).toBe('annual_staffel');
  });

  it('accounts for prior claims in the cumulative cap', () => {
    const result = computeErstattung(
      input({
        positions: [{ category: 'zahnersatz', chargedAmount: 2000 }],
        benefits: ZAHN_BENEFITS,
        invoiceDate: '2024-06-01',
        coverageStart: '2024-01-01',
        priorClaimsByCategory: { zahnersatz: 800 },
      }),
    );
    // 1000 cap − 800 already used = 200 left.
    expect(result.eligibleAmount).toBe(200);
  });

  it('counts policy years from the coverage anniversary, not the calendar year', () => {
    // Coverage starts mid-year: an invoice the following January is still inside
    // the first policy year (only ~7 months of cover), so the year-1 cap applies.
    const result = computeErstattung(
      input({
        positions: [{ category: 'zahnersatz', chargedAmount: 2000 }],
        benefits: ZAHN_BENEFITS,
        invoiceDate: '2025-01-15', // 7 months after coverage start → policy year 1
        coverageStart: '2024-06-01',
      }),
    );
    // Still policy year 1 → capped to 1000, not the year-2 limit of 2000.
    expect(result.eligibleAmount).toBe(1000);
    expect(result.byCategory[0]?.cappedBy).toBe('annual_staffel');
  });

  it('is unlimited once the staffel reaches its open-ended year', () => {
    const result = computeErstattung(
      input({
        positions: [{ category: 'zahnersatz', chargedAmount: 2000 }],
        benefits: ZAHN_BENEFITS,
        invoiceDate: '2027-06-01', // policy year 4 → cumulative_cap null
        coverageStart: '2024-01-01',
      }),
    );
    // No annual cap → only the 80 % tier applies.
    expect(result.eligibleAmount).toBe(1600);
    expect(result.byCategory[0]?.cappedBy).toBe('tier');
  });
});

describe('computeErstattung — Wartezeit & Beihilfe', () => {
  it('excludes invoices inside the waiting period', () => {
    const result = computeErstattung(
      input({
        positions: [{ category: 'kieferorthopaedie', chargedAmount: 1000 }],
        benefits: KFO_BENEFITS,
        coverageStart: '2024-01-01',
        invoiceDate: '2024-06-01', // < 2024-01-01 + 8 months
        patientAge: 10,
      }),
    );
    expect(result.eligibleAmount).toBe(0);
    expect(result.byCategory[0]?.cappedBy).toBe('waiting_period');
  });

  it('reimburses only the residual quota for a Beihilfe tariff', () => {
    const benefits: IncludedBenefits = {
      benefits: [{ category: 'ambulant', beihilfe_satz: 50, tiers: [{ up_to: null, pct: 100 }] }],
    };
    const result = computeErstattung(
      input({
        positions: [{ category: 'ambulant', chargedAmount: 100 }],
        benefits,
      }),
    );
    expect(result.eligibleAmount).toBe(50);
    expect(result.byCategory[0]?.appliedPct).toBe(50);
    expect(result.byCategory[0]?.cappedBy).toBe('beihilfe');
    expect(result.byCategory[0]?.note).toContain('Beihilfe-Restquote 50 %');
  });

  it('lets a later limit override the Beihilfe cappedBy (last binding rule wins)', () => {
    const benefits: IncludedBenefits = {
      benefits: [
        {
          category: 'ambulant',
          beihilfe_satz: 50,
          tiers: [{ up_to: null, pct: 100 }],
          limits: [{ scope: 'behandlung', max_amount: 30 }],
        },
      ],
    };
    const result = computeErstattung(
      input({
        positions: [{ category: 'ambulant', chargedAmount: 100 }],
        benefits,
      }),
    );
    // 100 → 50 (Beihilfe) → capped at 30 (limit); the limit is the last binder.
    expect(result.eligibleAmount).toBe(30);
    expect(result.byCategory[0]?.cappedBy).toBe('limit');
  });
});

describe('computeErstattung — grouping & totals', () => {
  it('groups positions by category and sums to eligibleAmount', () => {
    const benefits: IncludedBenefits = {
      benefits: [
        { category: 'ambulant', tiers: [{ up_to: null, pct: 100 }] },
        { category: 'zahnersatz', tiers: [{ up_to: null, pct: 80 }] },
      ],
    };
    const result = computeErstattung(
      input({
        positions: [
          { category: 'ambulant', chargedAmount: 60 },
          { category: 'ambulant', chargedAmount: 40 },
          { category: 'zahnersatz', chargedAmount: 200 },
        ],
        benefits,
      }),
    );
    const ambulant = result.byCategory.find((c) => c.category === 'ambulant');
    const zahn = result.byCategory.find((c) => c.category === 'zahnersatz');
    expect(ambulant?.chargedAmount).toBe(100);
    expect(ambulant?.eligibleAmount).toBe(100);
    expect(zahn?.eligibleAmount).toBe(160);
    expect(result.eligibleAmount).toBe(260);
    // The breakdown sums to the total.
    const sum = result.byCategory.reduce((s, c) => s + c.eligibleAmount, 0);
    expect(sum).toBe(result.eligibleAmount);
  });

  it('reimburses nothing for a category without a tariff rule', () => {
    const result = computeErstattung(
      input({
        positions: [{ category: 'hilfsmittel', chargedAmount: 300 }],
        benefits: { benefits: [{ category: 'ambulant', tiers: [{ up_to: null, pct: 100 }] }] },
      }),
    );
    expect(result.eligibleAmount).toBe(0);
    expect(result.byCategory[0]?.note).toContain('Keine Tarifregel');
  });
});

describe('computeErstattung — Auslagenersatz (§10 GOÄ) is always reimbursed at 100 %', () => {
  it('skips tiers/limits/Beihilfe entirely for an auslagenersatz position', () => {
    const result = computeErstattung(
      input({
        positions: [
          { category: 'ambulant', chargedAmount: 2.8, positionCategory: 'auslagenersatz' },
        ],
        // Tariff rule would otherwise cap ambulant heavily — irrelevant here.
        benefits: {
          benefits: [
            { category: 'ambulant', beihilfe_satz: 50, tiers: [{ up_to: null, pct: 20 }] },
          ],
        },
      }),
    );
    expect(result.eligibleAmount).toBe(2.8);
    expect(result.auslagenersatzAmount).toBe(2.8);
    expect(result.byPosition[0]?.eligible_amount).toBe(2.8);
    // No BenefitCategory pipeline ran for it.
    expect(result.byCategory).toHaveLength(0);
  });

  it('is reimbursed even within the Wartezeit and with no tariff rule at all', () => {
    const result = computeErstattung(
      input({
        positions: [
          { category: 'sonstiges', chargedAmount: 1.5, positionCategory: 'auslagenersatz' },
        ],
        benefits: { benefits: [] },
        invoiceDate: '2024-01-15', // inside any waiting period from coverageStart
      }),
    );
    expect(result.eligibleAmount).toBe(1.5);
    expect(result.auslagenersatzAmount).toBe(1.5);
  });

  it('mixes with regular positions: only the auslagenersatz share bypasses the pipeline', () => {
    const result = computeErstattung(
      input({
        positions: [
          { category: 'ambulant', chargedAmount: 100 },
          { category: 'ambulant', chargedAmount: 2.8, positionCategory: 'auslagenersatz' },
        ],
        benefits: { benefits: [{ category: 'ambulant', tiers: [{ up_to: null, pct: 80 }] }] },
      }),
    );
    // 100 × 80 % (regular) + 2.8 × 100 % (Auslagenersatz)
    expect(result.eligibleAmount).toBe(82.8);
    expect(result.auslagenersatzAmount).toBe(2.8);
    expect(result.byPosition[0]?.eligible_amount).toBe(80);
    expect(result.byPosition[1]?.eligible_amount).toBe(2.8);
  });
});

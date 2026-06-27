// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import {
  includedBenefitSchema,
  includedBenefitsSchema,
  type IncludedBenefits,
} from './included-benefits.js';

/** The KFO example verbatim from docs/design.md §3.2. */
const KFO_EXAMPLE: IncludedBenefits = {
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

describe('includedBenefitsSchema', () => {
  it('parses the §3.2 KFO example and exposes it typed', () => {
    const parsed = includedBenefitsSchema.parse(KFO_EXAMPLE);
    const kfo = parsed.benefits[0]!;
    expect(kfo.category).toBe('kieferorthopaedie');
    expect(kfo.tiers?.[1]).toEqual({ up_to: null, pct: 70 });
    expect(kfo.limits?.[1]).toEqual({ scope: 'jahr', max_amount: null, age_max: 18 });
    expect(kfo.annual_staffel?.at(-1)?.cumulative_cap).toBeNull();
  });

  it('accepts a dental build-up ladder (Zahnstaffel)', () => {
    const result = includedBenefitsSchema.safeParse({
      benefits: [
        {
          category: 'zahnersatz',
          tiers: [{ up_to: null, pct: 80 }],
          annual_staffel: [
            { policy_year: 1, cumulative_cap: 1000 },
            { policy_year: 2, cumulative_cap: 2000 },
            { policy_year: 3, cumulative_cap: 3000 },
            { policy_year: 4, cumulative_cap: null },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a Beihilfe residual-quota benefit', () => {
    const result = includedBenefitsSchema.safeParse({
      benefits: [{ category: 'ambulant', beihilfe_satz: 50, tiers: [{ up_to: null, pct: 50 }] }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty benefits list', () => {
    expect(includedBenefitsSchema.safeParse({ benefits: [] }).success).toBe(true);
  });

  it('rejects pct above 100', () => {
    const result = includedBenefitsSchema.safeParse({
      benefits: [{ category: 'ambulant', tiers: [{ up_to: null, pct: 101 }] }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects beihilfe_satz above 100', () => {
    const result = includedBenefitsSchema.safeParse({
      benefits: [{ category: 'ambulant', beihilfe_satz: 120 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative amounts', () => {
    const result = includedBenefitsSchema.safeParse({
      benefits: [{ category: 'ambulant', limits: [{ scope: 'jahr', max_amount: -1 }] }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown category', () => {
    const result = includedBenefitsSchema.safeParse({
      benefits: [{ category: 'wellness', tiers: [{ up_to: null, pct: 100 }] }],
    });
    expect(result.success).toBe(false);
  });
});

describe('includedBenefitSchema tier validation', () => {
  it('rejects tiers without a trailing open-ended (up_to: null) step', () => {
    const result = includedBenefitSchema.safeParse({
      category: 'ambulant',
      tiers: [{ up_to: 500, pct: 100 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an open-ended step that is not last', () => {
    const result = includedBenefitSchema.safeParse({
      category: 'ambulant',
      tiers: [
        { up_to: null, pct: 100 },
        { up_to: 500, pct: 70 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than one open-ended step', () => {
    const result = includedBenefitSchema.safeParse({
      category: 'ambulant',
      tiers: [
        { up_to: null, pct: 100 },
        { up_to: null, pct: 70 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-ascending tier thresholds', () => {
    const result = includedBenefitSchema.safeParse({
      category: 'ambulant',
      tiers: [
        { up_to: 800, pct: 100 },
        { up_to: 500, pct: 90 },
        { up_to: null, pct: 70 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty tiers array', () => {
    const result = includedBenefitSchema.safeParse({ category: 'ambulant', tiers: [] });
    expect(result.success).toBe(false);
  });
});

describe('includedBenefitSchema annual_staffel validation', () => {
  it('rejects non-ascending policy years', () => {
    const result = includedBenefitSchema.safeParse({
      category: 'zahnersatz',
      annual_staffel: [
        { policy_year: 2, cumulative_cap: 1000 },
        { policy_year: 1, cumulative_cap: 2000 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unlimited cap that is not the last entry', () => {
    const result = includedBenefitSchema.safeParse({
      category: 'zahnersatz',
      annual_staffel: [
        { policy_year: 1, cumulative_cap: null },
        { policy_year: 2, cumulative_cap: 2000 },
      ],
    });
    expect(result.success).toBe(false);
  });
});

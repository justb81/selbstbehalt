// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import type { IncludedBenefits } from '../schemas/included-benefits.js';
import { parseIncludedBenefits, serializeIncludedBenefits } from './included-benefits.js';

const SAMPLE: IncludedBenefits = {
  benefits: [
    {
      category: 'ambulant',
      tiers: [
        { up_to: 500, pct: 100 },
        { up_to: null, pct: 80 },
      ],
    },
  ],
};

describe('parseIncludedBenefits', () => {
  it('parses a valid JSON string into a typed structure', () => {
    const parsed = parseIncludedBenefits(JSON.stringify(SAMPLE));
    expect(parsed?.benefits[0]?.category).toBe('ambulant');
  });

  it('returns null for absent/empty input', () => {
    expect(parseIncludedBenefits(null)).toBeNull();
    expect(parseIncludedBenefits(undefined)).toBeNull();
    expect(parseIncludedBenefits('')).toBeNull();
    expect(parseIncludedBenefits('   ')).toBeNull();
  });

  it('throws on malformed JSON', () => {
    expect(() => parseIncludedBenefits('{not json')).toThrow(SyntaxError);
  });

  it('throws a ZodError on schema-invalid JSON', () => {
    expect(() =>
      parseIncludedBenefits('{"benefits":[{"category":"ambulant","beihilfe_satz":200}]}'),
    ).toThrow(ZodError);
  });
});

describe('serializeIncludedBenefits', () => {
  it('round-trips through parse', () => {
    expect(parseIncludedBenefits(serializeIncludedBenefits(SAMPLE))).toEqual(SAMPLE);
  });

  it('throws a ZodError on an invalid structure', () => {
    const bad = {
      benefits: [{ category: 'ambulant', tiers: [{ up_to: 500, pct: 100 }] }],
    } as unknown as IncludedBenefits;
    expect(() => serializeIncludedBenefits(bad)).toThrow(ZodError);
  });
});

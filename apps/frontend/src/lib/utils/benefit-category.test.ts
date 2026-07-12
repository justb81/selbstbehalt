// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import type { AuslagenDerivationPosition } from './auslagen-benefit-category';
import { benefitCategoryForPosition, resolveBenefitCategory } from './benefit-category';

describe('resolveBenefitCategory (save time)', () => {
  it('uses an explicit benefit_category for a fee-schedule position', () => {
    expect(
      resolveBenefitCategory({ goae_category: 'GOÄ', benefit_category: 'ambulant' }, [], 'arzt'),
    ).toBe('ambulant');
  });

  it('an explicit benefit_category (manual override) wins over the Auslagen derivation', () => {
    const honorar: AuslagenDerivationPosition[] = [
      { goaeCategory: 'GOZ', benefitCategory: 'kieferorthopaedie', chargedAmount: 300 },
    ];
    expect(
      resolveBenefitCategory(
        { goae_category: 'Material-/Laborkosten', benefit_category: 'zahnbehandlung' },
        honorar,
        'kieferorthopaede',
      ),
    ).toBe('zahnbehandlung');
  });

  it('falls back to the provider default when a fee-schedule position has no category', () => {
    expect(
      resolveBenefitCategory({ goae_category: 'GOZ', benefit_category: null }, [], 'zahnarzt'),
    ).toBe('zahnbehandlung');
    expect(
      resolveBenefitCategory({ goae_category: 'GOÄ', benefit_category: null }, [], 'sonstiges'),
    ).toBe('sonstiges');
  });

  it('derives Material-/Laborkosten from GOZ honorar dominance', () => {
    const honorar: AuslagenDerivationPosition[] = [
      { goaeCategory: 'GOZ', benefitCategory: 'kieferorthopaedie', chargedAmount: 300 },
      { goaeCategory: 'GOZ', benefitCategory: 'zahnbehandlung', chargedAmount: 100 },
    ];
    expect(
      resolveBenefitCategory(
        { goae_category: 'Material-/Laborkosten', benefit_category: null },
        honorar,
        'kieferorthopaede',
      ),
    ).toBe('kieferorthopaedie');
  });

  it('derives Auslagenersatz from GOÄ honorar, falling back to provider type on no honorar', () => {
    expect(
      resolveBenefitCategory(
        { goae_category: 'Auslagenersatz', benefit_category: null },
        [],
        'arzt',
      ),
    ).toBe('ambulant');
  });
});

describe('benefitCategoryForPosition (refund time)', () => {
  it('uses the persisted benefit_category', () => {
    expect(benefitCategoryForPosition({ benefit_category: 'zahnersatz' }, 'zahnarzt')).toBe(
      'zahnersatz',
    );
  });

  it('falls back to the provider-type mapping for legacy rows without a category', () => {
    expect(benefitCategoryForPosition({ benefit_category: null }, 'kieferorthopaede')).toBe(
      'kieferorthopaedie',
    );
  });

  it('falls back to sonstiges when neither category nor a mapped provider type is known', () => {
    expect(benefitCategoryForPosition({ benefit_category: null }, 'sonstiges')).toBe('sonstiges');
    expect(benefitCategoryForPosition({ benefit_category: null }, null)).toBe('sonstiges');
  });
});

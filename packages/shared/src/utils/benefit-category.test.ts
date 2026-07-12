// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { benefitCategoryValues } from '../enums.js';
import { BENEFIT_CATEGORY_LABELS, defaultBenefitCategoryForProvider } from './benefit-category.js';

describe('defaultBenefitCategoryForProvider', () => {
  it('maps each provider type to its default benefit area', () => {
    expect(defaultBenefitCategoryForProvider('kieferorthopaede')).toBe('kieferorthopaedie');
    expect(defaultBenefitCategoryForProvider('zahnarzt')).toBe('zahnbehandlung');
    expect(defaultBenefitCategoryForProvider('arzt')).toBe('ambulant');
    expect(defaultBenefitCategoryForProvider('krankenhaus')).toBe('stationaer');
  });

  it('falls back to sonstiges for the sonstiges provider type', () => {
    expect(defaultBenefitCategoryForProvider('sonstiges')).toBe('sonstiges');
  });
});

describe('BENEFIT_CATEGORY_LABELS', () => {
  it('has a German label for every benefit category', () => {
    for (const category of benefitCategoryValues) {
      expect(BENEFIT_CATEGORY_LABELS[category]).toBeTruthy();
    }
    expect(BENEFIT_CATEGORY_LABELS.kieferorthopaedie).toBe('Kieferorthopädie');
    expect(BENEFIT_CATEGORY_LABELS.stationaer).toBe('Stationär');
  });
});

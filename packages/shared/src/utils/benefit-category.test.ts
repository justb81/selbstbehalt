// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { benefitCategoryValues, providerTypeValues } from '../enums.js';
import {
  BENEFIT_CATEGORY_LABELS,
  defaultBenefitCategoryForProvider,
  PROVIDER_TYPE_LABELS,
} from './benefit-category.js';

describe('defaultBenefitCategoryForProvider', () => {
  it('maps each provider type to its default benefit area', () => {
    expect(defaultBenefitCategoryForProvider('kieferorthopaede')).toBe('kieferorthopaedie');
    expect(defaultBenefitCategoryForProvider('zahnarzt')).toBe('zahnbehandlung');
    expect(defaultBenefitCategoryForProvider('arzt')).toBe('ambulant');
    expect(defaultBenefitCategoryForProvider('krankenhaus')).toBe('stationaer');
  });

  it('maps the dispensing providers to their own benefit areas', () => {
    // A Sanitätshaus-Beleg must land in `hilfsmittel` so a tariff without a
    // Hilfsmittel-Baustein reimburses nothing for it; Arzneimittel from an Apotheke
    // belong to the ambulante Heilbehandlung.
    expect(defaultBenefitCategoryForProvider('sanitaetshaus')).toBe('hilfsmittel');
    expect(defaultBenefitCategoryForProvider('apotheke')).toBe('ambulant');
  });

  it('falls back to sonstiges for the sonstiges provider type', () => {
    expect(defaultBenefitCategoryForProvider('sonstiges')).toBe('sonstiges');
  });
});

describe('PROVIDER_TYPE_LABELS', () => {
  it('has a German label for every provider type', () => {
    for (const providerType of providerTypeValues) {
      expect(PROVIDER_TYPE_LABELS[providerType]).toBeTruthy();
    }
    expect(PROVIDER_TYPE_LABELS.sanitaetshaus).toBe('Sanitätshaus');
    expect(PROVIDER_TYPE_LABELS.kieferorthopaede).toBe('Kieferorthopäde');
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

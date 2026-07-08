// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import {
  deriveAuslagenBenefitCategory,
  type AuslagenDerivationPosition,
} from './auslagen-benefit-category';

/** A GOZ honorar position with a looked-up benefit category. */
function goz(
  benefitCategory: AuslagenDerivationPosition['benefitCategory'],
  chargedAmount: number,
) {
  return { goaeCategory: 'GOZ', benefitCategory, chargedAmount } as AuslagenDerivationPosition;
}
function goae(
  benefitCategory: AuslagenDerivationPosition['benefitCategory'],
  chargedAmount: number,
) {
  return { goaeCategory: 'GOÄ', benefitCategory, chargedAmount } as AuslagenDerivationPosition;
}

describe('deriveAuslagenBenefitCategory (issue #251)', () => {
  it('picks the amount-weighted dominant category within the same Gebührenordnung', () => {
    // The §251 example: KFO invoice, GOZ honorar ≈ 275 € KFO vs ≈ 104 € Zahnbehandlung.
    const positions = [
      goz('kieferorthopaedie', 200),
      goz('kieferorthopaedie', 75),
      goz('zahnbehandlung', 104),
    ];
    expect(deriveAuslagenBenefitCategory(positions, 'GOZ', 'kieferorthopaede')).toBe(
      'kieferorthopaedie',
    );
  });

  it('is amount-weighted, not count-weighted (many small Ä-positions do not tip it)', () => {
    const positions = [
      goz('zahnersatz', 900),
      goz('zahnbehandlung', 20),
      goz('zahnbehandlung', 20),
      goz('zahnbehandlung', 20),
    ];
    expect(deriveAuslagenBenefitCategory(positions, 'GOZ', 'zahnarzt')).toBe('zahnersatz');
  });

  it('only considers honorar positions of the matching Gebührenordnung', () => {
    // §9-GOZ Auslagen (feeSchedule GOZ): the large GOÄ position is ignored; the
    // only GOZ honorar decides.
    const positions = [goae('ambulant', 1000), goz('zahnersatz', 120)];
    expect(deriveAuslagenBenefitCategory(positions, 'GOZ', 'zahnarzt')).toBe('zahnersatz');
  });

  it('resolves §10-GOÄ Auslagenersatz over the GOÄ positions', () => {
    const positions = [goae('ambulant', 300), goae('stationaer', 50), goz('zahnbehandlung', 999)];
    expect(deriveAuslagenBenefitCategory(positions, 'GOÄ', 'arzt')).toBe('ambulant');
  });

  it('falls back to the provider-type mapping when no honorar position matches', () => {
    expect(deriveAuslagenBenefitCategory([], 'GOZ', 'kieferorthopaede')).toBe('kieferorthopaedie');
    expect(deriveAuslagenBenefitCategory([], 'GOZ', 'zahnarzt')).toBe('zahnbehandlung');
    expect(deriveAuslagenBenefitCategory([], 'GOÄ', 'arzt')).toBe('ambulant');
    expect(deriveAuslagenBenefitCategory([], 'GOÄ', 'krankenhaus')).toBe('stationaer');
  });

  it('falls back to the provider-type mapping on a tie (Gleichstand)', () => {
    const positions = [goz('kieferorthopaedie', 100), goz('zahnbehandlung', 100)];
    expect(deriveAuslagenBenefitCategory(positions, 'GOZ', 'zahnarzt')).toBe('zahnbehandlung');
  });

  it('falls through to sonstiges for an unmapped provider type', () => {
    expect(deriveAuslagenBenefitCategory([], 'GOZ', 'sonstiges')).toBe('sonstiges');
  });

  it('ignores honorar positions without a benefit category', () => {
    const positions = [
      { goaeCategory: 'GOZ', benefitCategory: null, chargedAmount: 5000 },
      goz('zahnersatz', 100),
    ] as AuslagenDerivationPosition[];
    expect(deriveAuslagenBenefitCategory(positions, 'GOZ', 'zahnarzt')).toBe('zahnersatz');
  });
});

// SPDX-License-Identifier: Apache-2.0
import type { BREStructure } from '@selbstbehalt/shared';
import { describe, expect, it } from 'vitest';

import { calculateBRELadderNPV } from './guenstiger-pruefung.js';
import {
  computeSelbstbehaltRadar,
  currentLeistungsjahr,
  type SBRadarInput,
} from './selbstbehalt-radar.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Ladder from design §5.2.5: B(0)=0, B(1)=200, B(2)=350, B(3)=500; nMax=3.
 * With streak start 2022-07-01 and asOf 2024-07-01 → s=2, so the potential NPV is
 * the worked-example ≈750.21 € and the submit threshold is S + 750.21.
 */
function ladder525(currentStreakStart: string | null): BREStructure {
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

function radarInput(overrides: Partial<SBRadarInput> = {}): SBRadarInput {
  return {
    year: 2024,
    R_Y: 300,
    alreadyReimbursed: 0,
    selbstbehalt: 500,
    breStructure: ladder525('2022-07-01'),
    monthlyPremium: 1, // ladder uses fixed_amount_eur → premium is irrelevant
    discountRate: 0.03,
    claimFreeProbability: 0.7,
    payoutMonth: 7,
    asOf: '2024-07-01',
    ...overrides,
  };
}

/** The potential NPV for the shared fixture (≈750.21 €). */
const FIXTURE_NPV = calculateBRELadderNPV({
  year: 2024,
  breStructure: ladder525('2022-07-01'),
  monthlyPremium: 1,
  discountRate: 0.03,
  claimFreeProbability: 0.7,
  payoutMonth: 7,
  asOf: '2024-07-01',
}).npv;

// ---------------------------------------------------------------------------
// currentLeistungsjahr
// ---------------------------------------------------------------------------

describe('currentLeistungsjahr', () => {
  it('returns the calendar year of the injected asOf', () => {
    expect(currentLeistungsjahr('2026-03-15')).toBe(2026);
    expect(currentLeistungsjahr('2024-12-31')).toBe(2024);
  });

  it('parses YYYY-MM-DD as a calendar date (no UTC drift)', () => {
    // 2025-01-01 must stay 2025 regardless of the runner timezone.
    expect(currentLeistungsjahr('2025-01-01')).toBe(2025);
  });
});

// ---------------------------------------------------------------------------
// The four Ampel states
// ---------------------------------------------------------------------------

describe('computeSelbstbehaltRadar — states', () => {
  it('unter_sb when R_Y ≤ S', () => {
    const radar = computeSelbstbehaltRadar(radarInput({ R_Y: 300, selbstbehalt: 500 }));
    expect(radar.state).toBe('unter_sb');
    expect(radar.alreadyBroken).toBe(false);
  });

  it('sb_erreicht_unter_schwelle when S < R_Y ≤ threshold', () => {
    // threshold = 500 + ~750 = ~1250; R_Y = 800 is above S but below the threshold.
    const radar = computeSelbstbehaltRadar(radarInput({ R_Y: 800, selbstbehalt: 500 }));
    expect(radar.state).toBe('sb_erreicht_unter_schwelle');
  });

  it('ueber_schwelle when R_Y > threshold', () => {
    const radar = computeSelbstbehaltRadar(radarInput({ R_Y: 1400, selbstbehalt: 500 }));
    expect(radar.state).toBe('ueber_schwelle');
    expect(radar.restBisEinreichen).toBe(0);
  });

  it('bereits_gebrochen when realised reimbursements exceed S', () => {
    const radar = computeSelbstbehaltRadar(
      radarInput({ R_Y: 900, alreadyReimbursed: 600, selbstbehalt: 500 }),
    );
    expect(radar.state).toBe('bereits_gebrochen');
    expect(radar.alreadyBroken).toBe(true);
    // Streak already gone → no further BRE at stake → threshold collapses to S.
    expect(radar.npvThreshold).toBe(0);
    expect(radar.gcpThreshold).toBe(500);
  });

  it('realised refund exactly at S does not break the streak (strictly greater)', () => {
    const radar = computeSelbstbehaltRadar(
      radarInput({ R_Y: 500, alreadyReimbursed: 500, selbstbehalt: 500 }),
    );
    expect(radar.alreadyBroken).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Threshold, exhaustion and distance figures
// ---------------------------------------------------------------------------

describe('computeSelbstbehaltRadar — figures', () => {
  it('exposes the potential threshold S + NPV even while under the deductible', () => {
    const radar = computeSelbstbehaltRadar(radarInput({ R_Y: 300, selbstbehalt: 500 }));
    // The engine reports 0 NPV under S, but the marker must still be placed.
    expect(radar.gcp?.breakdown.lostBREValue_NPV).toBe(0);
    expect(radar.npvThreshold).toBeCloseTo(FIXTURE_NPV, 2);
    expect(radar.npvThreshold).toBeGreaterThan(0);
    expect(radar.gcpThreshold).toBeCloseTo(500 + FIXTURE_NPV, 2);
  });

  it('computes sbExhaustion as min(R_Y, S)/S, clamped to [0, 1]', () => {
    expect(computeSelbstbehaltRadar(radarInput({ R_Y: 250, selbstbehalt: 500 })).sbExhaustion).toBe(
      0.5,
    );
    expect(
      computeSelbstbehaltRadar(radarInput({ R_Y: 5000, selbstbehalt: 500 })).sbExhaustion,
    ).toBe(1);
    expect(computeSelbstbehaltRadar(radarInput({ R_Y: 0, selbstbehalt: 500 })).sbExhaustion).toBe(
      0,
    );
  });

  it('computes restBisEinreichen as max(0, threshold − R_Y)', () => {
    const radar = computeSelbstbehaltRadar(radarInput({ R_Y: 800, selbstbehalt: 500 }));
    expect(radar.restBisEinreichen).toBeCloseTo(500 + FIXTURE_NPV - 800, 2);
  });

  it('threshold NPV matches the shared engine helper (gemeinsame Quelle)', () => {
    const radar = computeSelbstbehaltRadar(radarInput());
    const expected = calculateBRELadderNPV({
      year: 2024,
      breStructure: ladder525('2022-07-01'),
      monthlyPremium: 1,
      discountRate: 0.03,
      claimFreeProbability: 0.7,
      payoutMonth: 7,
      asOf: '2024-07-01',
    }).npv;
    expect(radar.npvThreshold).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('computeSelbstbehaltRadar — edge cases', () => {
  it('S = 0 → exhaustion is 1 (no division by zero)', () => {
    const radar = computeSelbstbehaltRadar(radarInput({ R_Y: 100, selbstbehalt: 0 }));
    expect(radar.sbExhaustion).toBe(1);
    expect(Number.isFinite(radar.sbExhaustion)).toBe(true);
  });

  it('no BRE ladder → gcp is null, threshold collapses to S', () => {
    const under = computeSelbstbehaltRadar(
      radarInput({ breStructure: null, R_Y: 300, selbstbehalt: 500 }),
    );
    expect(under.gcp).toBeNull();
    expect(under.npvThreshold).toBe(0);
    expect(under.gcpThreshold).toBe(500);
    expect(under.state).toBe('unter_sb');

    const over = computeSelbstbehaltRadar(
      radarInput({ breStructure: null, R_Y: 800, selbstbehalt: 500 }),
    );
    // No BRE to protect → above S is straight to "submit everything".
    expect(over.state).toBe('ueber_schwelle');
  });

  it('empty current year (R_Y = 0) → unter_sb with zero exhaustion', () => {
    const radar = computeSelbstbehaltRadar(radarInput({ R_Y: 0, alreadyReimbursed: 0 }));
    expect(radar.state).toBe('unter_sb');
    expect(radar.sbExhaustion).toBe(0);
    expect(radar.R_Y).toBe(0);
  });

  it('is deterministic for a fixed asOf', () => {
    const a = computeSelbstbehaltRadar(radarInput());
    const b = computeSelbstbehaltRadar(radarInput());
    expect(a).toEqual(b);
  });
});

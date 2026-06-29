// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import type { BREStructure } from '../schemas/insured-person.js';
import {
  getCurrentStreakYears,
  getNextLevel,
  getProjectedBRE,
  projectedBREForStreak,
} from './bre.js';

/** The three-tier ladder from docs/design.md §3.2 (1/2/3 years → 1/2/3 months, 100 %). */
function ladder(currentStreakStart: string | null): BREStructure {
  return {
    type: 'staffel',
    levels: [
      { leistungsfrei_years: 1, bre_months: 1, pct_of_premium: 100 },
      { leistungsfrei_years: 2, bre_months: 2, pct_of_premium: 100 },
      { leistungsfrei_years: 3, bre_months: 3, pct_of_premium: 100 },
    ],
    current_streak_start: currentStreakStart,
  };
}

describe('getCurrentStreakYears', () => {
  it('is zero on the day the streak starts', () => {
    expect(getCurrentStreakYears(ladder('2024-01-01'), '2024-01-01')).toBe(0);
  });

  it('counts completed year anniversaries', () => {
    expect(getCurrentStreakYears(ladder('2024-01-01'), '2025-01-01')).toBe(1);
    expect(getCurrentStreakYears(ladder('2024-01-01'), '2026-01-01')).toBe(2);
    // 2 years, not yet 3 — still building toward the third level.
    expect(getCurrentStreakYears(ladder('2024-01-01'), '2026-12-15')).toBe(2);
  });

  it('only counts a year once the anniversary day is reached', () => {
    // One day short of the first year: still 0.
    expect(getCurrentStreakYears(ladder('2024-01-01'), '2024-12-31')).toBe(0);
    // One day short of the second year: still 1.
    expect(getCurrentStreakYears(ladder('2024-01-01'), '2025-12-31')).toBe(1);
  });

  it('handles multi-year streaks', () => {
    expect(getCurrentStreakYears(ladder('2024-01-01'), '2027-01-01')).toBe(3);
    expect(getCurrentStreakYears(ladder('2024-11-15'), '2025-11-15')).toBe(1);
    expect(getCurrentStreakYears(ladder('2023-12-01'), '2025-12-01')).toBe(2);
  });

  it('returns 0 when there is no active streak', () => {
    expect(getCurrentStreakYears(ladder(null), '2025-01-01')).toBe(0);
    expect(
      getCurrentStreakYears({ ...ladder(null), current_streak_start: undefined }, '2025-01-01'),
    ).toBe(0);
  });

  it('clamps to 0 when asOf precedes the streak start (streak reset edge)', () => {
    expect(getCurrentStreakYears(ladder('2024-06-01'), '2024-01-01')).toBe(0);
  });

  it('throws on a malformed date string', () => {
    expect(() => getCurrentStreakYears(ladder('01.06.2024'), '2024-01-01')).toThrow(RangeError);
    expect(() => getCurrentStreakYears(ladder('2024-01-01'), 'not-a-date')).toThrow(RangeError);
  });

  it('is robust against time-of-day and time zone (reduces to the calendar day)', () => {
    const lateEvening = new Date(2025, 0, 15, 23, 59, 59); // 15 Jan 2025, local
    const earlyMorning = new Date(2025, 0, 15, 0, 0, 1);
    expect(getCurrentStreakYears(ladder('2024-01-01'), lateEvening)).toBe(1);
    expect(getCurrentStreakYears(ladder('2024-01-01'), earlyMorning)).toBe(1);
    // A `Date` and the equivalent `YYYY-MM-DD` string agree.
    expect(getCurrentStreakYears(ladder('2024-01-01'), '2025-01-15')).toBe(1);
  });

  it('accepts a Date instance for the streak start', () => {
    const structure: BREStructure = {
      ...ladder(null),
      current_streak_start: '2022-01-01',
    };
    expect(getCurrentStreakYears(structure, new Date(2025, 0, 1))).toBe(3);
  });

  it('is injectable — omitting asOf does not throw and matches an explicit now', () => {
    const now = new Date();
    expect(getCurrentStreakYears(ladder('2024-01-01'))).toBe(
      getCurrentStreakYears(ladder('2024-01-01'), now),
    );
  });

  it('sorts levels defensively (order of input does not matter)', () => {
    const shuffled: BREStructure = {
      type: 'staffel',
      levels: [
        { leistungsfrei_years: 3, bre_months: 3, pct_of_premium: 100 },
        { leistungsfrei_years: 1, bre_months: 1, pct_of_premium: 100 },
        { leistungsfrei_years: 2, bre_months: 2, pct_of_premium: 100 },
      ],
      current_streak_start: '2024-01-01',
    };
    // Streak math is independent of levels, but projection below relies on order.
    expect(getProjectedBRE(shuffled, 100, '2026-01-01')).toBe(200);
  });
});

describe('getProjectedBRE', () => {
  it('projects the first level before the first threshold is reached', () => {
    // Streak 0 and streak 0 (after 11 months < 1 year) both still aim at the 1-year / 1-premium level.
    expect(getProjectedBRE(ladder('2024-01-01'), 185, '2024-01-01')).toBe(185);
    expect(getProjectedBRE(ladder('2024-01-01'), 185, '2024-12-31')).toBe(185);
  });

  it('returns the refund of each level once its threshold is reached', () => {
    expect(getProjectedBRE(ladder('2024-01-01'), 185, '2025-01-01')).toBe(185); // 1 yr → 1×
    expect(getProjectedBRE(ladder('2024-01-01'), 185, '2026-01-01')).toBe(370); // 2 yr → 2×
    expect(getProjectedBRE(ladder('2024-01-01'), 185, '2027-01-01')).toBe(555); // 3 yr → 3×
  });

  it('caps at the highest level beyond the top threshold', () => {
    expect(getProjectedBRE(ladder('2024-01-01'), 185, '2030-01-01')).toBe(555);
  });

  it('applies pct_of_premium below 100', () => {
    const partial: BREStructure = {
      type: 'staffel',
      levels: [{ leistungsfrei_years: 1, bre_months: 2, pct_of_premium: 50 }],
      current_streak_start: '2024-01-01',
    };
    // 2 × 200 × 50% = 200
    expect(getProjectedBRE(partial, 200, '2025-01-01')).toBe(200);
  });

  it('uses fixed_amount_eur when set, ignoring monthly premium', () => {
    const fixed: BREStructure = {
      type: 'staffel',
      levels: [{ leistungsfrei_years: 1, fixed_amount_eur: 300 }],
      current_streak_start: '2024-01-01',
    };
    // Fixed €300 regardless of monthly premium.
    expect(getProjectedBRE(fixed, 500, '2025-01-01')).toBe(300);
    expect(getProjectedBRE(fixed, 50, '2025-01-01')).toBe(300);
  });

  it('rounds the refund to whole cents', () => {
    const odd: BREStructure = {
      type: 'staffel',
      levels: [{ leistungsfrei_years: 0, bre_months: 1, pct_of_premium: 33.33 }],
      current_streak_start: '2024-01-01',
    };
    // 1 × 100.1 × 33.33% = 33.363330 → 33.36 (rounded to whole cents)
    expect(getProjectedBRE(odd, 100.1, '2024-01-01')).toBe(33.36);
  });
});

describe('projectedBREForStreak', () => {
  it('returns the entitled level refund for a given streak length in years', () => {
    // Streak < 1 year still aims at the first level (1× premium).
    expect(projectedBREForStreak(ladder(null), 185, 0)).toBe(185);
    // Each threshold reached unlocks the next level.
    expect(projectedBREForStreak(ladder(null), 185, 1)).toBe(185);
    expect(projectedBREForStreak(ladder(null), 185, 2)).toBe(370);
    expect(projectedBREForStreak(ladder(null), 185, 3)).toBe(555);
    // Caps at the top level.
    expect(projectedBREForStreak(ladder(null), 185, 10)).toBe(555);
  });

  it('handles fixed_amount_eur levels', () => {
    const fixed: BREStructure = {
      type: 'staffel',
      levels: [{ leistungsfrei_years: 1, fixed_amount_eur: 400 }],
      current_streak_start: null,
    };
    expect(projectedBREForStreak(fixed, 999, 1)).toBe(400);
  });

  it('agrees with getProjectedBRE for the streak it derives from a date', () => {
    const structure = ladder('2024-01-01');
    const streak = getCurrentStreakYears(structure, '2026-01-01'); // 2 years
    expect(projectedBREForStreak(structure, 185, streak)).toBe(
      getProjectedBRE(structure, 185, '2026-01-01'),
    );
  });
});

describe('getNextLevel', () => {
  it('reports the upcoming level and years remaining', () => {
    expect(getNextLevel(ladder('2024-01-01'), '2024-01-01')).toEqual({
      level: { leistungsfrei_years: 1, bre_months: 1, pct_of_premium: 100 },
      yearsRemaining: 1,
    });
    // Streak 0 → one year to the first level.
    expect(getNextLevel(ladder('2024-01-01'), '2024-12-31')).toEqual({
      level: { leistungsfrei_years: 1, bre_months: 1, pct_of_premium: 100 },
      yearsRemaining: 1,
    });
  });

  it('advances to the next milestone once a threshold is reached', () => {
    // At exactly 1 year the member is already entitled; the next goal is 2.
    expect(getNextLevel(ladder('2024-01-01'), '2025-01-01')).toEqual({
      level: { leistungsfrei_years: 2, bre_months: 2, pct_of_premium: 100 },
      yearsRemaining: 1,
    });
    expect(getNextLevel(ladder('2024-01-01'), '2026-01-01')).toEqual({
      level: { leistungsfrei_years: 3, bre_months: 3, pct_of_premium: 100 },
      yearsRemaining: 1,
    });
  });

  it('returns null once the top level is reached', () => {
    expect(getNextLevel(ladder('2024-01-01'), '2027-01-01')).toBeNull();
    expect(getNextLevel(ladder('2024-01-01'), '2030-01-01')).toBeNull();
  });

  it('treats a missing streak as years remaining to the lowest level', () => {
    expect(getNextLevel(ladder(null), '2025-01-01')).toEqual({
      level: { leistungsfrei_years: 1, bre_months: 1, pct_of_premium: 100 },
      yearsRemaining: 1,
    });
  });
});

// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import type { BREStructure } from '../schemas/contract.js';
import { getCurrentStreakMonths, getNextLevel, getProjectedBRE } from './bre.js';

/** The three-tier ladder from docs/design.md §3.2 (12/24/36 months → 1/2/3 months). */
function ladder(currentStreakStart: string | null): BREStructure {
  return {
    type: 'staffel',
    levels: [
      { leistungsfrei_months: 12, bre_months: 1, pct_of_premium: 100 },
      { leistungsfrei_months: 24, bre_months: 2, pct_of_premium: 100 },
      { leistungsfrei_months: 36, bre_months: 3, pct_of_premium: 100 },
    ],
    current_streak_start: currentStreakStart,
  };
}

describe('getCurrentStreakMonths', () => {
  it('is zero on the day the streak starts', () => {
    expect(getCurrentStreakMonths(ladder('2024-01-01'), '2024-01-01')).toBe(0);
  });

  it('counts completed month anniversaries', () => {
    expect(getCurrentStreakMonths(ladder('2024-01-01'), '2024-02-01')).toBe(1);
    expect(getCurrentStreakMonths(ladder('2024-01-01'), '2024-07-01')).toBe(6);
    // 11 months, not yet 12 — matches the §5.3 UI example ("11 Monate").
    expect(getCurrentStreakMonths(ladder('2024-01-01'), '2024-12-15')).toBe(11);
  });

  it('only counts a month once the anniversary day is reached', () => {
    // One day short of the first month: still 0.
    expect(getCurrentStreakMonths(ladder('2024-01-01'), '2024-01-31')).toBe(0);
    // One day short of the twelfth month: still 11.
    expect(getCurrentStreakMonths(ladder('2024-01-01'), '2024-12-31')).toBe(11);
  });

  it('handles the year boundary', () => {
    expect(getCurrentStreakMonths(ladder('2024-01-01'), '2025-01-01')).toBe(12);
    expect(getCurrentStreakMonths(ladder('2024-11-15'), '2025-02-15')).toBe(3);
    expect(getCurrentStreakMonths(ladder('2023-12-01'), '2025-12-01')).toBe(24);
  });

  it('returns 0 when there is no active streak', () => {
    expect(getCurrentStreakMonths(ladder(null), '2025-01-01')).toBe(0);
    expect(
      getCurrentStreakMonths({ ...ladder(null), current_streak_start: undefined }, '2025-01-01'),
    ).toBe(0);
  });

  it('clamps to 0 when asOf precedes the streak start (streak reset edge)', () => {
    expect(getCurrentStreakMonths(ladder('2024-06-01'), '2024-01-01')).toBe(0);
  });

  it('throws on a malformed date string', () => {
    expect(() => getCurrentStreakMonths(ladder('01.06.2024'), '2024-01-01')).toThrow(RangeError);
    expect(() => getCurrentStreakMonths(ladder('2024-01-01'), 'not-a-date')).toThrow(RangeError);
  });

  it('is robust against time-of-day and time zone (reduces to the calendar day)', () => {
    const lateEvening = new Date(2024, 11, 15, 23, 59, 59); // 15 Dec 2024, local
    const earlyMorning = new Date(2024, 11, 15, 0, 0, 1);
    expect(getCurrentStreakMonths(ladder('2024-01-01'), lateEvening)).toBe(11);
    expect(getCurrentStreakMonths(ladder('2024-01-01'), earlyMorning)).toBe(11);
    // A `Date` and the equivalent `YYYY-MM-DD` string agree.
    expect(getCurrentStreakMonths(ladder('2024-01-01'), '2024-12-15')).toBe(11);
  });

  it('accepts a Date instance for the streak start', () => {
    const structure: BREStructure = {
      ...ladder(null),
      // The schema stores ISO strings, but the helper must also accept Dates.
      current_streak_start: '2024-01-01',
    };
    expect(getCurrentStreakMonths(structure, new Date(2024, 5, 1))).toBe(5);
  });

  it('is injectable — omitting asOf does not throw and matches an explicit now', () => {
    const now = new Date();
    expect(getCurrentStreakMonths(ladder('2024-01-01'))).toBe(
      getCurrentStreakMonths(ladder('2024-01-01'), now),
    );
  });

  it('sorts levels defensively (order of input does not matter)', () => {
    const shuffled: BREStructure = {
      type: 'staffel',
      levels: [
        { leistungsfrei_months: 36, bre_months: 3, pct_of_premium: 100 },
        { leistungsfrei_months: 12, bre_months: 1, pct_of_premium: 100 },
        { leistungsfrei_months: 24, bre_months: 2, pct_of_premium: 100 },
      ],
      current_streak_start: '2024-01-01',
    };
    // Streak math is independent of levels, but projection below relies on order.
    expect(getProjectedBRE(shuffled, 100, '2026-01-01')).toBe(200);
  });
});

describe('getProjectedBRE', () => {
  it('projects the first level before the first threshold is reached', () => {
    // Streak 0 and streak 11 both still aim at the 12-month / 1-premium level.
    expect(getProjectedBRE(ladder('2024-01-01'), 185, '2024-01-01')).toBe(185);
    expect(getProjectedBRE(ladder('2024-01-01'), 185, '2024-12-15')).toBe(185);
  });

  it('returns the refund of each level once its threshold is reached', () => {
    expect(getProjectedBRE(ladder('2024-01-01'), 185, '2025-01-01')).toBe(185); // 12 mo → 1×
    expect(getProjectedBRE(ladder('2024-01-01'), 185, '2026-01-01')).toBe(370); // 24 mo → 2×
    expect(getProjectedBRE(ladder('2024-01-01'), 185, '2027-01-01')).toBe(555); // 36 mo → 3×
  });

  it('caps at the highest level beyond the top threshold', () => {
    expect(getProjectedBRE(ladder('2024-01-01'), 185, '2030-01-01')).toBe(555);
  });

  it('applies pct_of_premium below 100', () => {
    const partial: BREStructure = {
      type: 'staffel',
      levels: [{ leistungsfrei_months: 12, bre_months: 2, pct_of_premium: 50 }],
      current_streak_start: '2024-01-01',
    };
    // 2 × 200 × 50% = 200
    expect(getProjectedBRE(partial, 200, '2025-01-01')).toBe(200);
  });

  it('rounds the refund to whole cents', () => {
    const odd: BREStructure = {
      type: 'staffel',
      levels: [{ leistungsfrei_months: 0, bre_months: 1, pct_of_premium: 33.33 }],
      current_streak_start: '2024-01-01',
    };
    // 1 × 100.1 × 33.33% = 33.363330 → 33.36 (rounded to whole cents)
    expect(getProjectedBRE(odd, 100.1, '2024-01-01')).toBe(33.36);
  });
});

describe('getNextLevel', () => {
  it('reports the upcoming level and months remaining', () => {
    expect(getNextLevel(ladder('2024-01-01'), '2024-01-01')).toEqual({
      level: { leistungsfrei_months: 12, bre_months: 1, pct_of_premium: 100 },
      monthsRemaining: 12,
    });
    // Streak 11 → one month to the first level.
    expect(getNextLevel(ladder('2024-01-01'), '2024-12-15')).toEqual({
      level: { leistungsfrei_months: 12, bre_months: 1, pct_of_premium: 100 },
      monthsRemaining: 1,
    });
  });

  it('advances to the next milestone once a threshold is reached', () => {
    // At exactly 12 months the member is already entitled; the next goal is 24.
    expect(getNextLevel(ladder('2024-01-01'), '2025-01-01')).toEqual({
      level: { leistungsfrei_months: 24, bre_months: 2, pct_of_premium: 100 },
      monthsRemaining: 12,
    });
    expect(getNextLevel(ladder('2024-01-01'), '2026-01-01')).toEqual({
      level: { leistungsfrei_months: 36, bre_months: 3, pct_of_premium: 100 },
      monthsRemaining: 12,
    });
  });

  it('returns null once the top level is reached', () => {
    expect(getNextLevel(ladder('2024-01-01'), '2027-01-01')).toBeNull();
    expect(getNextLevel(ladder('2024-01-01'), '2030-01-01')).toBeNull();
  });

  it('treats a missing streak as months remaining to the lowest level', () => {
    expect(getNextLevel(ladder(null), '2025-01-01')).toEqual({
      level: { leistungsfrei_months: 12, bre_months: 1, pct_of_premium: 100 },
      monthsRemaining: 12,
    });
  });
});

// SPDX-License-Identifier: Apache-2.0
//
// BRE-Helfer — pure, deterministic helpers around the premium-refund
// (Beitragsrückerstattung) ladder. See docs/design.md §3.2 (`bre_structure`
// JSON) and §5.2 (`getCurrentStreakYears`, `getProjectedBRE`).
//
// These functions are reused by the Günstigerprüfung (#18), the Stats API
// (#13) and the BRETracker UI (#20), so they live in @selbstbehalt/shared.
//
// Design rules (issue #17 acceptance criteria):
//   - Pure & deterministic: the reference date is always injectable via `asOf`;
//     there is no hidden `Date.now()` baked into the core math.
//   - Robust against time zones and year boundaries: every input is reduced to
//     a calendar day (year/month/day) and compared at local midnight, so the
//     time component and the running time zone never shift the result.

import { differenceInYears } from 'date-fns';

import type { BRELevel, BREStructure } from '../schemas/insured-person.js';
import { roundCents } from './money.js';

/** A calendar day, accepted either as a `Date` or a `YYYY-MM-DD` string. */
export type DateInput = Date | string;

/**
 * Reduce any accepted date input to a `Date` at **local midnight** of that
 * calendar day. A `YYYY-MM-DD` string is read as a calendar date (never as a
 * UTC instant, which `new Date('2024-01-01')` would do), and a `Date` is
 * stripped of its time-of-day. This makes year math depend only on the
 * calendar day, independent of time zone and time of day.
 */
export function toCalendarDate(value: DateInput): Date {
  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (!match) {
      throw new RangeError(`Ungültiges Datum: "${value}" (erwartet JJJJ-MM-TT)`);
    }
    const [, year, month, day] = match;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

/** Levels sorted by their `claim_free_years` threshold, ascending. */
function sortedLevels(breStructure: BREStructure): BRELevel[] {
  return [...breStructure.levels].sort((a, b) => a.claim_free_years - b.claim_free_years);
}

/**
 * Whole claim-free **calendar years** elapsed since `current_streak_start`,
 * counted as completed year anniversaries (same semantics as date-fns
 * `differenceInYears`): a streak that started on Jan 1 reaches "1 year" only
 * once the first anniversary has fully passed.
 *
 * Returns `0` when there is no active streak (`current_streak_start` is
 * null/undefined) or when `asOf` precedes the streak start.
 *
 * @param breStructure the contract's BRE ladder
 * @param asOf reference day; defaults to today. Pass an explicit value in tests
 *   for deterministic results — there is no hidden `Date.now()` in the math.
 */
export function getCurrentStreakYears(
  breStructure: BREStructure,
  asOf: DateInput = new Date(),
): number {
  const start = breStructure.current_streak_start;
  if (!start) return 0;

  const years = differenceInYears(toCalendarDate(asOf), toCalendarDate(start));
  return Math.max(0, years);
}

/**
 * Compute the EUR refund a level yields for a given monthly premium.
 * - Percentage mode: `bre_years × monthlyPremium × pct_of_premium / 100`
 * - Fixed-amount mode: `fixed_amount_eur` (ignores monthlyPremium)
 */
function levelAmount(level: BRELevel, monthlyPremium: number): number {
  if (level.fixed_amount_eur !== undefined) {
    return roundCents(level.fixed_amount_eur);
  }
  return roundCents((level.bre_years ?? 0) * monthlyPremium * ((level.pct_of_premium ?? 0) / 100));
}

/**
 * The staffel level a streak currently entitles the member to: the **highest**
 * level whose `claim_free_years` threshold the streak has reached. Until the
 * first threshold is met, the lowest level applies — it is the refund being
 * built toward (and the one at stake in the Günstigerprüfung).
 */
function entitledLevel(breStructure: BREStructure, streakYears: number): BRELevel {
  const levels = sortedLevels(breStructure);
  // `levels` is non-empty (schema enforces `.min(1)`), so `[0]` is defined.
  let applicable = levels[0]!;
  for (const level of levels) {
    if (streakYears >= level.claim_free_years) {
      applicable = level;
    }
  }
  return applicable;
}

/**
 * Projected annual premium refund (in EUR) for a given number of claim-free
 * years — the refund of the {@link entitledLevel} that streak entitles to, at
 * the given monthly premium. Use this when the streak length is already known
 * (e.g. the per-year `bre_periods.streak_years` in the Stats API, #13) instead
 * of deriving it from a reference date.
 */
export function projectedBREForStreak(
  breStructure: BREStructure,
  monthlyPremium: number,
  streakYears: number,
): number {
  return levelAmount(entitledLevel(breStructure, streakYears), monthlyPremium);
}

/**
 * Projected annual premium refund (in EUR) the member is on track to earn for
 * their current claim-free streak — the refund of the {@link entitledLevel} at
 * the given monthly premium. This is the value forfeited if the streak is reset
 * to zero ("worst case" in the Günstigerprüfung, design §5.2).
 *
 * @param asOf reference day for the underlying streak calculation; injectable.
 */
export function getProjectedBRE(
  breStructure: BREStructure,
  monthlyPremium: number,
  asOf: DateInput = new Date(),
): number {
  return projectedBREForStreak(
    breStructure,
    monthlyPremium,
    getCurrentStreakYears(breStructure, asOf),
  );
}

/** The upcoming staffel level and how many claim-free years remain to reach it. */
export interface NextLevel {
  /** The next, not-yet-reached level on the ladder. */
  level: BRELevel;
  /** Whole years still to go before its `claim_free_years` threshold. */
  yearsRemaining: number;
}

/**
 * The next staffel level above the current streak and the years left to reach
 * it — the lowest level whose `claim_free_years` strictly exceeds the
 * current streak. Returns `null` once the streak has reached the top level (no
 * further milestone to climb to).
 *
 * @param asOf reference day for the underlying streak calculation; injectable.
 */
export function getNextLevel(
  breStructure: BREStructure,
  asOf: DateInput = new Date(),
): NextLevel | null {
  const streak = getCurrentStreakYears(breStructure, asOf);
  const next = sortedLevels(breStructure).find((level) => level.claim_free_years > streak);
  if (!next) return null;
  return { level: next, yearsRemaining: next.claim_free_years - streak };
}

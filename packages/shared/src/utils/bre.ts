// SPDX-License-Identifier: Apache-2.0
//
// BRE-Helfer — pure, deterministic helpers around the premium-refund
// (Beitragsrückerstattung) ladder. See docs/design.md §3.2 (`bre_structure`
// JSON) and §5.2 (`getCurrentStreakMonths`, `getProjectedBRE`).
//
// These functions are reused by the Günstigerprüfung (#18), the Stats API
// (#13) and the BRETracker UI (#20), so they live in @selbstbehalt/shared.
//
// Design rules (issue #17 acceptance criteria):
//   - Pure & deterministic: the reference date is always injectable via `asOf`;
//     there is no hidden `Date.now()` baked into the core math.
//   - Robust against time zones and month boundaries: every input is reduced to
//     a calendar day (year/month/day) and compared at local midnight, so the
//     time component and the running time zone never shift the result.

import { differenceInMonths } from 'date-fns';

import type { BRELevel, BREStructure } from '../schemas/insured-person.js';

/** A calendar day, accepted either as a `Date` or a `YYYY-MM-DD` string. */
export type DateInput = Date | string;

/**
 * Reduce any accepted date input to a `Date` at **local midnight** of that
 * calendar day. A `YYYY-MM-DD` string is read as a calendar date (never as a
 * UTC instant, which `new Date('2024-01-01')` would do), and a `Date` is
 * stripped of its time-of-day. This makes month math depend only on the
 * calendar day, independent of time zone and time of day.
 */
function toCalendarDate(value: DateInput): Date {
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

/** Levels sorted by their `leistungsfrei_months` threshold, ascending. */
function sortedLevels(breStructure: BREStructure): BRELevel[] {
  return [...breStructure.levels].sort((a, b) => a.leistungsfrei_months - b.leistungsfrei_months);
}

/**
 * Whole claim-free months elapsed since `current_streak_start`, counted as
 * completed month anniversaries (same semantics as date-fns `differenceInMonths`):
 * a streak that started on the 1st reaches "11 months" only once the 11th
 * monthly anniversary has fully passed.
 *
 * Returns `0` when there is no active streak (`current_streak_start` is
 * null/undefined) or when `asOf` precedes the streak start.
 *
 * @param breStructure the contract's BRE ladder
 * @param asOf reference day; defaults to today. Pass an explicit value in tests
 *   for deterministic results — there is no hidden `Date.now()` in the math.
 */
export function getCurrentStreakMonths(
  breStructure: BREStructure,
  asOf: DateInput = new Date(),
): number {
  const start = breStructure.current_streak_start;
  if (!start) return 0;

  const months = differenceInMonths(toCalendarDate(asOf), toCalendarDate(start));
  return Math.max(0, months);
}

/**
 * Compute the EUR refund a level yields for a given monthly premium:
 * `bre_months × monthlyPremium × pct_of_premium / 100`, rounded to whole cents.
 */
function levelAmount(level: BRELevel, monthlyPremium: number): number {
  const amount = level.bre_months * monthlyPremium * (level.pct_of_premium / 100);
  return Math.round(amount * 100) / 100;
}

/**
 * The staffel level a streak currently entitles the member to: the **highest**
 * level whose `leistungsfrei_months` threshold the streak has reached. Until the
 * first threshold is met, the lowest level applies — it is the refund being
 * built toward (and the one at stake in the Günstigerprüfung).
 */
function entitledLevel(breStructure: BREStructure, streakMonths: number): BRELevel {
  const levels = sortedLevels(breStructure);
  // `levels` is non-empty (schema enforces `.min(1)`), so `[0]` is defined.
  let applicable = levels[0]!;
  for (const level of levels) {
    if (streakMonths >= level.leistungsfrei_months) {
      applicable = level;
    }
  }
  return applicable;
}

/**
 * Projected annual premium refund (in EUR) for a given number of claim-free
 * months — the refund of the {@link entitledLevel} that streak entitles to, at
 * the given monthly premium. Use this when the streak length is already known
 * (e.g. the per-year `bre_periods.streak_months` in the Stats API, #13) instead
 * of deriving it from a reference date.
 */
export function projectedBREForStreak(
  breStructure: BREStructure,
  monthlyPremium: number,
  streakMonths: number,
): number {
  return levelAmount(entitledLevel(breStructure, streakMonths), monthlyPremium);
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
    getCurrentStreakMonths(breStructure, asOf),
  );
}

/** The upcoming staffel level and how many claim-free months remain to reach it. */
export interface NextLevel {
  /** The next, not-yet-reached level on the ladder. */
  level: BRELevel;
  /** Whole months still to go before its `leistungsfrei_months` threshold. */
  monthsRemaining: number;
}

/**
 * The next staffel level above the current streak and the months left to reach
 * it — the lowest level whose `leistungsfrei_months` strictly exceeds the
 * current streak. Returns `null` once the streak has reached the top level (no
 * further milestone to climb to).
 *
 * @param asOf reference day for the underlying streak calculation; injectable.
 */
export function getNextLevel(
  breStructure: BREStructure,
  asOf: DateInput = new Date(),
): NextLevel | null {
  const streak = getCurrentStreakMonths(breStructure, asOf);
  const next = sortedLevels(breStructure).find((level) => level.leistungsfrei_months > streak);
  if (!next) return null;
  return { level: next, monthsRemaining: next.leistungsfrei_months - streak };
}

// SPDX-License-Identifier: Apache-2.0
/**
 * Erstattungs-Engine — turns the tariff-specific `included_benefits` of an
 * insured person plus the checked invoice positions into the concrete
 * reimbursable amount `R` (`eligible_amount`). It closes the gap between the
 * GOÄ parser (#16) and the Günstigerprüfung (#18, which takes `R` as given).
 *
 * One input per design §5.1. Pure and deterministic — both the invoice date and
 * the coverage start are injected, so there is no hidden `Date.now()` and
 * results are fully reproducible in tests.
 *
 * ## Per-category pipeline (design §5.1)
 *
 * Positions are grouped by their {@link BenefitCategory}; for each group the
 * matching `included_benefits` block is applied in order:
 *
 *  1. **Wartezeit** — invoice before `coverageStart + waiting_period_months` ⇒
 *     nothing reimbursable (`cappedBy: 'waiting_period'`).
 *  2. **Schwellen-Staffel (`tiers`)** — split the amount into tranches along the
 *     `up_to` thresholds, reimburse each at its `pct`. No `tiers` ⇒ 100 % base.
 *  3. **Beihilfe** — with `beihilfe_satz > 0` the tariff only covers the residual
 *     quota `100 % − beihilfe_satz` (the Beihilfe carries the rest separately).
 *  4. **Summengrenzen (`limits`)** — cap per `behandlung` / `jahr` /
 *     `lebenslang`, optionally age-bound.
 *  5. **Aufbaujahres-Staffel (`annual_staffel`)** — cap at the cumulative limit
 *     of the relevant policy year, net of `priorClaimsByCategory`.
 *
 * The result's `eligibleAmount` feeds the Günstigerprüfung as `erstattungsBetrag`
 * (= `R`); the `byCategory` breakdown explains how each category got there.
 */

import { addMonths, differenceInYears, isBefore } from 'date-fns';
import type {
  AnnualStaffelEntry,
  BenefitCategory,
  BenefitLimit,
  BenefitTier,
  DateInput,
  IncludedBenefit,
  IncludedBenefits,
} from '@selbstbehalt/shared';

/** A single invoice position reduced to what the engine needs. */
export interface ErstattungPosition {
  /**
   * Benefit area this position falls into — `ParsedPosition.benefitCategory`
   * from the fee schedule, after any ambulant→stationär context override the
   * caller applies (the table only knows the schedule-derivable default).
   */
  category: BenefitCategory;
  /** Amount billed for this position in EUR (`ParsedPosition.chargedAmount`). */
  chargedAmount: number;
}

/** Inputs for {@link computeErstattung}. Mirrors `ErstattungInput` in design §5.1. */
export interface ErstattungInput {
  /** Checked invoice positions (from the GOÄ parser). */
  positions: ErstattungPosition[];
  /** The insured person's tariff rules (`insured_persons.included_benefits`). */
  benefits: IncludedBenefits;
  /** Invoice date — drives the waiting-period and policy-year checks. */
  invoiceDate: DateInput;
  /** Start of the person's cover (`insured_persons.start_date`). */
  coverageStart: DateInput;
  /**
   * Patient age in years at the invoice date, for age-bound `limits`. When
   * absent, age-bound limits cannot be evaluated and are skipped (a note records
   * it); limits without age bounds always apply.
   */
  patientAge?: number;
  /**
   * Already-used volume per category in EUR — consumed by the `jahr` /
   * `lebenslang` limits and the `annual_staffel` cumulative cap. Defaults to 0.
   */
  priorClaimsByCategory?: Partial<Record<BenefitCategory, number>>;
}

/** Which rule, if any, bound a category's reimbursement (design §5.1). */
export type CappedBy = 'tier' | 'limit' | 'annual_staffel' | 'waiting_period' | null;

/** Per-category reimbursement breakdown — sums to {@link ErstattungResult.eligibleAmount}. */
export interface ErstattungByCategory {
  category: BenefitCategory;
  /** Sum of the charged amounts of this category's positions. */
  chargedAmount: number;
  /** Reimbursable amount for this category in EUR. */
  eligibleAmount: number;
  /** Effective reimbursement rate (`eligibleAmount / chargedAmount × 100`). */
  appliedPct: number;
  /** The binding constraint, or `null` when nothing reduced the amount. */
  cappedBy: CappedBy;
  /** Human-readable explanation for the UI. */
  note?: string;
}

/** Output of {@link computeErstattung}. Mirrors `ErstattungResult` in design §5.1. */
export interface ErstattungResult {
  /** `R` — the total reimbursable amount in EUR. */
  eligibleAmount: number;
  byCategory: ErstattungByCategory[];
}

/** Round to whole cents (mirrors the `money` schema's 2-decimal rule). */
function round2(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/** Reduce a `Date` or `YYYY-MM-DD` string to a `Date` at local midnight. */
function toDate(value: DateInput): Date {
  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (!match) throw new RangeError(`Ungültiges Datum: "${value}" (erwartet JJJJ-MM-TT)`);
    const [, y, m, d] = match;
    return new Date(Number(y), Number(m) - 1, Number(d));
  }
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

/**
 * Reimburse `amount` along an ascending threshold ladder: each tranche
 * `(lower, up_to]` at its `pct`, the open-ended final tier (`up_to: null`) for
 * everything above. The schema guarantees the ladder is well-formed.
 */
function applyTiers(amount: number, tiers: BenefitTier[]): number {
  let eligible = 0;
  let lower = 0;
  for (const tier of tiers) {
    if (amount <= lower) break;
    const upper = tier.up_to ?? Number.POSITIVE_INFINITY;
    const band = Math.min(amount, upper) - lower;
    eligible += band * (tier.pct / 100);
    lower = upper;
  }
  return eligible;
}

/** Whether an age-bound `limit` applies to the given patient age. */
function limitAppliesToAge(limit: BenefitLimit, patientAge: number | undefined): boolean {
  if (limit.age_min === undefined && limit.age_max === undefined) return true;
  if (patientAge === undefined) return false; // age-bound but no age known → skip
  if (limit.age_min !== undefined && patientAge < limit.age_min) return false;
  if (limit.age_max !== undefined && patientAge > limit.age_max) return false;
  return true;
}

/**
 * The cumulative cap that applies in `policyYear`: the highest staffel entry
 * whose `policy_year` the year has reached (entries are ascending). Below the
 * first entry the earliest (most restrictive) cap applies. `null` = unlimited.
 */
function annualCap(staffel: AnnualStaffelEntry[], policyYear: number): number | null {
  let applicable = staffel[0];
  for (const entry of staffel) {
    if (policyYear >= entry.policy_year) applicable = entry;
  }
  return applicable ? applicable.cumulative_cap : null;
}

/** Apply the full §5.1 pipeline to one category group. */
function computeCategory(
  category: BenefitCategory,
  chargedAmount: number,
  benefit: IncludedBenefit | undefined,
  input: ErstattungInput,
): ErstattungByCategory {
  const base = (eligible: number, cappedBy: CappedBy, note?: string): ErstattungByCategory => ({
    category,
    chargedAmount: round2(chargedAmount),
    eligibleAmount: round2(Math.max(0, eligible)),
    appliedPct: chargedAmount > 0 ? round2((Math.max(0, eligible) / chargedAmount) * 100) : 0,
    cappedBy,
    note,
  });

  // No tariff rule for this category → not a covered benefit.
  if (!benefit) {
    return base(0, null, `Keine Tarifregel für „${category}" — nicht erstattungsfähig.`);
  }

  // 1. Wartezeit.
  const waiting = benefit.waiting_period_months ?? 0;
  if (waiting > 0) {
    const waitingEnds = addMonths(toDate(input.coverageStart), waiting);
    if (isBefore(toDate(input.invoiceDate), waitingEnds)) {
      return base(0, 'waiting_period', `Innerhalb der Wartezeit von ${waiting} Monaten.`);
    }
  }

  // 2. Schwellen-Staffel (no tiers ⇒ 100 % base).
  let eligible = benefit.tiers ? applyTiers(chargedAmount, benefit.tiers) : chargedAmount;
  let cappedBy: CappedBy = benefit.tiers && eligible < chargedAmount ? 'tier' : null;
  const notes: string[] = [];
  if (cappedBy === 'tier') notes.push('gestaffelt nach Schwellenwerten');

  // 3. Beihilfe — tariff covers only the residual quota.
  if (benefit.beihilfe_satz && benefit.beihilfe_satz > 0) {
    eligible *= (100 - benefit.beihilfe_satz) / 100;
    notes.push(`Beihilfe-Restquote ${100 - benefit.beihilfe_satz} %`);
  }

  // 4. Summengrenzen.
  if (benefit.limits) {
    const prior = input.priorClaimsByCategory?.[category] ?? 0;
    for (const limit of benefit.limits) {
      if (limit.max_amount === null) continue; // unlimited carve-out
      if (!limitAppliesToAge(limit, input.patientAge)) {
        const ageBound = limit.age_min !== undefined || limit.age_max !== undefined;
        if (ageBound && input.patientAge === undefined) {
          notes.push('altersabhängige Grenze übersprungen (Alter unbekannt)');
        }
        continue;
      }
      // behandlung = per case (this invoice); jahr/lebenslang net of prior claims.
      const available = limit.scope === 'behandlung' ? limit.max_amount : limit.max_amount - prior;
      if (eligible > available) {
        eligible = available;
        cappedBy = 'limit';
        notes.push(`gedeckelt auf ${available} € (${limit.scope})`);
      }
    }
  }

  // 5. Aufbaujahres-Staffel.
  if (benefit.annual_staffel && benefit.annual_staffel.length) {
    // Policy years run from the coverage anniversary, not the calendar year, so
    // count completed anniversary years (differenceInYears), not year boundaries
    // crossed (differenceInCalendarYears, which would jump on every 1 January).
    const policyYear =
      differenceInYears(toDate(input.invoiceDate), toDate(input.coverageStart)) + 1;
    const cap = annualCap(benefit.annual_staffel, policyYear);
    if (cap !== null) {
      const prior = input.priorClaimsByCategory?.[category] ?? 0;
      const available = cap - prior;
      if (eligible > available) {
        eligible = available;
        cappedBy = 'annual_staffel';
        notes.push(`Aufbaujahr ${policyYear}: kumuliertes Limit ${cap} €`);
      }
    }
  }

  return base(eligible, cappedBy, notes.length ? notes.join('; ') : undefined);
}

/**
 * Compute the reimbursable amount `R` from a tariff's `included_benefits` and the
 * checked invoice positions (design §5.1). Positions are grouped by
 * {@link BenefitCategory}; each group runs the five-step pipeline. The returned
 * `eligibleAmount` is the input to the Günstigerprüfung (`erstattungsBetrag`).
 */
export function computeErstattung(input: ErstattungInput): ErstattungResult {
  // Sum charged amounts per category, preserving first-seen order.
  const grouped = new Map<BenefitCategory, number>();
  for (const position of input.positions) {
    grouped.set(position.category, (grouped.get(position.category) ?? 0) + position.chargedAmount);
  }

  const byCategory: ErstattungByCategory[] = [];
  for (const [category, charged] of grouped) {
    const benefit = input.benefits.benefits.find((b) => b.category === category);
    byCategory.push(computeCategory(category, charged, benefit, input));
  }

  const eligibleAmount = round2(byCategory.reduce((sum, c) => sum + c.eligibleAmount, 0));
  return { eligibleAmount, byCategory };
}

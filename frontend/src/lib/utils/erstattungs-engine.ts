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
import {
  roundCents,
  toCalendarDate,
  type AnnualStaffelEntry,
  type BenefitCategory,
  type BenefitLimit,
  type BenefitTier,
  type DateInput,
  type IncludedBenefit,
  type IncludedBenefits,
  type PositionCategory,
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
  /**
   * Leistungsdatum (ISO YYYY-MM-DD) for this position. When set, it is used
   * for the waiting-period check in place of `ErstattungInput.invoiceDate`,
   * enabling correct per-position treatment across different Leistungsjahre
   * (§2.3, Issue #139).
   */
  treatmentDate?: DateInput;
  /**
   * Funktionale Art der Position. `auslagenersatz` (§10 GOÄ, z. B. Porto-/
   * Versandkosten) skips the whole `category` pipeline below — it is always
   * reimbursed at 100 % of `chargedAmount`, regardless of tariff tiers,
   * Wartezeit, Beihilfe-Quote or Summengrenzen. Defaults to `leistung`.
   */
  positionCategory?: PositionCategory;
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
export type CappedBy = 'tier' | 'beihilfe' | 'limit' | 'annual_staffel' | 'waiting_period' | null;

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

/** Per-position reimbursable amount, derived by proportional distribution within each category. */
export interface ErstattungByPosition {
  /** Index of the position in the input {@link ErstattungInput.positions} array. */
  index: number;
  /** Reimbursable amount for this position in EUR. */
  eligible_amount: number;
}

/** Output of {@link computeErstattung}. Mirrors `ErstattungResult` in design §5.1. */
export interface ErstattungResult {
  /** `R` — the total reimbursable amount in EUR. */
  eligibleAmount: number;
  byCategory: ErstattungByCategory[];
  /**
   * Per-position eligible amounts, proportionally distributed from `byCategory`.
   * Positions blocked by a waiting period receive `eligible_amount = 0`.
   * Auslagenersatz positions (§10 GOÄ) receive `eligible_amount = chargedAmount`.
   * Has the same length and order as {@link ErstattungInput.positions}.
   */
  byPosition: ErstattungByPosition[];
  /**
   * Summe der §10 GOÄ Auslagenersatz-Positionen (Porto/Versand etc.) — stets
   * voll erstattet, außerhalb der `byCategory`-Pipeline. Included in `eligibleAmount`.
   */
  auslagenersatzAmount: number;
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

/**
 * Apply the full §5.1 pipeline to one category group. The waiting-period check
 * is handled per-position by {@link computeErstattung} before this is called.
 */
function computeCategory(
  category: BenefitCategory,
  chargedAmount: number,
  benefit: IncludedBenefit | undefined,
  input: ErstattungInput,
): ErstattungByCategory {
  const base = (eligible: number, cappedBy: CappedBy, note?: string): ErstattungByCategory => ({
    category,
    chargedAmount: roundCents(chargedAmount),
    eligibleAmount: roundCents(Math.max(0, eligible)),
    appliedPct: chargedAmount > 0 ? roundCents((Math.max(0, eligible) / chargedAmount) * 100) : 0,
    cappedBy,
    note,
  });

  // No tariff rule for this category → not a covered benefit.
  if (!benefit) {
    return base(0, null, `Keine Tarifregel für „${category}" — nicht erstattungsfähig.`);
  }

  // 1. Schwellen-Staffel (no tiers ⇒ 100 % base).
  let eligible = benefit.tiers ? applyTiers(chargedAmount, benefit.tiers) : chargedAmount;
  let cappedBy: CappedBy = benefit.tiers && eligible < chargedAmount ? 'tier' : null;
  const notes: string[] = [];
  if (cappedBy === 'tier') notes.push('gestaffelt nach Schwellenwerten');

  // 3. Beihilfe — tariff covers only the residual quota. As elsewhere, the last
  // binding rule wins: a later `limit`/`annual_staffel` cap overrides this.
  if (benefit.beihilfe_satz && benefit.beihilfe_satz > 0) {
    eligible *= (100 - benefit.beihilfe_satz) / 100;
    cappedBy = 'beihilfe';
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
      differenceInYears(toCalendarDate(input.invoiceDate), toCalendarDate(input.coverageStart)) + 1;
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
 * {@link BenefitCategory}; each group runs the five-step pipeline.
 *
 * Per-position waiting-period check: each position's `treatmentDate` (or the
 * fallback `invoiceDate`) is tested against the coverage start. Positions within
 * a waiting period are excluded from their category group before the tier/limit
 * calculation, then receive `eligible_amount = 0` in the `byPosition` result.
 *
 * The returned `eligibleAmount` is the input to the Günstigerprüfung.
 */
export function computeErstattung(input: ErstattungInput): ErstattungResult {
  type PositionEntry = { idx: number; chargedAmount: number; waitingBlocked: boolean };
  const benefitMap = new Map(input.benefits.benefits.map((b) => [b.category, b]));

  const byPosition: ErstattungByPosition[] = input.positions.map((_, i) => ({
    index: i,
    eligible_amount: 0,
  }));

  // §10 GOÄ Auslagenersatz positions skip the category pipeline entirely —
  // always reimbursed at 100 % of chargedAmount.
  let auslagenersatzAmount = 0;

  // Per-position waiting-period check using individual treatment dates.
  const categoryGroups = new Map<BenefitCategory, PositionEntry[]>();
  for (let idx = 0; idx < input.positions.length; idx++) {
    const pos = input.positions[idx]!;
    if (pos.positionCategory === 'auslagenersatz') {
      const amount = roundCents(pos.chargedAmount);
      byPosition[idx]!.eligible_amount = amount;
      auslagenersatzAmount += amount;
      continue;
    }
    const benefit = benefitMap.get(pos.category);
    const checkDate = pos.treatmentDate ?? input.invoiceDate;
    const waiting = benefit?.waiting_period_months ?? 0;
    let waitingBlocked = false;
    if (waiting > 0) {
      const waitingEnds = addMonths(toCalendarDate(input.coverageStart), waiting);
      waitingBlocked = isBefore(toCalendarDate(checkDate), waitingEnds);
    }
    const group = categoryGroups.get(pos.category) ?? [];
    group.push({ idx, chargedAmount: pos.chargedAmount, waitingBlocked });
    categoryGroups.set(pos.category, group);
  }

  const byCategory: ErstattungByCategory[] = [];

  for (const [category, group] of categoryGroups) {
    const benefit = benefitMap.get(category);
    const eligibleGroup = group.filter((e) => !e.waitingBlocked);
    const totalCharged = roundCents(group.reduce((s, e) => s + e.chargedAmount, 0));
    const eligibleCharged = roundCents(eligibleGroup.reduce((s, e) => s + e.chargedAmount, 0));

    if (eligibleGroup.length === 0) {
      // Entire category blocked by waiting period.
      byCategory.push({
        category,
        chargedAmount: totalCharged,
        eligibleAmount: 0,
        appliedPct: 0,
        cappedBy: 'waiting_period',
        note: `Innerhalb der Wartezeit von ${benefit?.waiting_period_months ?? 0} Monaten.`,
      });
    } else {
      // Run the pipeline on non-blocked positions (waiting period already handled).
      const catResult = computeCategory(category, eligibleCharged, benefit, input);
      byCategory.push({ ...catResult, chargedAmount: totalCharged });

      // Distribute eligible amount proportionally to non-blocked positions.
      if (eligibleCharged > 0 && catResult.eligibleAmount > 0) {
        for (const entry of eligibleGroup) {
          byPosition[entry.idx]!.eligible_amount = roundCents(
            (catResult.eligibleAmount * entry.chargedAmount) / eligibleCharged,
          );
        }
      }
    }
  }

  const eligibleAmount = roundCents(
    byCategory.reduce((sum, c) => sum + c.eligibleAmount, 0) + auslagenersatzAmount,
  );
  return {
    eligibleAmount,
    byCategory,
    byPosition,
    auslagenersatzAmount: roundCents(auslagenersatzAmount),
  };
}

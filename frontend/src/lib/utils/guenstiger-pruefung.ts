// SPDX-License-Identifier: Apache-2.0
/**
 * Günstigerprüfung — the decision engine that answers the question at the heart
 * of the app: **should a doctor's bill be submitted to the insurer, or self-paid
 * to preserve the premium-refund (Beitragsrückerstattung, BRE) streak?**
 *
 * One of the two domain-critical algorithms (see docs/design.md §5, CLAUDE.md).
 * Engine redesign (issue #140): the decision now falls **per versicherter Person
 * × Leistungsjahr** instead of per invoice. The Selbstbehalt (deductible) is
 * an annual figure applied once to the full year's eligible amount; the BRE loss
 * is discounted to the payout date of the **service year** (July of Y+1 by
 * default), not to the current calendar year-end.
 *
 * Pure and deterministic — no hidden `Date.now()`; `asOf` and every other
 * parameter are injectable for fully reproducible results in tests.
 *
 * ## Decision rule (design §5.2.3)
 *
 * ```
 *   max(0, R_Y − S)  >  NPV(ΔBRE) + Steuervorteil
 * ```
 *
 * Special case `alreadyBroken`: if a refund for year Y already flowed,
 * NPV(ΔBRE) = 0 — always recommend submitting for that year.
 *
 * ## NPV formula — Sofort-Term j=0 (issue #140)
 *
 * This release implements only the immediate term (j=0, the guaranteed BRE
 * for year Y). The multi-year recovery transient (j≥1, probability-weighted)
 * is added in issue #141.
 *
 * ```
 *   NPV(ΔBRE) = B(min(s+1, n_max)) / (1 + i/12)^τ₀
 * ```
 *
 * where B(0) = 0, and τ₀ = months from `asOf` to July of Y+1, floor at 0
 * (past payout date → no discounting).
 */

import {
  formatEur,
  getCurrentStreakYears,
  projectedBREForStreak,
  roundCents,
  toCalendarDate,
  type BREStructure,
  type DateInput,
  type InvoiceStatus,
} from '@selbstbehalt/shared';

/** Default annual discount rate for the NPV of the forfeited BRE (design §5.2.2). */
export const DEFAULT_DISCOUNT_RATE = 0.03;
/** Default probability of remaining claim-free in a future year (design §5.2.2). */
export const DEFAULT_CLAIM_FREE_PROBABILITY = 0.7;
/** Default BRE payout month — July (design §5.2.4). Configurable per contract in a future issue. */
export const DEFAULT_PAYOUT_MONTH = 7;

// ---------------------------------------------------------------------------
// Aggregation helper
// ---------------------------------------------------------------------------

/** Minimal invoice shape needed by {@link aggregateByYear}. */
export interface GCP_InvoiceData {
  status: InvoiceStatus;
  positions: Array<{
    treatment_date: string;
    eligible_amount?: number | null;
    refund_amount?: number | null;
  }>;
}

/** Aggregated treatment-year data for one person, produced by {@link aggregateByYear}. */
export interface GCP_YearAggregate {
  /** Service year (Leistungsjahr Y). */
  year: number;
  /**
   * Relevant amount R_Y for year Y (design §5.2.1): actual refund for `erstattet`
   * invoices, `eligible_amount` estimate for `geprüft`/`bezahlt`/`eingereicht`.
   */
  R_Y: number;
  /** `true` if a refund > 0 has already been paid for year Y — NPV(ΔBRE) = 0. */
  alreadyBroken: boolean;
}

/**
 * Aggregate invoice positions by service year (Leistungsjahr = `treatment_date` year).
 *
 * Rules (design §5.2.1):
 * - Skips invoices with status `neu`.
 * - `erstattet` invoices contribute `refund_amount` per position (actual outflow).
 * - `geprüft` / `bezahlt` / `eingereicht` contribute `eligible_amount` (estimate).
 * - `alreadyBroken` = true for any year that has at least one `erstattet` position
 *   with `refund_amount > 0` (the BRE streak for that year is already gone).
 */
export function aggregateByYear(invoices: GCP_InvoiceData[]): GCP_YearAggregate[] {
  const byYear = new Map<number, { R_Y: number; alreadyBroken: boolean }>();

  for (const invoice of invoices) {
    if (invoice.status === 'neu') continue;

    for (const position of invoice.positions) {
      const year = parseInt(position.treatment_date.substring(0, 4), 10);
      const entry = byYear.get(year) ?? { R_Y: 0, alreadyBroken: false };

      if (invoice.status === 'erstattet') {
        const refund = position.refund_amount ?? 0;
        entry.R_Y += refund;
        if (refund > 0) entry.alreadyBroken = true;
      } else {
        entry.R_Y += position.eligible_amount ?? 0;
      }

      byYear.set(year, entry);
    }
  }

  return Array.from(byYear.entries()).map(([year, { R_Y, alreadyBroken }]) => ({
    year,
    R_Y: roundCents(R_Y),
    alreadyBroken,
  }));
}

// ---------------------------------------------------------------------------
// Engine types
// ---------------------------------------------------------------------------

/** Inputs for {@link calculateGCP}. Mirrors `GCP_YearInput` in design §5.3. */
export interface GCP_YearInput {
  /** Service year (Leistungsjahr Y). */
  year: number;
  /** Eligible amount R_Y for year Y — aggregated over positions with `treatment_date` in Y. */
  erstattungsBetrag: number;
  /** `true` if a refund for Y has already been paid — sets NPV(ΔBRE) to 0. */
  alreadyBroken: boolean;
  /** Annual deductible S in EUR (`insured_persons.self_retention`). */
  selbstbehalt: number;
  /** The insured person's BRE ladder (`insured_persons.bre_structure`). */
  breStructure: BREStructure;
  /** Monthly premium in EUR — the base of the projected refund. */
  monthlyPremium: number;
  /**
   * Tax saved in EUR by self-paying (§33 EStG, above the zumutbare Belastung).
   * Caller-supplied; defaults to 0 — the engine does not estimate it. Non-negative.
   */
  taxSavingFromSelfPay?: number;
  /** Annual discount rate i. Defaults to {@link DEFAULT_DISCOUNT_RATE}. */
  discountRate?: number;
  /**
   * Probability p of remaining claim-free in any future year.
   * Defaults to {@link DEFAULT_CLAIM_FREE_PROBABILITY}.
   * Used for j≥1 terms (issue #141); stored here for forward compatibility.
   */
  claimFreeProbability?: number;
  /** BRE payout month (1–12). Defaults to {@link DEFAULT_PAYOUT_MONTH} (July). */
  payoutMonth?: number;
  /**
   * Reference day for streak calculation and discounting. Defaults to today;
   * inject an explicit value in tests for deterministic results.
   */
  asOf?: DateInput;
}

/** One term of the NPV(ΔBRE) sum, for UI transparency (design §5.3). */
export interface GCP_LadderTerm {
  /** Term index: 0 = immediate BRE for year Y; ≥1 = recovery transient (issue #141). */
  j: number;
  /** Undiscounted gap B(min(s+1+j, nMax)) − B(min(j, nMax)), in EUR. */
  gross: number;
  /** Probability weight p^j (= 1 for j=0). */
  probability: number;
  /** Months from `asOf` to the BRE payout of year Y+j, floor at 0. */
  monthsToPayout: number;
  /** Weighted, discounted contribution to NPV(ΔBRE), in EUR. */
  discounted: number;
}

/** Result of {@link calculateGCP}. Mirrors `GCP_Result` in design §5.3. */
export interface GCP_Result {
  /** `'einreichen'` (submit) or `'selbst_zahlen'` (self-pay). */
  recommendation: 'einreichen' | 'selbst_zahlen';
  /** Net advantage of submitting, in EUR. Positive ⇒ submit; `≤ 0` ⇒ self-pay. */
  netBenefitOfSubmitting: number;
  /** Every figure feeding the decision, so the recommendation is fully traceable. */
  breakdown: {
    /** Service year. */
    year: number;
    /** max(0, R_Y − S) in EUR. */
    refundAfterDeductible: number;
    /** Completed claim-free years s before year Y. */
    currentStreakYears: number;
    /** Whether the BRE for year Y is already forfeited by a prior refund. */
    alreadyBroken: boolean;
    /** Present value of the forfeited BRE stream in EUR. Zero if `alreadyBroken`. */
    lostBREValue_NPV: number;
    /** Per-term breakdown of the NPV sum (for UI transparency). Empty if `alreadyBroken`. */
    ladderTerms: GCP_LadderTerm[];
    /** Annual discount rate applied. */
    discountRate: number;
    /** Claim-free probability p stored for j≥1 terms (issue #141). */
    claimFreeProbability: number;
    /** Tax saved by self-paying (§33 EStG). */
    taxSavingFromSelfPay: number;
  };
  /** German plain-text rationale for the recommendation. */
  explanation: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * BRE amount B(k) at exactly k completed claim-free years.
 * Returns 0 for k ≤ 0 (design definition: B(0) = 0).
 */
function breAtStreak(breStructure: BREStructure, monthlyPremium: number, k: number): number {
  if (k <= 0) return 0;
  return projectedBREForStreak(breStructure, monthlyPremium, k);
}

/** Highest `claim_free_years` threshold in the ladder (n_max). */
function maxStreakLevel(breStructure: BREStructure): number {
  return Math.max(...breStructure.levels.map((l) => l.claim_free_years));
}

/**
 * Whole months from `asOf` to the BRE payout date for year Y+j
 * (= payoutMonth of Y+1+j), floor at 0.
 * A past payout date returns 0 (no discounting — loss is already realised).
 */
function monthsToPayout(year: number, j: number, payoutMonth: number, asOf: DateInput): number {
  const asOfDate = toCalendarDate(asOf);
  const payoutYear = year + 1 + j;
  const months =
    (payoutYear - asOfDate.getFullYear()) * 12 + (payoutMonth - 1 - asOfDate.getMonth());
  return Math.max(0, months);
}

function buildExplanation(
  recommendation: GCP_Result['recommendation'],
  netBenefit: number,
  refundAfterDeductible: number,
  year: number,
  alreadyBroken: boolean,
  costOfSubmitting: number,
): string {
  if (alreadyBroken) {
    return (
      `Die BRE-Staffel für Leistungsjahr ${year} ist bereits durch eine vorliegende ` +
      `Erstattung unterbrochen — Einreichen empfohlen ohne BRE-Abzug.`
    );
  }

  const refund = formatEur(refundAfterDeductible);
  const advantage = formatEur(Math.abs(netBenefit));
  const cost = formatEur(costOfSubmitting);

  if (netBenefit === 0) {
    return (
      `Beide Optionen sind für Leistungsjahr ${year} mit ${refund} Nettoerstattung ` +
      `gegenüber ${cost} entgehendem Vorteil etwa gleichwertig. Im Zweifel selbst ` +
      `zahlen, um die BRE-Staffel zu erhalten.`
    );
  }
  if (recommendation === 'einreichen') {
    return (
      `Einreichen lohnt sich für Leistungsjahr ${year}: Die Nettoerstattung von ${refund} ` +
      `übersteigt den entgehenden Vorteil aus BRE und Steuerersparnis (${cost}) um ${advantage}.`
    );
  }
  return (
    `Selbst zahlen lohnt sich für Leistungsjahr ${year}: Der entgehende Vorteil aus ` +
    `BRE und Steuerersparnis (${cost}) übersteigt die Nettoerstattung von ${refund} um ${advantage}.`
  );
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * Run the Günstigerprüfung for one versicherter Person × Leistungsjahr.
 *
 * Issue #140: implements only the Sofort-Term (j=0) of the NPV(ΔBRE) sum.
 * Multi-year recovery terms (j≥1) are added in issue #141.
 *
 * @throws RangeError if `taxSavingFromSelfPay` is negative, `discountRate ≤ −1`,
 *   `claimFreeProbability` outside [0, 1], or `payoutMonth` outside [1, 12].
 */
export function calculateGCP(input: GCP_YearInput): GCP_Result {
  const {
    year,
    erstattungsBetrag,
    alreadyBroken,
    selbstbehalt,
    breStructure,
    monthlyPremium,
    taxSavingFromSelfPay: taxSavingInput = 0,
    discountRate = DEFAULT_DISCOUNT_RATE,
    claimFreeProbability = DEFAULT_CLAIM_FREE_PROBABILITY,
    payoutMonth = DEFAULT_PAYOUT_MONTH,
    asOf = new Date(),
  } = input;

  if (!(taxSavingInput >= 0)) {
    throw new RangeError(`Steuervorteil darf nicht negativ sein, war ${taxSavingInput}`);
  }
  if (!(discountRate > -1)) {
    throw new RangeError(`Diskontrate muss größer als -1 sein, war ${discountRate}`);
  }
  if (!(claimFreeProbability >= 0 && claimFreeProbability <= 1)) {
    throw new RangeError(
      `Leistungsfreiwahrscheinlichkeit muss zwischen 0 und 1 liegen, war ${claimFreeProbability}`,
    );
  }
  if (!(payoutMonth >= 1 && payoutMonth <= 12)) {
    throw new RangeError(`Auszahlungsmonat muss zwischen 1 und 12 liegen, war ${payoutMonth}`);
  }

  const refundAfterDeductible = roundCents(Math.max(0, erstattungsBetrag - selbstbehalt));
  const currentStreakYears = getCurrentStreakYears(breStructure, asOf);
  const nMax = maxStreakLevel(breStructure);
  const taxSavingFromSelfPay = roundCents(taxSavingInput);

  let ladderTerms: GCP_LadderTerm[];
  let lostBREValue_NPV: number;

  if (alreadyBroken) {
    // BRE for year Y already forfeited — no further NPV cost to submitting.
    ladderTerms = [];
    lostBREValue_NPV = 0;
  } else {
    // Sofort-Term j=0 (issue #140). Multi-year recovery j≥1 follows in issue #141.
    const j = 0;
    const gross = roundCents(
      breAtStreak(breStructure, monthlyPremium, Math.min(currentStreakYears + 1 + j, nMax)) -
        breAtStreak(breStructure, monthlyPremium, Math.min(j, nMax)),
    );
    const probability = 1; // p^0 = 1; claimFreeProbability stored for #141
    const tau = monthsToPayout(year, j, payoutMonth, asOf);
    const discounted = roundCents((gross * probability) / Math.pow(1 + discountRate / 12, tau));
    ladderTerms = [{ j, gross, probability, monthsToPayout: tau, discounted }];
    lostBREValue_NPV = discounted;
  }

  const netBenefitOfSubmitting = roundCents(
    refundAfterDeductible - lostBREValue_NPV - taxSavingFromSelfPay,
  );
  // Tie (netBenefit === 0) goes to self-pay: preserve the streak when in doubt.
  const recommendation = netBenefitOfSubmitting > 0 ? 'einreichen' : 'selbst_zahlen';
  const costOfSubmitting = roundCents(lostBREValue_NPV + taxSavingFromSelfPay);

  return {
    recommendation,
    netBenefitOfSubmitting,
    breakdown: {
      year,
      refundAfterDeductible,
      currentStreakYears,
      alreadyBroken,
      lostBREValue_NPV,
      ladderTerms,
      discountRate,
      claimFreeProbability,
      taxSavingFromSelfPay,
    },
    explanation: buildExplanation(
      recommendation,
      netBenefitOfSubmitting,
      refundAfterDeductible,
      year,
      alreadyBroken,
      costOfSubmitting,
    ),
  };
}

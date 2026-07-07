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
 *   max(0, R_Y − S)  >  NPV(ΔBRE)
 * ```
 *
 * No tax benefit (§33 EStG) is netted in here — intentionally out of scope,
 * see design §5.2.4 ("Steuervorteil — bewusst nicht berücksichtigt").
 *
 * ## When the BRE streak actually breaks (design §5.2.1, point 2)
 *
 * Submitting an invoice does **not** break the premium-refund streak on its own.
 * The streak breaks only once the **cumulative reimbursement for the year exceeds
 * the Selbstbehalt** — i.e. once the insurer actually pays out above the deductible.
 * Below the deductible every euro is absorbed by the Selbstbehalt, the insurer
 * pays nothing, the year stays leistungsfrei and the BRE is preserved. So:
 *
 * - `refundAfterDeductible = max(0, R_Y − S) = 0` (year is **under** the
 *   deductible) ⇒ submitting is inconsequential, NPV(ΔBRE) = 0. The decision
 *   only becomes relevant for the invoice that pushes the year **over** S.
 * - `alreadyBroken`: the streak is already, irrevocably gone only when the
 *   **already-realised** reimbursements (`alreadyReimbursed` = Σ `refund_amount`
 *   over `erstattet` positions in Y) exceed S. Then NPV(ΔBRE) = 0 — always submit.
 *   A single small refund that stays under S does **not** break the streak.
 *
 * ## NPV formula — full multi-year sum (issues #140 + #141)
 *
 * ```
 *   NPV(ΔBRE) = Σ_{j=0}^{nMax−1} [B(min(s+1+j,nMax)) − B(min(j,nMax))] · p^j / (1+i/12)^τ_j
 * ```
 *
 * - j=0: the guaranteed immediate BRE step (p^0 = 1).
 * - j≥1: recovery transient, dampened by `p^j` (probability of staying claim-free).
 * - Loop stops early once the gap B(s+1+j,nMax)−B(j,nMax) reaches 0 (both paths at nMax).
 * - τ_j = months from `asOf` to July of Y+1+j, floor at 0.
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
  /**
   * Reimbursements already realised for year Y — Σ `refund_amount` over `erstattet`
   * positions. Whether this breaks the BRE streak depends on the Selbstbehalt: the
   * streak is gone only once `alreadyReimbursed` exceeds S (see {@link calculateGCP}).
   * The aggregation itself doesn't know S, so it reports the sum, not the verdict.
   */
  alreadyReimbursed: number;
}

/**
 * Aggregate invoice positions by service year (Leistungsjahr = `treatment_date` year).
 *
 * Rules (design §5.2.1):
 * - Skips invoices with status `neu`.
 * - `erstattet` invoices contribute `refund_amount` per position (actual outflow).
 * - `geprüft` / `bezahlt` / `eingereicht` contribute `eligible_amount` (estimate).
 * - `alreadyReimbursed` sums `refund_amount` over `erstattet` positions per year;
 *   the caller compares it against the Selbstbehalt to decide whether the streak
 *   is already broken — a small refund that stays under S does *not* break it.
 */
export function aggregateByYear(invoices: GCP_InvoiceData[]): GCP_YearAggregate[] {
  const byYear = new Map<number, { R_Y: number; alreadyReimbursed: number }>();

  for (const invoice of invoices) {
    if (invoice.status === 'neu') continue;

    for (const position of invoice.positions) {
      const year = parseInt(position.treatment_date.substring(0, 4), 10);
      const entry = byYear.get(year) ?? { R_Y: 0, alreadyReimbursed: 0 };

      if (invoice.status === 'erstattet') {
        const refund = position.refund_amount ?? 0;
        entry.R_Y += refund;
        entry.alreadyReimbursed += refund;
      } else {
        entry.R_Y += position.eligible_amount ?? 0;
      }

      byYear.set(year, entry);
    }
  }

  return Array.from(byYear.entries()).map(([year, { R_Y, alreadyReimbursed }]) => ({
    year,
    R_Y: roundCents(R_Y),
    alreadyReimbursed: roundCents(alreadyReimbursed),
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
  /**
   * Reimbursements already realised for Y (`alreadyReimbursed` from
   * {@link aggregateByYear}). The streak counts as already broken — NPV(ΔBRE) = 0 —
   * only when this exceeds {@link selbstbehalt}; a smaller realised refund leaves
   * the year leistungsfrei and the streak intact.
   */
  alreadyReimbursed: number;
  /** Annual deductible S in EUR (`insured_persons.self_retention`). */
  selbstbehalt: number;
  /** The insured person's BRE ladder (`insured_persons.bre_structure`). */
  breStructure: BREStructure;
  /** Monthly premium in EUR — the base of the projected refund. */
  monthlyPremium: number;
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
    /** Relevant amount R_Y for the year in EUR (aggregated over all its invoices). */
    relevantAmount: number;
    /** Annual deductible S in EUR. */
    selbstbehalt: number;
    /** max(0, R_Y − S) in EUR. */
    refundAfterDeductible: number;
    /** Completed claim-free years s before year Y. */
    currentStreakYears: number;
    /** Reimbursements already realised for Y in EUR (Σ `refund_amount`). */
    alreadyReimbursed: number;
    /**
     * Whether the BRE streak for year Y is already, irrevocably gone — i.e.
     * `alreadyReimbursed > selbstbehalt`.
     */
    alreadyBroken: boolean;
    /**
     * Present value of the forfeited BRE stream in EUR — the cost that submitting
     * would incur. Zero when the year stays under the deductible (submitting is
     * inconsequential) or when the streak is already broken.
     */
    lostBREValue_NPV: number;
    /**
     * Per-term breakdown of the NPV sum (for UI transparency). Empty when the year
     * is under the deductible or the streak is already broken.
     */
    ladderTerms: GCP_LadderTerm[];
    /** Annual discount rate applied. */
    discountRate: number;
    /** Claim-free probability p stored for j≥1 terms (issue #141). */
    claimFreeProbability: number;
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
  breakdown: GCP_Result['breakdown'],
): string {
  const { year, relevantAmount, selbstbehalt, refundAfterDeductible, alreadyBroken } = breakdown;

  // 1. Streak already broken: realised reimbursements already exceed the deductible.
  if (alreadyBroken) {
    return (
      `Die bereits erstatteten Beträge für Leistungsjahr ${year} ` +
      `(${formatEur(breakdown.alreadyReimbursed)}) übersteigen den Selbstbehalt ` +
      `(${formatEur(selbstbehalt)}) — die BRE-Staffel für ${year} ist damit bereits gebrochen. ` +
      `Weitere Rechnungen dieses Jahres kosten keine zusätzliche BRE; Einreichen empfohlen.`
    );
  }

  // 2. Under the deductible: submitting neither triggers a payout nor breaks the
  //    streak, so no BRE is at stake. The decision only matters once the year's
  //    reimbursable sum exceeds the Selbstbehalt.
  if (refundAfterDeductible === 0) {
    return (
      `Die erstattungsfähige Jahressumme für ${year} (${formatEur(relevantAmount)}) liegt noch ` +
      `unter dem Selbstbehalt (${formatEur(selbstbehalt)}). Einreichen bricht die BRE-Staffel ` +
      `nicht und bringt keine Erstattung — die Entscheidung wird erst relevant, sobald die ` +
      `Jahressumme den Selbstbehalt übersteigt.`
    );
  }

  // 3. Over the deductible: a genuine trade-off between the net refund and the
  //    BRE that submitting would forfeit.
  const refund = formatEur(refundAfterDeductible);
  const advantage = formatEur(Math.abs(netBenefit));
  const cost = formatEur(breakdown.lostBREValue_NPV);
  const recoveryTerms = breakdown.ladderTerms.filter((t) => t.j > 0);
  const recoveryHint =
    recoveryTerms.length > 0
      ? ` inkl. Wiederaufstieg über ${recoveryTerms.length} Jahr${recoveryTerms.length === 1 ? '' : 'e'}`
      : '';

  if (netBenefit === 0) {
    return (
      `Beide Optionen sind für Leistungsjahr ${year} mit ${refund} Nettoerstattung ` +
      `gegenüber ${cost} entgehendem BRE-Vorteil${recoveryHint} etwa gleichwertig. Im Zweifel selbst ` +
      `zahlen, um die BRE-Staffel zu erhalten.`
    );
  }
  if (recommendation === 'einreichen') {
    return (
      `Einreichen lohnt sich für Leistungsjahr ${year}: Die Jahressumme übersteigt den ` +
      `Selbstbehalt, die Nettoerstattung von ${refund} übersteigt den entgehenden ` +
      `BRE-Vorteil${recoveryHint} (${cost}) um ${advantage}.`
    );
  }
  return (
    `Selbst zahlen lohnt sich für Leistungsjahr ${year}: Die Jahressumme übersteigt zwar den ` +
    `Selbstbehalt, doch der entgehende BRE-Vorteil${recoveryHint} (${cost}) übersteigt die ` +
    `Nettoerstattung von ${refund} um ${advantage} — selbst zahlen erhält die Staffel.`
  );
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * Run the Günstigerprüfung for one versicherter Person × Leistungsjahr.
 *
 * The BRE loss (NPV) is charged only when submitting would actually break the
 * streak: the year's reimbursable sum must cross the Selbstbehalt (`R_Y > S`) and
 * the streak must not already be broken by realised reimbursements. Below the
 * deductible submitting is inconsequential, so NPV(ΔBRE) = 0 (design §5.2.1).
 *
 * When a loss is at stake, it is the full multi-year NPV(ΔBRE) sum
 * (design §5.2.4, issues #140 + #141):
 *   NPV(ΔBRE) = Σ_{j=0}^{nMax−1} [B(min(s+1+j,nMax)) − B(min(j,nMax))] · p^j / (1+i/12)^τ_j
 *
 * @throws RangeError if `discountRate ≤ −1`, `claimFreeProbability` outside [0, 1],
 *   or `payoutMonth` outside [1, 12].
 */
export function calculateGCP(input: GCP_YearInput): GCP_Result {
  const {
    year,
    erstattungsBetrag,
    alreadyReimbursed,
    selbstbehalt,
    breStructure,
    monthlyPremium,
    discountRate = DEFAULT_DISCOUNT_RATE,
    claimFreeProbability = DEFAULT_CLAIM_FREE_PROBABILITY,
    payoutMonth = DEFAULT_PAYOUT_MONTH,
    asOf = new Date(),
  } = input;

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

  // The streak is already, irrevocably gone only once the *realised* reimbursements
  // for the year exceed the Selbstbehalt — a smaller refund keeps the year
  // leistungsfrei (design §5.2.1, point 2).
  const alreadyBroken = alreadyReimbursed > selbstbehalt;
  // Submitting everything triggers a payout (and therefore risks the streak) only
  // when the year's reimbursable sum exceeds the deductible. Below it, submitting
  // is inconsequential: the insurer pays nothing and the streak is preserved.
  const crossesDeductible = refundAfterDeductible > 0;

  const ladderTerms: GCP_LadderTerm[] = [];
  let lostBREValue_NPV = 0;

  if (crossesDeductible && !alreadyBroken) {
    // Only here is a BRE loss actually at stake: submitting would cross the
    // deductible and break an intact streak. Full multi-year NPV sum
    // (design §5.2.4, issues #140 + #141).
    for (let j = 0; j < nMax; j++) {
      const gross = roundCents(
        breAtStreak(breStructure, monthlyPremium, Math.min(currentStreakYears + 1 + j, nMax)) -
          breAtStreak(breStructure, monthlyPremium, Math.min(j, nMax)),
      );
      if (gross === 0) break; // both paths have reached nMax — no further gain
      const probability = roundCents(Math.pow(claimFreeProbability, j));
      const tau = monthsToPayout(year, j, payoutMonth, asOf);
      const discounted = roundCents((gross * probability) / Math.pow(1 + discountRate / 12, tau));
      ladderTerms.push({ j, gross, probability, monthsToPayout: tau, discounted });
    }
    lostBREValue_NPV = roundCents(ladderTerms.reduce((sum, t) => sum + t.discounted, 0));
  }

  const netBenefitOfSubmitting = roundCents(refundAfterDeductible - lostBREValue_NPV);
  // Tie (netBenefit === 0) goes to self-pay: preserve the streak when in doubt.
  const recommendation = netBenefitOfSubmitting > 0 ? 'einreichen' : 'selbst_zahlen';

  const breakdown: GCP_Result['breakdown'] = {
    year,
    relevantAmount: roundCents(erstattungsBetrag),
    selbstbehalt: roundCents(selbstbehalt),
    refundAfterDeductible,
    currentStreakYears,
    alreadyReimbursed: roundCents(alreadyReimbursed),
    alreadyBroken,
    lostBREValue_NPV,
    ladderTerms,
    discountRate,
    claimFreeProbability,
  };

  return {
    recommendation,
    netBenefitOfSubmitting,
    breakdown,
    explanation: buildExplanation(recommendation, netBenefitOfSubmitting, breakdown),
  };
}

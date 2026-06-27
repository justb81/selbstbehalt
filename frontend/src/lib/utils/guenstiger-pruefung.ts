// SPDX-License-Identifier: Apache-2.0
/**
 * Günstigerprüfung — the decision engine that answers the question at the heart
 * of the app: **should a doctor's bill be submitted to the insurer, or self-paid
 * to preserve the premium-refund (Beitragsrückerstattung, BRE) streak?**
 *
 * One of the two domain-critical algorithms (see docs/design.md §5, CLAUDE.md).
 * Pure and deterministic — there is no hidden `Date.now()`; the reference day and
 * the discount rate are both injectable so results are fully reproducible in
 * tests. It reuses the BRE ladder math from `@selbstbehalt/shared` (#17).
 *
 * ## Decision rule (design §5.1)
 *
 * Submitting is worthwhile when the net refund clears the cost of submitting —
 * the present value of the forfeited BRE **plus** the tax deduction you would
 * only get by self-paying:
 *
 * ```
 *   R − S  >  NPV(ΔBRE) + Steuervorteil(R)
 * ```
 *
 * Equivalently, with `netBenefitOfSubmitting = (R − S) − NPV(ΔBRE) − Steuervorteil`,
 * submit when that value is positive. Both the BRE loss and the tax saving are
 * benefits you keep **only if you self-pay**, so both raise the bar for
 * submitting — see the note in design §5.2 on the corrected sign of the tax term.
 */

import {
  getCurrentStreakMonths,
  getProjectedBRE,
  type BREStructure,
  type DateInput,
} from '@selbstbehalt/shared';

/** Default annual discount rate for the NPV of the forfeited BRE (design §5.1). */
export const DEFAULT_DISCOUNT_RATE = 0.03;

/** Share of a self-paid bill assumed tax-deductible (design §5.2, simplified §10 EStG). */
const TAX_DEDUCTIBLE_SHARE = 0.5;

/** Inputs for {@link calculateGCP}. Mirrors `GCP_Input` in design §5.2. */
export interface GCP_Input {
  /** Gross invoice total in EUR (the amount eligible for the tax deduction). */
  rechnungsBetrag: number;
  /** Amount the insurer would reimburse in EUR (`eligible_amount`). */
  erstattungsBetrag: number;
  /** Deductible (Selbstbehalt) still open this calendar year, in EUR. */
  verbleibenderSelbstbehalt: number;
  /** The contract's BRE ladder (`contracts.bre_structure`). */
  breStructure: BREStructure;
  /** Monthly premium in EUR — the base of the projected refund. */
  monthlyPremium: number;
  /** Marginal tax rate, `0.0`–`1.0` (e.g. `0.42` for 42 %). */
  taxRate: number;
  /** Annual discount rate for the BRE NPV. Defaults to {@link DEFAULT_DISCOUNT_RATE}. */
  discountRate?: number;
  /**
   * Reference day for the streak and the months-to-year-end discounting.
   * Defaults to today; pass an explicit value in tests for deterministic
   * results — there is no hidden `Date.now()` in the math.
   */
  asOf?: DateInput;
}

/** Result of {@link calculateGCP}. Mirrors `GCP_Result` in design §5.2, with a fuller breakdown. */
export interface GCP_Result {
  /** `'einreichen'` (submit) or `'selbst_zahlen'` (self-pay). */
  recommendation: 'einreichen' | 'selbst_zahlen';
  /** Net advantage of submitting, in EUR. Positive ⇒ submit; `≤ 0` ⇒ self-pay. */
  netBenefitOfSubmitting: number;
  /** Every figure feeding the decision, so the recommendation is fully traceable. */
  breakdown: {
    /** Refund left after the open deductible: `max(0, R − S)`. */
    refundAfterDeductible: number;
    /** Whole claim-free months of the current streak. */
    currentStreakMonths: number;
    /** Undiscounted BRE forfeited if the streak resets (design "Drohender BRE-Verlust"). */
    projectedBRELoss: number;
    /** Whole months from `asOf` to year-end used to discount the BRE. */
    monthsToYearEnd: number;
    /** Annual discount rate actually applied. */
    discountRate: number;
    /** Present value of {@link projectedBRELoss}, discounted to `asOf`. */
    lostBREValue_NPV: number;
    /** Tax saved by self-paying (only realised if not submitted). */
    taxSavingFromSelfPay: number;
  };
  /** German plain-text rationale for the recommendation. */
  explanation: string;
}

/** Round a EUR value to whole cents, avoiding binary-float display noise. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 0-based month index of a `DateInput`, parsed as a calendar date (TZ-safe for strings). */
function monthIndex(value: DateInput): number {
  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (!match) {
      throw new RangeError(`Ungültiges Datum: "${value}" (erwartet JJJJ-MM-TT)`);
    }
    return Number(match[2]) - 1;
  }
  return value.getMonth();
}

/**
 * Whole months from `asOf` to the end of the calendar year, when the BRE is paid
 * out: `12 − monthIndex` (January ⇒ 12, December ⇒ 1), matching design §5.2.
 */
function monthsUntilYearEnd(asOf: DateInput): number {
  return 12 - monthIndex(asOf);
}

/** Format a EUR amount as German plain text, e.g. `181,40 €`. */
function formatEur(amount: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount);
}

/**
 * Build the German plain-text rationale. `advantage` is the absolute net benefit;
 * `costOfSubmitting` is the forfeited value (BRE NPV + tax saving) at stake.
 */
function buildExplanation(
  recommendation: GCP_Result['recommendation'],
  netBenefit: number,
  refundAfterDeductible: number,
  costOfSubmitting: number,
): string {
  const advantage = formatEur(Math.abs(netBenefit));
  const refund = formatEur(refundAfterDeductible);
  const cost = formatEur(costOfSubmitting);

  if (netBenefit === 0) {
    return (
      `Beide Optionen sind mit ${refund} Nettoerstattung gegenüber ${cost} entgehendem ` +
      `Vorteil etwa gleichwertig. Im Zweifel selbst zahlen, um die BRE-Staffel zu erhalten.`
    );
  }
  if (recommendation === 'einreichen') {
    return (
      `Einreichen lohnt sich: Die Nettoerstattung von ${refund} übersteigt den entgehenden ` +
      `Vorteil aus erhaltener BRE und Steuerersparnis (${cost}) um ${advantage}.`
    );
  }
  return (
    `Selbst zahlen lohnt sich: Der entgehende Vorteil aus erhaltener BRE und Steuerersparnis ` +
    `(${cost}) übersteigt die Nettoerstattung von ${refund} um ${advantage}.`
  );
}

/**
 * Run the Günstigerprüfung for a single invoice.
 *
 * @throws RangeError if `taxRate` is outside `[0, 1]` or `discountRate ≤ −1`.
 */
export function calculateGCP(input: GCP_Input): GCP_Result {
  const {
    rechnungsBetrag,
    erstattungsBetrag,
    verbleibenderSelbstbehalt,
    breStructure,
    monthlyPremium,
    taxRate,
    discountRate = DEFAULT_DISCOUNT_RATE,
    asOf = new Date(),
  } = input;

  if (!(taxRate >= 0 && taxRate <= 1)) {
    throw new RangeError(`Steuersatz muss zwischen 0 und 1 liegen, war ${taxRate}`);
  }
  if (!(discountRate > -1)) {
    throw new RangeError(`Diskontrate muss größer als -1 sein, war ${discountRate}`);
  }

  // Net refund after the still-open deductible — never negative.
  const refundAfterDeductible = round2(Math.max(0, erstattungsBetrag - verbleibenderSelbstbehalt));

  // BRE forfeited if submitting resets the streak to zero (worst case, design §5.2).
  const currentStreakMonths = getCurrentStreakMonths(breStructure, asOf);
  const projectedBRELoss = getProjectedBRE(breStructure, monthlyPremium, asOf);

  // Discount that loss to today: the refund is paid out at year-end.
  const monthsToYearEnd = monthsUntilYearEnd(asOf);
  const lostBREValue_NPV = round2(
    projectedBRELoss / Math.pow(1 + discountRate / 12, monthsToYearEnd),
  );

  // Tax saved by self-paying (§10 EStG, simplified). Only realised if NOT submitted,
  // so it is part of the cost of submitting — it lowers the benefit of submitting.
  const taxSavingFromSelfPay = round2(rechnungsBetrag * taxRate * TAX_DEDUCTIBLE_SHARE);

  const netBenefitOfSubmitting = round2(
    refundAfterDeductible - lostBREValue_NPV - taxSavingFromSelfPay,
  );
  // Tie (netBenefit === 0) goes to self-pay: preserve the streak when in doubt.
  const recommendation = netBenefitOfSubmitting > 0 ? 'einreichen' : 'selbst_zahlen';
  const costOfSubmitting = round2(lostBREValue_NPV + taxSavingFromSelfPay);

  return {
    recommendation,
    netBenefitOfSubmitting,
    breakdown: {
      refundAfterDeductible,
      currentStreakMonths,
      projectedBRELoss,
      monthsToYearEnd,
      discountRate,
      lostBREValue_NPV,
      taxSavingFromSelfPay,
    },
    explanation: buildExplanation(
      recommendation,
      netBenefitOfSubmitting,
      refundAfterDeductible,
      costOfSubmitting,
    ),
  };
}

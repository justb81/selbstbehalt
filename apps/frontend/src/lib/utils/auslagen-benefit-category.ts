// SPDX-License-Identifier: Apache-2.0
/**
 * Derives the tariff {@link BenefitCategory} for a non-fee-schedule Auslagen-
 * Sammelposition — §9-GOZ `Material-/Laborkosten` or §10-GOÄ `Auslagenersatz`
 * (issue #251). These positions have no Ziffer and therefore no fee-table lookup
 * to draw a `benefitCategory` from, yet they must run through the normal §5.1
 * Erstattungs-Engine pipeline (Quote/Staffel/Limit/Wartezeit) rather than being
 * reimbursed flat. The category is derived **transiently** at calculation time
 * (nothing persisted, no extra user input), mirroring how ordinary positions get
 * their category transiently from the table.
 *
 * Pure and injection-free so it is unit-testable in isolation.
 */
import {
  defaultBenefitCategoryForProvider,
  type BenefitCategory,
  type GoaeCategory,
  type ProviderType,
} from '@selbstbehalt/shared';

/**
 * The fee schedule an Auslagen position belongs to: §9 → GOZ, §10 → GOÄ. GOT
 * (veterinary) is out of scope for this UI (see `SELECTABLE_GOAE_CATEGORIES`),
 * so it is deliberately excluded — an unsupported schedule cannot be passed.
 */
export type AuslagenFeeSchedule = 'GOÄ' | 'GOZ';

/** One invoice position, reduced to what the derivation needs. */
export interface AuslagenDerivationPosition {
  /** `GOÄ`/`GOZ`/`GOT` for honorar positions; a non-fee-schedule category otherwise. */
  goaeCategory: GoaeCategory | null;
  /** Benefit area from the fee-table lookup; `null` for non-fee-schedule / unknown Ziffer. */
  benefitCategory: BenefitCategory | null;
  /** Amount billed for this position in EUR. */
  chargedAmount: number;
}

/**
 * The single benefit category with the strictly largest summed `chargedAmount`,
 * or `null` on an empty map or a tie (Gleichstand) — so the caller falls back.
 */
function dominantCategory(byCategory: Map<BenefitCategory, number>): BenefitCategory | null {
  let best: BenefitCategory | null = null;
  let bestSum = -Infinity;
  let tied = false;
  for (const [category, sum] of byCategory) {
    if (sum > bestSum) {
      best = category;
      bestSum = sum;
      tied = false;
    } else if (sum === bestSum) {
      tied = true;
    }
  }
  return tied ? null : best;
}

/**
 * Derives the benefit category for an Auslagen Sammelposition billed under
 * `feeSchedule`:
 *
 *  1. **Amount-weighted dominance** of the honorar positions of the same
 *     Gebührenordnung (§9-GOZ → GOZ positions, §10-GOÄ → GOÄ positions). A clear
 *     winner (no tie) wins — so a KFO invoice whose GOZ honorar is mostly
 *     `kieferorthopaedie` carries its lab costs under the KFO rule.
 *  2. **Fallback** (no matching honorar positions, or a tie): the whole-invoice
 *     default from the provider type ({@link defaultBenefitCategoryForProvider} —
 *     `kieferorthopaede`→`kieferorthopaedie`, `zahnarzt`→`zahnbehandlung`,
 *     `arzt`→`ambulant`, `krankenhaus`→`stationaer`, else `sonstiges`).
 */
export function deriveAuslagenBenefitCategory(
  positions: AuslagenDerivationPosition[],
  feeSchedule: AuslagenFeeSchedule,
  providerType: ProviderType,
): BenefitCategory {
  const byCategory = new Map<BenefitCategory, number>();
  for (const p of positions) {
    if (p.goaeCategory === feeSchedule && p.benefitCategory) {
      byCategory.set(p.benefitCategory, (byCategory.get(p.benefitCategory) ?? 0) + p.chargedAmount);
    }
  }
  return dominantCategory(byCategory) ?? defaultBenefitCategoryForProvider(providerType);
}

// SPDX-License-Identifier: Apache-2.0
/**
 * Resolving the tariff {@link BenefitCategory} (Leistungsbereich) of an invoice
 * position at save time and at refund time. The whole-invoice provider default and
 * the German display labels live in `@selbstbehalt/shared`
 * ({@link defaultBenefitCategoryForProvider}, {@link BENEFIT_CATEGORY_LABELS}) so the
 * scan/review UI and this wiring stay in sync.
 *
 * Two callers, two situations:
 *  - **Save time** ({@link resolveBenefitCategory}, used by `InvoiceForm`): the full
 *    invoice is in hand. An explicit `benefit_category` on the position — the value
 *    the review's Leistungsbereich picker seeds (fee-table lookup or provider default)
 *    or the user pinned manually — always wins. Otherwise Auslagen Sammelpositionen
 *    derive it from the honorar positions (issue #251) and a bare fee-schedule
 *    position falls back to the provider default. The resolved value is persisted.
 *  - **Refund time** ({@link benefitCategoryForPosition}, used by `InvoiceStatusFlow`):
 *    the persisted position already carries the resolved `benefit_category`, so it is
 *    used directly. Legacy rows that predate the stored column fall back to the
 *    invoice's provider type — precise for every newly saved invoice, coarse only for
 *    old data.
 *
 * Pure and injection-free so both helpers are unit-testable in isolation.
 */
import {
  defaultBenefitCategoryForProvider,
  type BenefitCategory,
  type GoaeCategory,
  type ProviderType,
} from '@selbstbehalt/shared';

import {
  deriveAuslagenBenefitCategory,
  type AuslagenDerivationPosition,
} from './auslagen-benefit-category';

/** The minimum a position must expose to resolve its benefit category at save time. */
export interface ReviewPositionLike {
  /** Fee schedule / non-fee-schedule category. */
  goae_category?: GoaeCategory | null;
  /** Benefit area seeded by the review (fee-table lookup / provider default) or pinned by the user. */
  benefit_category?: BenefitCategory | null;
}

/**
 * Resolves the benefit category fed to the Erstattungs-Engine (and persisted) for one
 * position at save time. An explicit `benefit_category` (the review's seeded value or a
 * manual override) always wins. The §9-GOZ `Material-/Laborkosten` and §10-GOÄ
 * `Auslagenersatz` Sammelpositionen have no fee-table lookup, so their category is
 * derived from the invoice's honorar positions — amount-weighted dominance within the
 * same Gebührenordnung. A bare fee-schedule position falls back to the whole-invoice
 * provider default.
 */
export function resolveBenefitCategory(
  position: ReviewPositionLike,
  honorarPositions: AuslagenDerivationPosition[],
  providerType: ProviderType,
): BenefitCategory {
  if (position.benefit_category) return position.benefit_category;
  if (position.goae_category === 'Material-/Laborkosten') {
    return deriveAuslagenBenefitCategory(honorarPositions, 'GOZ', providerType);
  }
  if (position.goae_category === 'Auslagenersatz') {
    return deriveAuslagenBenefitCategory(honorarPositions, 'GOÄ', providerType);
  }
  return defaultBenefitCategoryForProvider(providerType);
}

/** The minimum a persisted position must expose to be bucketed for refund entry. */
export interface PersistedPositionLike {
  benefit_category?: BenefitCategory | null;
}

/**
 * The benefit category a persisted position is grouped under for per-category refund
 * entry. Uses the stored `benefit_category`; for legacy rows without one, falls back to
 * the invoice's provider type ({@link defaultBenefitCategoryForProvider}), then
 * `sonstiges` when the provider type is unknown.
 */
export function benefitCategoryForPosition(
  position: PersistedPositionLike,
  providerType: ProviderType | null | undefined,
): BenefitCategory {
  return (
    position.benefit_category ??
    (providerType ? defaultBenefitCategoryForProvider(providerType) : 'sonstiges')
  );
}

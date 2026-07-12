// SPDX-License-Identifier: Apache-2.0
/**
 * Resolving the tariff {@link BenefitCategory} (Leistungsbereich) of an invoice
 * position, plus its German display label.
 *
 * Two callers, two situations:
 *  - **Save time** ({@link resolveBenefitCategory}, used by `InvoiceForm`): the full
 *    invoice is in hand, so fee-schedule positions take their looked-up
 *    `benefit_category` and Auslagen Sammelpositionen derive it from the honorar
 *    positions (issue #251). The resolved value is then persisted on the position.
 *  - **Refund time** ({@link benefitCategoryForPosition}, used by `InvoiceStatusFlow`):
 *    the persisted position already carries the resolved `benefit_category`, so it is
 *    used directly. Legacy rows that predate the stored column fall back to the
 *    invoice's provider type — precise for every newly saved invoice, coarse only for
 *    old data.
 *
 * Pure and injection-free so both helpers are unit-testable in isolation.
 */
import type { BenefitCategory, GoaeCategory, ProviderType } from '@selbstbehalt/shared';

import {
  deriveAuslagenBenefitCategory,
  PROVIDER_TYPE_BENEFIT,
  type AuslagenDerivationPosition,
} from './auslagen-benefit-category';

/** German display names for the tariff benefit areas (`benefitCategoryValues`). */
export const BENEFIT_CATEGORY_LABEL: Record<BenefitCategory, string> = {
  ambulant: 'Ambulant',
  stationaer: 'Stationär',
  zahnbehandlung: 'Zahnbehandlung',
  zahnersatz: 'Zahnersatz',
  kieferorthopaedie: 'Kieferorthopädie',
  heilmittel: 'Heilmittel',
  hilfsmittel: 'Hilfsmittel',
  wahlleistung: 'Wahlleistung',
  sonstiges: 'Sonstiges',
};

/** The minimum a position must expose to resolve its benefit category at save time. */
export interface ReviewPositionLike {
  /** Fee schedule / non-fee-schedule category. */
  goae_category?: GoaeCategory | null;
  /** Benefit area from the fee-table lookup; `null` for Auslagen / unknown Ziffer. */
  benefit_category?: BenefitCategory | null;
}

/**
 * Resolves the benefit category fed to the Erstattungs-Engine (and persisted) for one
 * position at save time. Fee-schedule positions use their looked-up `benefit_category`.
 * The §9-GOZ `Material-/Laborkosten` and §10-GOÄ `Auslagenersatz` Sammelpositionen have
 * no lookup, so their category is derived from the invoice's honorar positions —
 * amount-weighted dominance within the same Gebührenordnung, falling back to the
 * provider type.
 */
export function resolveBenefitCategory(
  position: ReviewPositionLike,
  honorarPositions: AuslagenDerivationPosition[],
  providerType: ProviderType,
): BenefitCategory {
  if (position.goae_category === 'Material-/Laborkosten') {
    return deriveAuslagenBenefitCategory(honorarPositions, 'GOZ', providerType);
  }
  if (position.goae_category === 'Auslagenersatz') {
    return deriveAuslagenBenefitCategory(honorarPositions, 'GOÄ', providerType);
  }
  return position.benefit_category ?? 'sonstiges';
}

/** The minimum a persisted position must expose to be bucketed for refund entry. */
export interface PersistedPositionLike {
  benefit_category?: BenefitCategory | null;
}

/**
 * The benefit category a persisted position is grouped under for per-category refund
 * entry. Uses the stored `benefit_category`; for legacy rows without one, falls back to
 * the invoice's provider type ({@link PROVIDER_TYPE_BENEFIT}), then `sonstiges`.
 */
export function benefitCategoryForPosition(
  position: PersistedPositionLike,
  providerType: ProviderType | null | undefined,
): BenefitCategory {
  return (
    position.benefit_category ??
    (providerType ? PROVIDER_TYPE_BENEFIT[providerType] : undefined) ??
    'sonstiges'
  );
}

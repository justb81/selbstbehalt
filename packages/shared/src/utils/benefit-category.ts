// SPDX-License-Identifier: Apache-2.0
/**
 * Shared helpers for the tariff {@link BenefitCategory} (Leistungsbereich): the
 * whole-invoice default derived from the provider type, and the German display
 * labels. Kept in `@selbstbehalt/shared` so both the scan/review UI
 * (`@selbstbehalt/medic-invoice-check`'s `InvoiceReview`, the per-position picker)
 * and the reimbursement wiring in `apps/frontend` derive and label categories the
 * same way, without duplicating the mapping. See design §5.1.
 */
import type { BenefitCategory, ProviderType } from '../enums.js';

/**
 * Provider type → its default benefit area, used as the whole-invoice fallback when
 * a position has no schedule-derivable `benefitCategory` from the fee table — a
 * Zahnarzt invoice defaults to `zahnbehandlung`, a Kieferorthopäde to
 * `kieferorthopaedie`, an Arzt to `ambulant`, a Krankenhaus to `stationaer`.
 * `sonstiges` (and anything unmapped) falls through to the `sonstiges` category.
 */
const PROVIDER_TYPE_BENEFIT: Partial<Record<ProviderType, BenefitCategory>> = {
  kieferorthopaede: 'kieferorthopaedie',
  zahnarzt: 'zahnbehandlung',
  arzt: 'ambulant',
  krankenhaus: 'stationaer',
};

/**
 * The whole-invoice default {@link BenefitCategory} for `providerType`, falling
 * back to `sonstiges` for `sonstiges`/unmapped provider types.
 */
export function defaultBenefitCategoryForProvider(providerType: ProviderType): BenefitCategory {
  return PROVIDER_TYPE_BENEFIT[providerType] ?? 'sonstiges';
}

/** German display names for the tariff benefit areas (`benefitCategoryValues`). */
export const BENEFIT_CATEGORY_LABELS: Record<BenefitCategory, string> = {
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

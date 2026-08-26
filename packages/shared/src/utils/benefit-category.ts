// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
/**
 * Shared helpers for the provider type and the tariff {@link BenefitCategory}
 * (Leistungsbereich): the whole-invoice default derived from the provider type, and
 * the German display labels for both. Kept in `@selbstbehalt/shared` so both the
 * scan/review UI (`@selbstbehalt/medic-invoice-check`'s `InvoiceReview`, the
 * per-position picker) and the reimbursement wiring in `apps/frontend` derive and
 * label categories the same way, without duplicating the mapping. See architecture §8.4.
 */
import type { BenefitCategory, ProviderType } from '../enums.js';

/**
 * Provider type → its default benefit area, used as the whole-invoice fallback when
 * a position has no schedule-derivable `benefitCategory` from the fee table — a
 * Zahnarzt invoice defaults to `zahnbehandlung`, a Kieferorthopäde to
 * `kieferorthopaedie`, an Arzt to `ambulant`, a Krankenhaus to `stationaer`. The two
 * dispensing providers carry their own areas: an Apotheke bills Arzneimittel, which
 * belong to the ambulante Heilbehandlung, a Sanitätshaus bills `hilfsmittel`.
 * `sonstiges` (and anything unmapped) falls through to the `sonstiges` category.
 */
const PROVIDER_TYPE_BENEFIT: Partial<Record<ProviderType, BenefitCategory>> = {
  kieferorthopaede: 'kieferorthopaedie',
  zahnarzt: 'zahnbehandlung',
  arzt: 'ambulant',
  krankenhaus: 'stationaer',
  apotheke: 'ambulant',
  sanitaetshaus: 'hilfsmittel',
};

/**
 * The whole-invoice default {@link BenefitCategory} for `providerType`, falling
 * back to `sonstiges` for `sonstiges`/unmapped provider types.
 */
export function defaultBenefitCategoryForProvider(providerType: ProviderType): BenefitCategory {
  return PROVIDER_TYPE_BENEFIT[providerType] ?? 'sonstiges';
}

/** German display names for the provider types (`providerTypeValues`). */
export const PROVIDER_TYPE_LABELS: Record<ProviderType, string> = {
  arzt: 'Arzt',
  zahnarzt: 'Zahnarzt',
  kieferorthopaede: 'Kieferorthopäde',
  krankenhaus: 'Krankenhaus',
  apotheke: 'Apotheke',
  sanitaetshaus: 'Sanitätshaus',
  sonstiges: 'Sonstiges',
};

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

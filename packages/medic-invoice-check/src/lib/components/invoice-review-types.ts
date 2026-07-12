// SPDX-License-Identifier: Apache-2.0
import type { BenefitCategory, GoaeCategory } from '@selbstbehalt/shared';

/**
 * One editable invoice line in the review view ({@link InvoiceReview}).
 *
 * This is the reduced, tariff-agnostic shape (see issue #169): it carries the
 * §5 validation result (`is_valid`/`flag_reason`) but deliberately **no**
 * `eligible_amount`/Erstattungsbetrag — that is tariff-dependent and computed by
 * the consuming app (apps/frontend's InvoiceForm via `erstattungs-engine.ts`),
 * not here. `benefit_category` is the schedule-derivable benefit area from the
 * fee-table lookup; it is never displayed but is exposed so the parent can feed
 * its tariff-based Erstattung without redoing the lookup.
 */
export type ReviewPositionRow = {
  goae_number: string;
  goae_category: GoaeCategory | null;
  /** Anzahl. */
  quantity: number;
  /** Leistungsdatum (ISO YYYY-MM-DD) or '' (defaults to the invoice date on save). */
  treatment_date: string;
  description: string;
  multiplier: number;
  base_amount: number;
  charged_amount: number;
  /** §5 / lookup validity: false when the line is flagged, null before validation. */
  is_valid: boolean | null;
  flag_reason: string | null;
  /** OCR confidence carried per row (uncertainty markers survive reorder/removal). */
  confidence: number;
  /**
   * Tarif-Leistungsbereich dieser Position, Quelle für die tarifbasierte
   * Erstattung des aufrufenden Apps (`eligible_amount`). Standard aus dem
   * Fee-Table-Lookup (`FeeEntry.benefitCategory`), sonst dem rechnungsweiten
   * Default aus `providerType`; null nur, solange nichts abgeleitet werden
   * konnte (z. B. Auslagen-Sammelpositionen, vom Aufrufer abgeleitet). Wird nur
   * angezeigt/bearbeitet, wenn {@link InvoiceReview} mit `showBenefitCategory`
   * läuft.
   */
  benefit_category: BenefitCategory | null;
  /**
   * True, sobald der Nutzer die {@link benefit_category} im
   * Leistungsbereich-Picker manuell gesetzt hat (oder sie aus gespeicherten
   * Daten übernommen wurde). Verhindert, dass die automatische Neuprüfung die
   * Kategorie wieder aus dem Gebührenverzeichnis überschreibt. Rein transient
   * (UI-State) — nicht Teil der gespeicherten Daten.
   */
  benefit_category_overridden?: boolean;
};

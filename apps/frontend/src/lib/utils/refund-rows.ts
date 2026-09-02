// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
/**
 * Row models behind the refund-capture form (`InvoiceRefundForm`).
 *
 * The insurer's Leistungsabrechnung usually reports **one amount per Leistungsbereich**,
 * while the data model stores a refund per position. The form therefore offers two entry
 * modes over the same store — „je Kategorie" (default) and „je Position" — and this module
 * holds the pure part of both: building the pre-filled rows and turning whichever mode is
 * active back into the per-position payload (`distributeRefundByCategory` does the actual
 * cent-exact spreading).
 *
 * Kept free of component state so both directions are unit-testable in isolation.
 */
import {
  BENEFIT_CATEGORY_LABELS,
  roundCents,
  type BenefitCategory,
  type InvoicePosition,
  type InvoiceWithPositions,
} from '@selbstbehalt/shared';
import { benefitCategoryForPosition } from './benefit-category';
import { distributeRefundByCategory } from './refund-distribution';

/** Which of the two entry modes the form is currently in. */
export type RefundEntryMode = 'category' | 'position';

/** Whether the form captures a first refund or corrects a stored one. */
export type RefundFormMode = 'create' | 'edit';

/** One editable line in „je Position" mode. */
export type RefundRow = {
  id: string;
  goae_number: string;
  description: string | null;
  charged_amount: number;
  eligible_amount: number | null;
  refund_amount: number;
};

/** One editable line in „je Kategorie" mode: a Leistungsbereich with its position sums. */
export type CategoryRefundRow = {
  category: BenefitCategory;
  label: string;
  charged_amount: number;
  eligible_amount: number | null;
  refund_amount: number;
};

/** Default refund for one position: the stored amount when editing, else the estimate. */
export function defaultPositionRefund(p: InvoicePosition, mode: RefundFormMode): number {
  return mode === 'edit'
    ? (p.refund_amount ?? p.eligible_amount ?? p.charged_amount)
    : (p.eligible_amount ?? p.charged_amount);
}

/** The per-position rows, pre-filled per {@link defaultPositionRefund}. */
export function buildRefundRows(invoice: InvoiceWithPositions, mode: RefundFormMode): RefundRow[] {
  return invoice.positions.map((p) => ({
    id: p.id,
    goae_number: p.goae_number,
    description: p.description ?? null,
    charged_amount: p.charged_amount,
    eligible_amount: p.eligible_amount ?? null,
    refund_amount: defaultPositionRefund(p, mode),
  }));
}

/**
 * Groups the invoice's positions by Leistungsbereich into the per-category rows, in order
 * of first appearance. A category's `eligible_amount` stays `null` while no position in it
 * carries one — „unbekannt" is not `0` (see CLAUDE.md, issue #381).
 */
export function buildCategoryRows(
  invoice: InvoiceWithPositions,
  mode: RefundFormMode,
): CategoryRefundRow[] {
  type Acc = { charged: number; eligible: number; hasEligible: boolean; refund: number };
  const order: BenefitCategory[] = [];
  // Plain object accumulator (not a Map) — SvelteMap would be reactive overkill for
  // this transient grouping, and a mutated built-in Map trips svelte/prefer-svelte-reactivity.
  const acc: Partial<Record<BenefitCategory, Acc>> = {};
  for (const p of invoice.positions) {
    const category = benefitCategoryForPosition(p, invoice.provider_type);
    let entry = acc[category];
    if (!entry) {
      entry = { charged: 0, eligible: 0, hasEligible: false, refund: 0 };
      acc[category] = entry;
      order.push(category);
    }
    entry.charged += p.charged_amount;
    if (p.eligible_amount != null) {
      entry.eligible += p.eligible_amount;
      entry.hasEligible = true;
    }
    entry.refund += defaultPositionRefund(p, mode);
  }
  return order.map((category) => {
    const entry = acc[category]!;
    return {
      category,
      label: BENEFIT_CATEGORY_LABELS[category],
      charged_amount: roundCents(entry.charged),
      eligible_amount: entry.hasEligible ? roundCents(entry.eligible) : null,
      refund_amount: roundCents(entry.refund),
    };
  });
}

/**
 * The per-position `PUT /:id/refund` payload for the active entry mode: the rows verbatim
 * in „je Position", the distributed category amounts in „je Kategorie". Amounts come from
 * number inputs, so they are coerced — an emptied field counts as an Ablehnung (`0`).
 */
export function refundPositionsPayload(
  invoice: InvoiceWithPositions,
  entryMode: RefundEntryMode,
  rows: RefundRow[],
  categoryRows: CategoryRefundRow[],
): { id: string; refund_amount: number }[] {
  if (entryMode === 'position') {
    return rows.map((r) => ({ id: r.id, refund_amount: r.refund_amount }));
  }
  const amountByCategory = new Map<BenefitCategory, number>(
    categoryRows.map((r) => [r.category, Number(r.refund_amount) || 0]),
  );
  const distributed = distributeRefundByCategory(
    invoice.positions.map((p) => ({
      id: p.id,
      category: benefitCategoryForPosition(p, invoice.provider_type),
      eligible_amount: p.eligible_amount,
      charged_amount: p.charged_amount,
    })),
    amountByCategory,
  );
  return invoice.positions.map((p) => ({ id: p.id, refund_amount: distributed.get(p.id) ?? 0 }));
}

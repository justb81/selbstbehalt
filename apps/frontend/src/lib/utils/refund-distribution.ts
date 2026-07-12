// SPDX-License-Identifier: Apache-2.0
/**
 * Distributing an insurer's per-category refund onto individual invoice positions.
 *
 * PKV Leistungsabrechnungen usually report **one refunded amount per Leistungsbereich**
 * (Zahnbehandlung, ambulant, Kieferorthopädie, …), not per line. The data model however
 * stores the actual refund per position (`invoice_positions.refund_amount`) because the
 * Leistungsjahr — which drives the Günstigerprüfung and BRE — hangs on each position's
 * `treatment_date`. This helper bridges the two: it spreads each category's entered
 * amount across that category's positions proportionally, the inverse of the estimate
 * distribution in `erstattungs-engine.ts`.
 *
 * Weighting: proportional to each position's `eligible_amount` (the tariff estimate) when
 * the category has a positive eligible sum, otherwise to `charged_amount`; if all weights
 * are zero the amount is split evenly. Cent rounding of the parts is corrected so the sum
 * of a category's parts equals the entered amount exactly — the residual goes to the
 * position with the largest weight.
 *
 * Pure and injection-free so it is unit-testable in isolation.
 */
import { roundCents, type BenefitCategory } from '@selbstbehalt/shared';

/** One invoice position reduced to what the distribution needs. */
export interface DistributablePosition {
  id: string;
  /** Tarif-Leistungsbereich this position is refunded under. */
  category: BenefitCategory;
  /** Erstattungsfähiger Betrag (tariff estimate); primary distribution weight. */
  eligible_amount: number | null | undefined;
  /** Gesamtbetrag; fallback weight when no eligible amount is available. */
  charged_amount: number;
}

/**
 * Spreads each category's entered refund amount across its positions. Returns a map from
 * position id to that position's `refund_amount`. Positions whose category has no entry in
 * `amountByCategory` are omitted (the caller decides what an un-entered category means).
 * A category amount of `0` (Ablehnung) yields `0` for every position in it.
 */
export function distributeRefundByCategory(
  positions: DistributablePosition[],
  amountByCategory: Map<BenefitCategory, number>,
): Map<string, number> {
  const groups = new Map<BenefitCategory, DistributablePosition[]>();
  for (const p of positions) {
    const group = groups.get(p.category) ?? [];
    group.push(p);
    groups.set(p.category, group);
  }

  const result = new Map<string, number>();
  for (const [category, group] of groups) {
    const entered = amountByCategory.get(category);
    if (entered === undefined) continue;
    distributeInto(result, group, roundCents(entered));
  }
  return result;
}

function distributeInto(
  result: Map<string, number>,
  group: DistributablePosition[],
  total: number,
): void {
  const eligibleWeight = (p: DistributablePosition) =>
    typeof p.eligible_amount === 'number' && p.eligible_amount > 0 ? p.eligible_amount : 0;
  const eligibleSum = group.reduce((s, p) => s + eligibleWeight(p), 0);

  // Weights: eligible amounts if any are positive, else charged amounts, else even split.
  const rawWeights = group.map((p) =>
    eligibleSum > 0 ? eligibleWeight(p) : Math.max(p.charged_amount, 0),
  );
  const rawSum = rawWeights.reduce((a, b) => a + b, 0);
  const weights = rawSum > 0 ? rawWeights : group.map(() => 1);
  const weightSum = rawSum > 0 ? rawSum : group.length;

  let allocated = 0;
  const parts = weights.map((w) => {
    const part = roundCents((total * w) / weightSum);
    allocated += part;
    return part;
  });

  // Push the cent residual onto the largest-weight position so Σ parts === total exactly.
  const residual = roundCents(total - allocated);
  if (residual !== 0 && parts.length > 0) {
    let maxIdx = 0;
    for (let i = 1; i < weights.length; i++) {
      if (weights[i]! > weights[maxIdx]!) maxIdx = i;
    }
    parts[maxIdx] = roundCents(parts[maxIdx]! + residual);
  }

  group.forEach((p, i) => result.set(p.id, parts[i]!));
}

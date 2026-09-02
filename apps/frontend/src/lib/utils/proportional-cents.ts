// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
/**
 * Splitting a Euro amount across weighted parts without losing cents.
 *
 * Rounding each part on its own drifts away from the total (3 × 33,333… → 99,99 instead of
 * 100,00). Since both the tariff estimate (`erstattungs-engine.ts`) and the entered insurer
 * refund (`refund-distribution.ts`) are persisted per position but displayed per
 * Leistungsbereich, that drift would make the shown category amount differ from the stored
 * sum — and feed through `invoice.eligible_amount` into R_Y and the Günstigerprüfung.
 * The residual is therefore pushed onto the largest-weight part (largest remainder), so
 * Σ parts === total exactly.
 */
import { roundCents } from '@selbstbehalt/shared';

/**
 * Distributes `total` proportionally to `weights`, rounded to cents, with the residual
 * added to the largest-weight part. Non-positive weights are treated as zero; if all
 * weights are zero the amount is split evenly.
 */
export function distributeCentsProportionally(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];

  const sanitized = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const rawSum = sanitized.reduce((a, b) => a + b, 0);
  const effective = rawSum > 0 ? sanitized : sanitized.map(() => 1);
  const weightSum = rawSum > 0 ? rawSum : effective.length;

  let allocated = 0;
  const parts = effective.map((w) => {
    const part = roundCents((total * w) / weightSum);
    allocated += part;
    return part;
  });

  const residual = roundCents(total - allocated);
  if (residual !== 0) {
    let maxIdx = 0;
    for (let i = 1; i < effective.length; i++) {
      if (effective[i]! > effective[maxIdx]!) maxIdx = i;
    }
    parts[maxIdx] = roundCents(parts[maxIdx]! + residual);
  }
  return parts;
}

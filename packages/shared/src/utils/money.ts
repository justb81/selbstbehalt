// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
//
// Shared money helpers, next to the `money` schema (common.ts). Centralising
// these stops the rounding/formatting logic from drifting across the backend,
// the domain engines and the UI (one place to fix float-drift or a locale tweak).

/**
 * Rounds a EUR amount to whole cents, matching the two-decimal rule the `money`
 * schema enforces and avoiding binary-float display noise.
 */
export function roundCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * Formats a EUR amount as a de-DE currency string, e.g. `1.234,56 €`.
 *
 * `null`/`undefined` mean **unknown** — a value that could not be determined or
 * failed to load — and render as `—`, mirroring {@link formatDate}. A genuine
 * `0` still formats as `0,00 €`: "nothing" and "unknown" are never conflated,
 * the same rule the model already holds for `eligible_amount` (issue #381).
 */
export function formatEur(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  return amount.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
//
// Shared number-display helpers, next to formatEur (money.ts). `toFixed()` is
// locale-blind and prints `2.30` in a de-DE UI that otherwise reads `2,30 €`;
// these go through `Intl.NumberFormat` so every displayed number uses the
// German decimal comma.

const formatters = new Map<string, Intl.NumberFormat>();

/** Returns a cached de-DE formatter — building one per call is comparatively expensive. */
function formatter(style: 'decimal' | 'percent', fractionDigits: number): Intl.NumberFormat {
  const key = `${style}:${fractionDigits}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat('de-DE', {
      style,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
    formatters.set(key, f);
  }
  return f;
}

/**
 * Formats a plain number with a fixed number of fraction digits in de-DE,
 * e.g. a Steigerungsfaktor `2.3` → `2,30`. `null`/`undefined` (unknown) render
 * as `—`, mirroring {@link formatEur}; a genuine `0` still formats as `0,00`.
 */
export function formatDecimal(value: number | null | undefined, fractionDigits = 2): string {
  if (value === null || value === undefined) return '—';
  return formatter('decimal', fractionDigits).format(value);
}

/**
 * Formats a **rate** (`0.03` = 3 %) as a de-DE percentage, e.g. `3,0 %`.
 * `null`/`undefined` (unknown) render as `—`.
 */
export function formatPercent(rate: number | null | undefined, fractionDigits = 1): string {
  if (rate === null || rate === undefined) return '—';
  return formatter('percent', fractionDigits).format(rate);
}

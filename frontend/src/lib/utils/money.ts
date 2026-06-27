// SPDX-License-Identifier: Apache-2.0
/**
 * Formats an amount in EUR using German locale conventions (e.g. "1.234,56 €").
 *
 * Money throughout selbstbehalt is stored as a plain number in EUR
 * (see docs/design.md §3). This helper is the single place that renders it.
 */
export function formatEur(amount: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
  }).format(amount);
}

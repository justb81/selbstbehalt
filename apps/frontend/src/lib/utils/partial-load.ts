// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
/**
 * Helpers for loading a list of independent resources without hiding the ones
 * that failed (issue #381).
 *
 * Pages used to fan out with `Promise.all(...)` — where one failure loses every
 * sibling — or with `.catch(() => null)`, which loses the failure instead. Both
 * end up rendering "unknown" as "nothing": a missing roll-up became a green
 * Ampel, a missing year became `0,00 €`. `Promise.allSettled` plus these two
 * functions keeps the successes *and* names the gaps.
 */

/**
 * The fulfilled values of `Promise.allSettled`, in input order, with `null`
 * where a task rejected. Index correspondence with the input is the contract —
 * callers zip the result back onto the items they asked for.
 */
export function settledValues<T>(results: readonly PromiseSettledResult<T>[]): (T | null)[] {
  return results.map((result) => (result.status === 'fulfilled' ? result.value : null));
}

/**
 * The tuple counterpart of {@link settledValues}, for a `Promise.allSettled` over
 * a fixed set of *differently typed* reads (e.g. contract + persons + invoices).
 * Each slot keeps its own type and becomes `null` when that read rejected.
 */
export function settledTuple<T extends readonly unknown[]>(results: {
  readonly [K in keyof T]: PromiseSettledResult<T[K]>;
}): { [K in keyof T]: T[K] | null } {
  return results.map((result) => (result.status === 'fulfilled' ? result.value : null)) as {
    [K in keyof T]: T[K] | null;
  };
}

/**
 * German notice for "k of n could not be loaded", or `null` when nothing failed
 * (so it doubles as the render guard).
 */
export function partialFailureMessage(
  failed: number,
  total: number,
  subject: string,
): string | null {
  if (failed <= 0 || total <= 0) return null;
  return `${subject}: ${failed} von ${total} konnten nicht geladen werden.`;
}

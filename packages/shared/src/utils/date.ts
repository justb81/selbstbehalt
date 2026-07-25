// SPDX-License-Identifier: Apache-2.0
//
// Shared date-display helper, next to formatEur (money.ts). ISO dates are stored
// as YYYY-MM-DD; the UI shows the German DD.MM.YYYY. Pure string reformat keeps
// it timezone-safe (no Date object) and locale-consistent with formatEur.

/** Formats an ISO date (YYYY-MM-DD) as a de-DE date string, e.g. `16.03.2026`. Empty/invalid → `—`. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/**
 * Formats a `Date` as the stored `YYYY-MM-DD` — the ISO counterpart to
 * {@link formatDate}. Reads the **local** calendar day (not the UTC instant), so
 * it round-trips with `toCalendarDate` regardless of time zone.
 */
export function toIsoDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

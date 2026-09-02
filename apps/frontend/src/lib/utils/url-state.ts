// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
/**
 * URL-synchronisierter Filterzustand (issue #461).
 *
 * Reine Funktionen — keine Abhängigkeit auf `$app/navigation`/`$app/state`, damit
 * sie unit-testbar bleiben. Aufrufmuster in einer Komponente:
 *
 * ```ts
 * const year = $derived(readParam(page.url, 'year', years) ?? currentYear);
 * goto(withParam(page.url, 'year', y), { replaceState: true, keepFocus: true, noScroll: true });
 * ```
 *
 * `replaceState`, weil ein Filterwechsel kein History-Eintrag ist: Zurück soll
 * auf die vorige *Seite* führen, nicht durch die Filterhistorie zurückspulen.
 */

/**
 * Liest einen Query-Parameter. Fehlt er, ist er leer oder — bei gesetzter
 * `allowed`-Liste — kein erlaubter Wert, ist das Ergebnis `null`; der Aufrufer
 * fällt damit auf seinen Default zurück.
 */
export function readParam<T extends string>(
  url: URL,
  key: string,
  allowed?: readonly T[],
): T | null {
  const raw = url.searchParams.get(key);
  if (raw === null || raw === '') return null;
  if (allowed && !allowed.includes(raw as T)) return null;
  return raw as T;
}

/**
 * Wie {@link readParam}, nur für numerische Parameter (Jahr): nicht-ganzzahlige
 * oder nicht erlaubte Werte ergeben `null`.
 */
export function readNumberParam(url: URL, key: string, allowed?: readonly number[]): number | null {
  const raw = readParam(url, key);
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isInteger(value)) return null;
  if (allowed && !allowed.includes(value)) return null;
  return value;
}

/**
 * Der Ziel-Pfad (`pathname` + `search`) mit `key` auf `value` gesetzt. `null`,
 * `undefined` und der leere String entfernen den Key, statt ihn leer zu
 * hinterlassen — eine URL ohne Filter ist der kanonische „kein Filter"-Zustand.
 * Die übrigen Parameter bleiben in ihrer Reihenfolge erhalten.
 */
export function withParam(
  url: URL,
  key: string,
  value: string | number | null | undefined,
): string {
  const params = new URLSearchParams(url.searchParams);
  const next = value === null || value === undefined ? '' : String(value);
  if (next === '') params.delete(key);
  else params.set(key, next);
  const search = params.toString();
  return search === '' ? url.pathname : `${url.pathname}?${search}`;
}

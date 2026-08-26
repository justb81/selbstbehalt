// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
//
// The one place that decides how a versicherte Person is named in the UI.

/**
 * The fields a label may be derived from. Kept structural (rather than a
 * `Pick<InsuredPerson, …>`) so callers holding a partially built row — a form
 * draft, a test fixture — can label it too.
 */
export interface InsuredPersonLabelSource {
  person_name?: string | null;
  tariff_name?: string | null;
  kvnr?: string | null;
}

/**
 * Display name of a versicherte Person: her name, as joined from `persons`.
 *
 * Tariff and KVNR are fallbacks only, for rows read before the join existed or
 * built client-side — a tariff names a contract, not a person, and is identical
 * for siblings on the same tariff (#351, #358). The last resort is the generic
 * term, never „Unbekannt": the person is known, only unnamed in this payload.
 */
export function insuredPersonLabel(insuredPerson: InsuredPersonLabelSource): string {
  return (
    insuredPerson.person_name?.trim() ||
    insuredPerson.tariff_name?.trim() ||
    insuredPerson.kvnr?.trim() ||
    'Versicherte Person'
  );
}

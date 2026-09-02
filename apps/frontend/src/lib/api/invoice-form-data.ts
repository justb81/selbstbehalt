// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
//
// The reads `InvoiceForm` needs beyond the invoice itself — shared by the capture
// page (/invoices/new), the edit page (/invoices/[id]/edit) and the detail view,
// which all assemble the same two things:
//
//   - the selectable versicherte Personen, each labelled via `insuredPersonLabel`
//     (#358) and carrying the natural person's birth date (age-bound `limits`,
//     §8.4), and
//   - the person's already-captured invoices *with positions*, the volume a tariff
//     cap that spans invoices is measured against (issue #370).
//
// Kept next to the typed client rather than in lib/utils, which holds pure domain
// helpers with no I/O.

import {
  insuredPersonLabel,
  type InsuredPerson,
  type InvoiceWithPositions,
} from '@selbstbehalt/shared';

import { api } from './index.js';

/** One entry of `InvoiceForm`'s `insuredOptions`. */
export interface InsuredOption {
  id: string;
  label: string;
  insuredPerson: InsuredPerson;
  /** `persons.birth_date` of the natural person behind the cover; `null` when unknown. */
  birthDate: string | null;
}

/** Every versicherte Person across all contracts, labelled `Name · Versicherer` (#358). */
export async function loadInsuredOptions(): Promise<InsuredOption[]> {
  // Three flat reads — the versicherte Personen used to be gathered with one
  // request per contract (#463); the insurer name is matched client-side.
  const [contracts, persons, insured] = await Promise.all([
    api.contracts.list(),
    api.persons.list(),
    api.insured.listAll(),
  ]);
  const birthDates = new Map(persons.map((p) => [p.id, p.birth_date ?? null]));
  const insurerById = new Map(contracts.map((c) => [c.id, c.insurer_name]));
  return insured.map((ip) => {
    const insurer = insurerById.get(ip.contract_id);
    return {
      id: ip.id,
      label: insurer ? `${insuredPersonLabel(ip)} · ${insurer}` : insuredPersonLabel(ip),
      insuredPerson: ip,
      birthDate: birthDates.get(ip.person_id) ?? null,
    };
  });
}

/**
 * All invoices of one insured person, positions included — in a single request via
 * `?include=positions` (#463). It used to be one `invoices.get` per invoice, because
 * the plain list omits the line items the tariff caps are measured against.
 */
export function loadInvoiceHistory(insuredPersonId: string): Promise<InvoiceWithPositions[]> {
  return api.invoices.listWithPositions({ insured_person_id: insuredPersonId });
}

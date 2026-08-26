// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
//
// The reads `InvoiceForm` needs beyond the invoice itself — shared by the capture
// page (/invoices/new), the edit page (/invoices/[id]/edit) and the detail view,
// which all assemble the same two things:
//
//   - the selectable versicherte Personen, each with its tariff and the natural
//     person's birth date (age-bound `limits`, §8.4), and
//   - the person's already-captured invoices *with positions*, the volume a tariff
//     cap that spans invoices is measured against (issue #370).
//
// Kept next to the typed client rather than in lib/utils, which holds pure domain
// helpers with no I/O.

import type { InsuredPerson, InvoiceWithPositions } from '@selbstbehalt/shared';

import { api } from './index.js';

/** One entry of `InvoiceForm`'s `insuredOptions`. */
export interface InsuredOption {
  id: string;
  label: string;
  insuredPerson: InsuredPerson;
  /** `persons.birth_date` of the natural person behind the cover; `null` when unknown. */
  birthDate: string | null;
}

/** Every versicherte Person across all contracts, labelled `Versicherer · Tarif`. */
export async function loadInsuredOptions(): Promise<InsuredOption[]> {
  const [contracts, persons] = await Promise.all([api.contracts.list(), api.persons.list()]);
  const birthDates = new Map(persons.map((p) => [p.id, p.birth_date ?? null]));
  const lists = await Promise.all(
    contracts.map(async (contract) => {
      const insured = await api.insured.list(contract.id);
      return insured.map((ip) => ({
        id: ip.id,
        label: `${contract.insurer_name} · ${ip.tariff_name ?? ip.kvnr ?? 'Tarif'}`,
        insuredPerson: ip,
        birthDate: birthDates.get(ip.person_id) ?? null,
      }));
    }),
  );
  return lists.flat();
}

/**
 * All invoices of one insured person, positions included. `GET /api/invoices` returns
 * the bare invoice shape, so each one is fetched individually.
 */
export async function loadInvoiceHistory(insuredPersonId: string): Promise<InvoiceWithPositions[]> {
  const list = await api.invoices.list({ insured_person_id: insuredPersonId });
  return Promise.all(list.map((invoice) => api.invoices.get(invoice.id)));
}

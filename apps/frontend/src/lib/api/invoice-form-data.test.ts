// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted so the vi.mock factory (which runs before the module body) can close
// over the same spies these tests assert on.
const { contracts, personsList, insuredList, invoicesList, invoicesGet } = vi.hoisted(() => ({
  contracts: vi.fn(),
  personsList: vi.fn(),
  insuredList: vi.fn(),
  invoicesList: vi.fn(),
  invoicesGet: vi.fn(),
}));

vi.mock('./index.js', () => ({
  api: {
    contracts: { list: contracts },
    persons: { list: personsList },
    insured: { list: insuredList },
    invoices: { list: invoicesList, get: invoicesGet },
  },
}));

import { loadInsuredOptions, loadInvoiceHistory } from './invoice-form-data';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadInsuredOptions', () => {
  it('labels every insured person and attaches the natural person’s birth date', async () => {
    contracts.mockResolvedValue([
      { id: 'c-1', insurer_name: 'TestAG' },
      { id: 'c-2', insurer_name: 'Zusatz eG' },
    ]);
    personsList.mockResolvedValue([
      { id: 'p-1', name: 'Anna', birth_date: '1985-04-01' },
      { id: 'p-2', name: 'Ben', birth_date: null },
    ]);
    insuredList.mockImplementation(async (contractId: string) =>
      contractId === 'c-1'
        ? [
            { id: 'ip-1', person_id: 'p-1', tariff_name: 'Komfort' },
            { id: 'ip-2', person_id: 'p-2', tariff_name: null, kvnr: 'A123' },
          ]
        : [{ id: 'ip-3', person_id: 'p-3', tariff_name: null, kvnr: null }],
    );

    const options = await loadInsuredOptions();

    expect(options).toEqual([
      {
        id: 'ip-1',
        label: 'TestAG · Komfort',
        insuredPerson: { id: 'ip-1', person_id: 'p-1', tariff_name: 'Komfort' },
        birthDate: '1985-04-01',
      },
      {
        id: 'ip-2',
        label: 'TestAG · A123',
        insuredPerson: { id: 'ip-2', person_id: 'p-2', tariff_name: null, kvnr: 'A123' },
        birthDate: null,
      },
      {
        id: 'ip-3',
        // No tariff and no KVNR: the generic fallback label.
        label: 'Zusatz eG · Tarif',
        insuredPerson: { id: 'ip-3', person_id: 'p-3', tariff_name: null, kvnr: null },
        // Unknown person → no birth date, so age-bound limits stay skipped.
        birthDate: null,
      },
    ]);
  });
});

describe('loadInvoiceHistory', () => {
  it('fetches each listed invoice individually so the positions are included', async () => {
    invoicesList.mockResolvedValue([{ id: 'inv-1' }, { id: 'inv-2' }]);
    invoicesGet.mockImplementation(async (invoiceId: string) => ({
      id: invoiceId,
      positions: [{ id: `pos-${invoiceId}` }],
    }));

    const history = await loadInvoiceHistory('ip-1');

    expect(invoicesList).toHaveBeenCalledWith({ insured_person_id: 'ip-1' });
    expect(history).toEqual([
      { id: 'inv-1', positions: [{ id: 'pos-inv-1' }] },
      { id: 'inv-2', positions: [{ id: 'pos-inv-2' }] },
    ]);
  });
});

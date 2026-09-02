// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted so the vi.mock factory (which runs before the module body) can close
// over the same spies these tests assert on.
const { contracts, personsList, insuredListAll, invoicesListWithPositions } = vi.hoisted(() => ({
  contracts: vi.fn(),
  personsList: vi.fn(),
  insuredListAll: vi.fn(),
  invoicesListWithPositions: vi.fn(),
}));

vi.mock('./index.js', () => ({
  api: {
    contracts: { list: contracts },
    persons: { list: personsList },
    insured: { listAll: insuredListAll },
    invoices: { listWithPositions: invoicesListWithPositions },
  },
}));

import { loadInsuredOptions, loadInvoiceHistory } from './invoice-form-data';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadInsuredOptions', () => {
  it('labels every insured person by name and attaches her birth date', async () => {
    contracts.mockResolvedValue([
      { id: 'c-1', insurer_name: 'TestAG' },
      { id: 'c-2', insurer_name: 'Zusatz eG' },
    ]);
    personsList.mockResolvedValue([
      { id: 'p-1', name: 'Anna', birth_date: '1985-04-01' },
      { id: 'p-2', name: 'Ben', birth_date: null },
    ]);
    // One flat read across all contracts (#463); the insurer is matched client-side.
    insuredListAll.mockResolvedValue([
      {
        id: 'ip-1',
        contract_id: 'c-1',
        person_id: 'p-1',
        person_name: 'Anna',
        tariff_name: 'Komfort',
      },
      {
        id: 'ip-2',
        contract_id: 'c-1',
        person_id: 'p-2',
        person_name: 'Ben',
        tariff_name: null,
        kvnr: 'A123',
      },
      { id: 'ip-3', contract_id: 'c-2', person_id: 'p-3', tariff_name: null, kvnr: null },
    ]);

    const options = await loadInsuredOptions();

    expect(insuredListAll).toHaveBeenCalledTimes(1);
    expect(options).toEqual([
      {
        id: 'ip-1',
        label: 'Anna · TestAG',
        insuredPerson: {
          id: 'ip-1',
          contract_id: 'c-1',
          person_id: 'p-1',
          person_name: 'Anna',
          tariff_name: 'Komfort',
        },
        birthDate: '1985-04-01',
      },
      {
        id: 'ip-2',
        label: 'Ben · TestAG',
        insuredPerson: {
          id: 'ip-2',
          contract_id: 'c-1',
          person_id: 'p-2',
          person_name: 'Ben',
          tariff_name: null,
          kvnr: 'A123',
        },
        birthDate: null,
      },
      {
        id: 'ip-3',
        // No joined name, no tariff, no KVNR: insuredPersonLabel's generic fallback.
        label: 'Versicherte Person · Zusatz eG',
        insuredPerson: {
          id: 'ip-3',
          contract_id: 'c-2',
          person_id: 'p-3',
          tariff_name: null,
          kvnr: null,
        },
        // Unknown person → no birth date, so age-bound limits stay skipped.
        birthDate: null,
      },
    ]);
  });

  it('drops the insurer suffix when the person hangs on an unknown contract', async () => {
    contracts.mockResolvedValue([]);
    personsList.mockResolvedValue([{ id: 'p-1', name: 'Anna', birth_date: null }]);
    insuredListAll.mockResolvedValue([
      { id: 'ip-1', contract_id: 'c-gone', person_id: 'p-1', person_name: 'Anna' },
    ]);

    const [option] = await loadInsuredOptions();

    expect(option!.label).toBe('Anna');
  });
});

describe('loadInvoiceHistory', () => {
  it("loads the person's invoices with their positions in one request (#463)", async () => {
    invoicesListWithPositions.mockResolvedValue([
      { id: 'inv-1', positions: [{ id: 'pos-1' }] },
      { id: 'inv-2', positions: [{ id: 'pos-2' }] },
    ]);

    const history = await loadInvoiceHistory('ip-1');

    expect(invoicesListWithPositions).toHaveBeenCalledTimes(1);
    expect(invoicesListWithPositions).toHaveBeenCalledWith({ insured_person_id: 'ip-1' });
    expect(history).toEqual([
      { id: 'inv-1', positions: [{ id: 'pos-1' }] },
      { id: 'inv-2', positions: [{ id: 'pos-2' }] },
    ]);
  });
});

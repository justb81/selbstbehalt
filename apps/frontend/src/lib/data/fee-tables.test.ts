// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { FEE_SCHEDULE_IDS, loadFeeTable } from './fee-tables';

describe('fee-tables', () => {
  it('exposes the three bundled schedules in display order', () => {
    expect(FEE_SCHEDULE_IDS).toEqual(['GOÄ', 'GOZ', 'GOT']);
  });

  it('lazily loads each id into a table tagged with the matching schedule', async () => {
    for (const id of FEE_SCHEDULE_IDS) {
      const table = await loadFeeTable(id);
      expect(table.schema).toBe('fee-schedule/v1');
      expect(table.feeSchedule).toBe(id);
      expect(Object.keys(table.entries).length).toBeGreaterThan(0);
    }
  });

  it('returns the same cached instance on repeated loads', async () => {
    const [a, b] = await Promise.all([loadFeeTable('GOÄ'), loadFeeTable('GOÄ')]);
    expect(a).toBe(b);
  });
});

describe('fee-tables — fee-less billing numbers are included (GOÄ 5298 regression)', () => {
  it('includes GOÄ percentage surcharges and lab "Katalog" analytes', async () => {
    const goae = await loadFeeTable('GOÄ');

    // Percentage surcharge 5298: point-less, priced 0, but detectable + surcharge.
    const e5298 = goae.entries['5298'];
    expect(e5298).toBeDefined();
    expect(e5298?.points).toBeNull();
    expect(e5298?.baseAmount).toBe(0);
    expect(e5298?.isSurcharge).toBe(true);

    // Lab "Katalog" analyte 3504 (Erythrozyten): priced from its method-header
    // rate (60 points → 3.50 EUR), category derived as lab.
    const e3504 = goae.entries['3504'];
    expect(e3504?.points).toBe(60);
    expect(e3504?.baseAmount).toBeCloseTo(3.5, 2);
    expect(e3504?.category).toBe('lab');

    // The laser surcharge 441 is present too.
    expect(goae.entries['441']).toBeDefined();
  });

  it('includes the GOZ percentage surcharge and Teilleistung codes', async () => {
    const goz = await loadFeeTable('GOZ');

    // 0120 normalises to "120": a point-less laser surcharge.
    const e120 = goz.entries['120'];
    expect(e120).toBeDefined();
    expect(e120?.points).toBeNull();
    expect(e120?.baseAmount).toBe(0);
    expect(e120?.isSurcharge).toBe(true);

    // Teilleistung codes (Hälfte / drei Viertel of a base fee): point-less, present.
    for (const z of ['2230', '2240', '5050', '5060', '5240']) {
      expect(goz.entries[z]).toBeDefined();
      expect(goz.entries[z]?.points).toBeNull();
    }
  });
});

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

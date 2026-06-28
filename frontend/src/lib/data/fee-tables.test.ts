// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import type { FeeScheduleId } from './fee-schedule';
import { FEE_SCHEDULE_IDS, feeTables, resolveFeeTable } from './fee-tables';

describe('fee-tables', () => {
  it('exposes the three bundled schedules in display order', () => {
    expect(FEE_SCHEDULE_IDS).toEqual(['GOÄ', 'GOZ', 'GOT']);
  });

  it('resolves each id to a table tagged with the matching schedule', () => {
    for (const id of FEE_SCHEDULE_IDS) {
      const table = resolveFeeTable(id);
      expect(table.schema).toBe('fee-schedule/v1');
      expect(table.feeSchedule).toBe(id);
      expect(Object.keys(table.entries).length).toBeGreaterThan(0);
    }
  });

  it('keeps the registry and resolver in sync', () => {
    for (const id of Object.keys(feeTables) as FeeScheduleId[]) {
      expect(resolveFeeTable(id)).toBe(feeTables[id]);
    }
  });
});

// SPDX-License-Identifier: Apache-2.0
/**
 * Lazily loads the static, version-controlled fee-schedule tables (GOÄ/GOZ/GOT)
 * for the invoice parser (#16) and the scan flow (#26).
 *
 * Each table is a sizable JSON file (GOÄ ~1 MB, GOT ~354 KB, GOZ ~117 KB), so
 * they are pulled in via per-schedule dynamic `import()` — each becomes its own
 * code-split chunk that is fetched (and `JSON.parse`d) only when the user
 * actually scans against that schedule, then cached. This module itself stays
 * JSON-free, so importing {@link FEE_SCHEDULE_IDS} for the dropdown never drags
 * a table in. Tables are generated reproducibly from the source XML under
 * `data/input/` (see docs/data-format.md, `pnpm fees:build`); never edited here.
 */
import type { FeeScheduleId, FeeScheduleTable } from './fee-schedule';

/** Schedules the scan flow can parse against, in display order. */
export const FEE_SCHEDULE_IDS: readonly FeeScheduleId[] = ['GOÄ', 'GOZ', 'GOT'];

/** Per-schedule dynamic importers — each resolves to its own bundle chunk. */
const loaders: Record<FeeScheduleId, () => Promise<{ default: unknown }>> = {
  GOÄ: () => import('./goae.json'),
  GOZ: () => import('./goz.json'),
  GOT: () => import('./got.json'),
};

const cache = new Map<FeeScheduleId, FeeScheduleTable>();

/** Loads (and caches) the bundled table for a schedule id. */
export async function loadFeeTable(schedule: FeeScheduleId): Promise<FeeScheduleTable> {
  const cached = cache.get(schedule);
  if (cached) return cached;
  const module = await loaders[schedule]();
  const table = module.default as unknown as FeeScheduleTable;
  cache.set(schedule, table);
  return table;
}

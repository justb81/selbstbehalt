// SPDX-License-Identifier: Apache-2.0
/**
 * Loads the static, version-controlled fee-schedule tables (GOÄ/GOZ/GOT) and
 * exposes them as typed {@link FeeScheduleTable}s for the invoice parser (#16)
 * and the scan flow (#26).
 *
 * The JSON is bundled at build time (Cache-First service-worker asset, §6.3) so
 * the parser never needs the network — only the schedule the user is scanning
 * against is consulted. Tables are generated reproducibly from the source XML
 * under `data/input/` (see docs/data-format.md, `pnpm fees:build`); they are
 * never edited here.
 */
import goaeJson from './goae.json';
import gotJson from './got.json';
import gozJson from './goz.json';
import type { FeeScheduleId, FeeScheduleTable } from './fee-schedule';

/** The bundled GOÄ table (Gebührenordnung für Ärzte). */
export const goaeTable = goaeJson as unknown as FeeScheduleTable;
/** The bundled GOZ table (Gebührenordnung für Zahnärzte). */
export const gozTable = gozJson as unknown as FeeScheduleTable;
/** The bundled GOT table (Gebührenordnung für Tierärzte). */
export const gotTable = gotJson as unknown as FeeScheduleTable;

/** Every fee schedule keyed by its {@link FeeScheduleId}. */
export const feeTables: Record<FeeScheduleId, FeeScheduleTable> = {
  GOÄ: goaeTable,
  GOZ: gozTable,
  GOT: gotTable,
};

/** Schedules the scan flow can parse against, in display order. */
export const FEE_SCHEDULE_IDS: readonly FeeScheduleId[] = ['GOÄ', 'GOZ', 'GOT'];

/** Returns the bundled table for a schedule id. */
export function resolveFeeTable(schedule: FeeScheduleId): FeeScheduleTable {
  return feeTables[schedule];
}

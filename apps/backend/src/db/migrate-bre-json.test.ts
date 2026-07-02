// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from './client.js';
import { migrateBreJson, migrateLevel } from './migrate-bre-json.js';
import { runMigrations } from './migrate.js';
import { contracts, insuredPersons, persons } from './schema.js';

// ---------------------------------------------------------------------------
// Unit tests for the pure level-transform function
// ---------------------------------------------------------------------------

describe('migrateLevel', () => {
  it('renames leistungsfrei_months → claim_free_years (÷ 12)', () => {
    expect(migrateLevel({ leistungsfrei_months: 12, bre_months: 1, pct_of_premium: 100 })).toEqual({
      claim_free_years: 1,
      bre_years: 1,
      pct_of_premium: 100,
    });
  });

  it('converts non-multiple months by rounding', () => {
    expect(migrateLevel({ leistungsfrei_months: 6 })).toEqual({ claim_free_years: 1 });
    expect(migrateLevel({ leistungsfrei_months: 0 })).toEqual({ claim_free_years: 0 });
    expect(migrateLevel({ leistungsfrei_months: 24 })).toEqual({ claim_free_years: 2 });
  });

  it('renames bre_months → bre_years without changing the value', () => {
    expect(migrateLevel({ bre_months: 3, pct_of_premium: 100 })).toEqual({
      bre_years: 3,
      pct_of_premium: 100,
    });
  });

  it('preserves fixed_amount_eur and pct_of_premium untouched', () => {
    expect(migrateLevel({ claim_free_years: 1, fixed_amount_eur: 300 })).toEqual({
      claim_free_years: 1,
      fixed_amount_eur: 300,
    });
  });

  it('is idempotent — already-migrated levels are unchanged', () => {
    const level = { claim_free_years: 1, bre_years: 1, pct_of_premium: 100 };
    expect(migrateLevel(level)).toEqual(level);
  });

  it('does not overwrite claim_free_years when both old and new keys coexist', () => {
    // Defensive: if somehow both keys are present, the existing value wins and
    // leistungsfrei_months is left in place (the row is treated as already migrated).
    const level = { leistungsfrei_months: 24, claim_free_years: 99 };
    expect(migrateLevel(level)).toEqual({ leistungsfrei_months: 24, claim_free_years: 99 });
  });
});

// ---------------------------------------------------------------------------
// Integration tests for migrateBreJson against an in-memory DB
// ---------------------------------------------------------------------------

let handle: DbHandle;

beforeEach(() => {
  handle = createDb(':memory:');
  runMigrations(handle);

  const personId = handle.db.insert(persons).values({ name: 'Test Person' }).returning().get().id;
  const contractId = handle.db
    .insert(contracts)
    .values({
      policyholderId: personId,
      insurerName: 'DKV',
      type: 'vollversicherung',
      startDate: '2013-01-01',
    })
    .returning()
    .get().id;

  // Row with OLD field names (pre-#103/#104 format).
  // Cast needed: the legacy shape deliberately violates the current Zod schema.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const legacyStructure: any = {
    type: 'staffel',
    levels: [{ leistungsfrei_months: 12, bre_months: 1, pct_of_premium: 100 }],
    current_streak_start: '2013-01-01',
  };
  handle.db
    .insert(insuredPersons)
    .values({
      contractId,
      personId,
      monthlyPremium: 573.12,
      selfRetention: 1200,
      breStructure: legacyStructure,
    })
    .run();
});

afterEach(() => {
  handle.sqlite.close();
});

describe('migrateBreJson', () => {
  it('rewrites legacy field names in place and returns the migrated row count', () => {
    const count = migrateBreJson(handle);
    expect(count).toBe(1);

    const row = handle.db.select().from(insuredPersons).get()!;
    expect(row.breStructure).toEqual({
      type: 'staffel',
      levels: [{ claim_free_years: 1, bre_years: 1, pct_of_premium: 100 }],
      current_streak_start: '2013-01-01',
    });
  });

  it('is idempotent — a second run migrates 0 rows', () => {
    migrateBreJson(handle);
    expect(migrateBreJson(handle)).toBe(0);
  });

  it('skips rows whose bre_structure already uses the new names', () => {
    // Replace with already-correct data.
    handle.db
      .update(insuredPersons)
      .set({
        breStructure: {
          type: 'staffel',
          levels: [{ claim_free_years: 1, bre_years: 1, pct_of_premium: 100 }],
          current_streak_start: '2013-01-01',
        },
      })
      .run();
    expect(migrateBreJson(handle)).toBe(0);
  });

  it('skips rows where bre_structure is null', () => {
    handle.db.update(insuredPersons).set({ breStructure: null }).run();
    expect(migrateBreJson(handle)).toBe(0);
  });
});

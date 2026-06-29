// SPDX-License-Identifier: Apache-2.0
//
// One-time data migration: rewrites `bre_structure` JSON stored in
// `insured_persons` rows that were created before the field rename in #103/#104.
//
// Old field names  → New field names
//   leistungsfrei_months (number, in months)  →  claim_free_years (value ÷ 12)
//   bre_months                                →  bre_years  (rename only)
//
// Safe to run multiple times — rows that already use the new names are skipped.
// Run via: pnpm --filter @selbstbehalt/backend db:migrate-bre-json

import { fileURLToPath } from 'node:url';

import { eq, isNotNull } from 'drizzle-orm';

import { loadConfig } from '../config.js';
import { createDb } from './client.js';
import { runMigrations } from './migrate.js';
import { insuredPersons } from './schema.js';

type LegacyLevel = {
  leistungsfrei_months?: number;
  bre_months?: number;
  claim_free_years?: number;
  bre_years?: number;
  pct_of_premium?: number;
  fixed_amount_eur?: number;
};

function migrateLevel(level: LegacyLevel): LegacyLevel {
  const out: LegacyLevel = { ...level };

  if ('leistungsfrei_months' in out && !('claim_free_years' in out)) {
    out.claim_free_years = Math.round((out.leistungsfrei_months ?? 0) / 12);
    delete out.leistungsfrei_months;
  }

  if ('bre_months' in out && !('bre_years' in out)) {
    out.bre_years = out.bre_months;
    delete out.bre_months;
  }

  return out;
}

function run(): void {
  const { databasePath } = loadConfig();
  const handle = createDb(databasePath);
  try {
    runMigrations(handle);

    const rows = handle.db
      .select({ id: insuredPersons.id, breStructure: insuredPersons.breStructure })
      .from(insuredPersons)
      .where(isNotNull(insuredPersons.breStructure))
      .all();

    let migrated = 0;
    for (const row of rows) {
      const structure = row.breStructure;
      if (!structure) continue;

      const needsMigration = structure.levels.some(
        (l: LegacyLevel) => 'leistungsfrei_months' in l || 'bre_months' in l,
      );
      if (!needsMigration) continue;

      const updated = { ...structure, levels: structure.levels.map(migrateLevel) };
      handle.db
        .update(insuredPersons)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .set({ breStructure: updated as any })
        .where(eq(insuredPersons.id, row.id))
        .run();
      migrated++;
    }

    console.log(
      `Checked ${rows.length} insured person(s). Migrated ${migrated} bre_structure JSON field(s).`,
    );
  } finally {
    handle.sqlite.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run();
}

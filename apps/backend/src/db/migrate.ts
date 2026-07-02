// SPDX-License-Identifier: Apache-2.0
//
// Applies the checked-in Drizzle migrations to a database. Importable (used by
// the integration test against in-memory SQLite) and runnable as a CLI via the
// `db:migrate` script.

import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import { loadConfig } from '../config.js';
import { createDb, type DbHandle } from './client.js';

/** Absolute path to the generated migrations folder. */
export const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url));

/** Run all pending migrations against an open database handle. */
export function runMigrations(handle: DbHandle): void {
  migrate(handle.db, { migrationsFolder });
}

/** Open the configured database, migrate it, and close it. */
function migrateCli(): void {
  const { databasePath } = loadConfig();
  const handle = createDb(databasePath);
  try {
    runMigrations(handle);
    console.log(`Migrations applied to ${databasePath}`);
  } finally {
    handle.sqlite.close();
  }
}

// Only run the CLI when executed directly (not when imported by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  migrateCli();
}

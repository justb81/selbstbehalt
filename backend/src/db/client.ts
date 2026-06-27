// SPDX-License-Identifier: Apache-2.0
//
// SQLite connection + Drizzle wiring. The rest of the app depends only on the
// returned `Database` type so it never imports better-sqlite3 directly.

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import { schema, type Schema } from './schema.js';

export type Database = BetterSQLite3Database<Schema>;

export interface DbHandle {
  db: Database;
  /** Underlying better-sqlite3 connection (for migrations / graceful close). */
  sqlite: BetterSqlite3.Database;
}

/**
 * Open the SQLite database at `path` and return a Drizzle handle.
 * For file paths the parent directory is created if missing. Use `:memory:`
 * for ephemeral databases (tests).
 */
export function createDb(path: string): DbHandle {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const sqlite = new BetterSqlite3(path);
  // WAL improves concurrent read performance; foreign keys enforce the
  // cascade relations declared in the schema (off by default in SQLite).
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

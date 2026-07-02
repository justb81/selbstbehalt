// SPDX-License-Identifier: Apache-2.0
//
// Shared DB-level helpers for the REST route modules. Each helper collapses a
// recurring pattern that was copy-pasted across four route files.

import { eq } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { HTTPException } from 'hono/http-exception';

import type { Database } from '../db/client.js';

/**
 * Check that a row with `id` exists in `table`, throwing HTTP 400 if not.
 * Used as a FK pre-check — gives a clear message before the DB would raise an
 * opaque constraint error.
 */
export function assertFkExists<T extends SQLiteTable & { id: SQLiteColumn }>(
  db: Database,
  table: T,
  id: string,
  message: string,
): void {
  const row = db.select({ id: table.id }).from(table).where(eq(table.id, id)).get();
  if (!row) throw new HTTPException(400, { message });
}

/**
 * Call `fetch()` and return its result, throwing HTTP 404 with `message` when
 * `fetch()` returns `undefined`. The caller's existing `findX()` function is a
 * natural fit for the `fetch` argument.
 */
export function requireRow<T>(fetch: () => T | undefined, message: string): T {
  const row = fetch();
  if (!row) throw new HTTPException(404, { message });
  return row;
}

/**
 * If `changes` has any keys, call `doUpdate()` and return its result; otherwise
 * return `fallback` without issuing an UPDATE. Implements the no-op PUT idiom
 * shared by the contract, insured-person, and submission update handlers.
 */
export function updateOrReturn<T>(
  changes: Record<string, unknown>,
  doUpdate: () => T,
  fallback: T,
): T {
  return Object.keys(changes).length > 0 ? doUpdate() : fallback;
}

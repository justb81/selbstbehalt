// SPDX-License-Identifier: Apache-2.0
import { sql } from 'drizzle-orm';

import type { Database } from './client.js';

/**
 * Liveness probe for the database: runs a trivial query and reports whether the
 * connection answers. Never throws — a dead DB resolves to `false`.
 */
export function pingDatabase(db: Database): boolean {
  try {
    db.get(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}

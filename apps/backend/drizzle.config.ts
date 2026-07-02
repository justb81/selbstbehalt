// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'drizzle-kit';

// Used by `drizzle-kit generate` (and `studio`). Runtime migration is applied
// programmatically via src/db/migrate.ts so the same code path is exercised by
// the integration tests.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_PATH ?? 'data/db/pkv.sqlite',
  },
});

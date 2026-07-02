// SPDX-License-Identifier: Apache-2.0
//
// tsc only emits .js/.d.ts — it does not copy the drizzle-kit-generated SQL
// migrations. The compiled migrator resolves its migrations folder relative to
// itself (dist/db/migrations), so this build step mirrors src/db/migrations
// into dist/db/migrations. Runs after `tsc` in the backend `build` script.

import { cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../src/db/migrations', import.meta.url));
const dest = fileURLToPath(new URL('../dist/db/migrations', import.meta.url));

if (!existsSync(src)) {
  console.error(`No migrations found at ${src} — run \`pnpm db:generate\` first.`);
  process.exit(1);
}

cpSync(src, dest, { recursive: true });
console.log(`Copied migrations → ${dest}`);

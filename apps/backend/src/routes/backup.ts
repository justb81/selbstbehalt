// SPDX-License-Identifier: Apache-2.0
//
// `/api/export/db` + `/api/import/db` — database backup, restore and data
// portability (§7.1, §8.2 Art. 20 DSGVO, issue #14).
//
//   - GET  /export/db   streams a consistent snapshot of the SQLite database as
//                       a download (`better-sqlite3` `serialize()`).
//   - POST /import/db   validates an uploaded SQLite file (size, magic bytes,
//                       integrity, schema compatibility), backs up the current
//                       database, then atomically reloads the app tables from it.
//
// The import is destructive, so it is double-guarded: a `?confirm=true` is
// required, and the current database is snapshotted to a `.bak-<ts>` file before
// a single row is touched. The reload runs in one transaction with a final
// `foreign_key_check`, so a faulty upload rolls back and leaves the live data
// untouched.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ImportResult } from '@selbstbehalt/shared';
import BetterSqlite3 from 'better-sqlite3';
import { getTableName } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import {
  brePeriods,
  contracts,
  insuredPersons,
  invoicePositions,
  invoices,
  persons,
  submissions,
} from '../db/schema.js';

/** The 16-byte SQLite file header: the ASCII "SQLite format 3" plus a NUL. */
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'latin1');

/** Reject uploads larger than this — a guard against accidental huge bodies. */
const MAX_IMPORT_BYTES = 256 * 1024 * 1024; // 256 MiB

/**
 * Application tables eligible for restore, in parent-before-child order. The
 * Drizzle-internal `__drizzle_migrations` table is deliberately excluded: the
 * live database keeps its own migration state, we only reload user data.
 */
const APP_TABLES = [
  persons,
  contracts,
  insuredPersons,
  invoices,
  invoicePositions,
  submissions,
  brePeriods,
].map(getTableName);

interface BackupDeps {
  db: Database;
  config: Config;
}

/** Download filename for an export, stamped with today's date. */
function exportFilename(): string {
  return `selbstbehalt-${new Date().toISOString().slice(0, 10)}.sqlite`;
}

/** Read the uploaded bytes from either a multipart `file` field or a raw body. */
async function readUpload(c: Context): Promise<Uint8Array> {
  const contentType = c.req.header('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    const body = await c.req.parseBody();
    const file = body['file'];
    if (!(file instanceof File)) {
      throw new HTTPException(400, { message: 'Multipart-Upload ohne Feld "file"' });
    }
    return new Uint8Array(await file.arrayBuffer());
  }
  const buffer = await c.req.arrayBuffer();
  return new Uint8Array(buffer);
}

/** Reject anything that is not a plausibly-sized SQLite file before touching disk. */
function assertValidSqliteUpload(bytes: Uint8Array): void {
  if (bytes.byteLength === 0) {
    throw new HTTPException(400, { message: 'Leerer Upload' });
  }
  if (bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new HTTPException(413, {
      message: `Datei zu groß (max. ${MAX_IMPORT_BYTES / (1024 * 1024)} MiB)`,
    });
  }
  if (
    bytes.byteLength < SQLITE_MAGIC.length ||
    !Buffer.from(bytes.subarray(0, SQLITE_MAGIC.length)).equals(SQLITE_MAGIC)
  ) {
    throw new HTTPException(400, { message: 'Keine gültige SQLite-Datei (Header fehlt)' });
  }
}

/** A stable signature of a table's columns: `name:type:notnull:pk` per column. */
function describeColumns(conn: BetterSqlite3.Database, table: string): string {
  const cols = conn.prepare(`PRAGMA table_info("${table}")`).all() as {
    name: string;
    type: string;
    notnull: number;
    pk: number;
  }[];
  return cols.map((col) => `${col.name}:${col.type}:${col.notnull}:${col.pk}`).join('|');
}

/** Throw 422 if the uploaded database's schema differs from the live one. */
function assertSchemaCompatible(
  live: BetterSqlite3.Database,
  imported: BetterSqlite3.Database,
): void {
  const integrity = imported.prepare('PRAGMA integrity_check').get() as
    { integrity_check: string } | undefined;
  if (integrity?.integrity_check !== 'ok') {
    throw new HTTPException(422, { message: 'Hochgeladene Datenbank ist beschädigt' });
  }

  for (const table of APP_TABLES) {
    const exists = imported
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(table);
    if (!exists) {
      throw new HTTPException(422, {
        message: `Inkompatibles Schema: Tabelle '${table}' fehlt in der hochgeladenen Datenbank`,
      });
    }
    if (describeColumns(live, table) !== describeColumns(imported, table)) {
      throw new HTTPException(422, {
        message: `Inkompatibles Schema: Spalten der Tabelle '${table}' weichen ab`,
      });
    }
  }
}

/**
 * Snapshot the live database to a `.bak-<timestamp>` file next to it before the
 * destructive overwrite. Returns the backup path, or `null` for an in-memory
 * database (nothing on disk to protect).
 */
function backupCurrentDb(raw: BetterSqlite3.Database, config: Config): string | null {
  if (config.databasePath === ':memory:') return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${config.databasePath}.bak-${stamp}`;
  writeFileSync(backupPath, raw.serialize());
  return backupPath;
}

/**
 * Reload the app tables from the attached `importdb`, in one transaction. FK
 * enforcement is toggled off for the bulk delete/insert and the result is
 * validated with `foreign_key_check` before commit, so a faulty upload rolls
 * back cleanly. Returns the number of rows inserted.
 */
function reloadFromAttached(raw: BetterSqlite3.Database): number {
  let rows = 0;
  const apply = raw.transaction(() => {
    for (const table of APP_TABLES) {
      raw.prepare(`DELETE FROM main."${table}"`).run();
    }
    for (const table of APP_TABLES) {
      const result = raw
        .prepare(`INSERT INTO main."${table}" SELECT * FROM importdb."${table}"`)
        .run();
      rows += result.changes;
    }
    const violations = raw.prepare('PRAGMA main.foreign_key_check').all();
    if (violations.length > 0) {
      throw new HTTPException(422, {
        message: 'Importierte Daten verletzen Fremdschlüssel-Beziehungen',
      });
    }
  });
  apply();
  return rows;
}

export function createBackupRoute({ db, config }: BackupDeps) {
  // The raw better-sqlite3 connection backs serialize()/ATTACH/PRAGMA, which the
  // Drizzle query layer does not expose.
  const raw = db.$client;

  return new Hono()
    .get('/export/db', (c) => {
      const snapshot = raw.serialize();
      const body = snapshot.buffer.slice(
        snapshot.byteOffset,
        snapshot.byteOffset + snapshot.byteLength,
      ) as ArrayBuffer;
      c.header('Content-Type', 'application/x-sqlite3');
      c.header('Content-Disposition', `attachment; filename="${exportFilename()}"`);
      return c.body(body);
    })
    .post('/import/db', async (c) => {
      // Destructive: require an explicit confirmation in addition to the backup.
      if (c.req.query('confirm') !== 'true') {
        throw new HTTPException(400, {
          message:
            'Import überschreibt die gesamte Datenbank — Bestätigung mit ?confirm=true erforderlich',
        });
      }

      const bytes = await readUpload(c);
      assertValidSqliteUpload(bytes);

      // Stage the upload on disk so SQLite can open it as a real database file.
      const tmpDir = mkdtempSync(join(tmpdir(), 'selbstbehalt-import-'));
      const tmpPath = join(tmpDir, 'upload.sqlite');
      writeFileSync(tmpPath, bytes);

      try {
        const imported = new BetterSqlite3(tmpPath, { readonly: true });
        try {
          assertSchemaCompatible(raw, imported);
        } finally {
          imported.close();
        }

        const backupPath = backupCurrentDb(raw, config);

        raw.pragma('foreign_keys = OFF');
        raw.prepare('ATTACH DATABASE ? AS importdb').run(tmpPath);
        let rows: number;
        try {
          rows = reloadFromAttached(raw);
        } finally {
          raw.exec('DETACH DATABASE importdb');
          raw.pragma('foreign_keys = ON');
        }

        const body: ImportResult = {
          status: 'ok',
          tables_imported: APP_TABLES.length,
          rows_imported: rows,
          backup_path: backupPath,
        };
        return c.json(body);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
}

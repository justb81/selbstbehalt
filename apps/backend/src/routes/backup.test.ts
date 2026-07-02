// SPDX-License-Identifier: Apache-2.0
//
// Integration tests for /api/export/db + /api/import/db (#14). Real on-disk
// SQLite files are used (in a temp dir) so the export snapshot, the pre-overwrite
// backup and the round-trip data identity are exercised end to end.

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createDb, type DbHandle } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { contracts, insuredPersons, invoiceStatusEvents, invoices, persons } from '../db/schema.js';

let tmp: string;
const handles: DbHandle[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'selbstbehalt-backup-'));
});

afterEach(() => {
  for (const handle of handles) {
    if (handle.sqlite.open) handle.sqlite.close();
  }
  handles.length = 0;
  rmSync(tmp, { recursive: true, force: true });
});

/** Build a migrated app backed by a real SQLite file under the temp dir. */
function makeApp(name: string) {
  const dbPath = join(tmp, name);
  const handle = createDb(dbPath);
  handles.push(handle);
  runMigrations(handle);
  const app = createApp({ db: handle.db, config: loadConfig({ DATABASE_PATH: dbPath }) });
  return { handle, app, dbPath };
}

/**
 * Seed one Person → Vertrag → versicherte Person → Rechnung chain, including an
 * `invoice_status_events` row. Every invoice created through the API carries at
 * least one status event (`invoices.ts` appends an initial 'neu' event on
 * create), so seeding one here mirrors a real, API-populated database — and
 * makes the import round-trip actually exercise that table.
 */
function seedChain(handle: DbHandle, insurer: string): string {
  const db = handle.db;
  const personId = db
    .insert(persons)
    .values({ name: `Inhaber ${insurer}` })
    .returning()
    .get().id;
  const contractId = db
    .insert(contracts)
    .values({
      policyholderId: personId,
      insurerName: insurer,
      type: 'vollversicherung',
      startDate: '2024-01-01',
    })
    .returning()
    .get().id;
  const insuredPersonId = db
    .insert(insuredPersons)
    .values({ contractId, personId, monthlyPremium: 200 })
    .returning()
    .get().id;
  const invoiceId = db
    .insert(invoices)
    .values({
      insuredPersonId,
      invoiceDate: '2026-06-01',
      providerName: 'Dr. Müller',
      totalAmount: 85,
      eligibleAmount: 62.5,
    })
    .returning()
    .get().id;
  db.insert(invoiceStatusEvents).values({ invoiceId, status: 'neu', note: 'angelegt' }).run();
  return contractId;
}

describe('GET /api/export/db', () => {
  it('streams a valid SQLite file as an attachment', async () => {
    const source = makeApp('source.sqlite');
    seedChain(source.handle, 'DKV');

    const res = await source.app.request('/api/export/db');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('sqlite');
    expect(res.headers.get('content-disposition')).toContain('attachment');

    const bytes = Buffer.from(await res.arrayBuffer());
    // The serialized snapshot starts with the SQLite file magic.
    expect(bytes.subarray(0, 16).toString('latin1')).toBe('SQLite format 3\0');
    expect(bytes.byteLength).toBeGreaterThan(0);
  });
});

describe('POST /api/import/db', () => {
  async function exportBytes(app: ReturnType<typeof makeApp>['app']): Promise<Uint8Array> {
    const res = await app.request('/api/export/db');
    return new Uint8Array(await res.arrayBuffer());
  }

  it('round-trips: export → fresh DB → import yields identical data', async () => {
    const source = makeApp('source.sqlite');
    seedChain(source.handle, 'DKV');
    const bytes = await exportBytes(source.app);

    // A separate database with *different* data that the import must replace.
    const target = makeApp('target.sqlite');
    seedChain(target.handle, 'Allianz');

    const res = await target.app.request('/api/import/db?confirm=true', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sqlite3' },
      body: bytes,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'ok', tables_imported: 8 });
    expect(body.rows_imported).toBeGreaterThan(0);

    // A safety backup of the pre-import target was written to disk.
    expect(body.backup_path).toBeTruthy();
    expect(existsSync(body.backup_path)).toBe(true);

    // The target now serves exactly the source's data — and only that.
    const sourceContracts = await (await source.app.request('/api/contracts')).json();
    const targetContracts = await (await target.app.request('/api/contracts')).json();
    expect(targetContracts).toEqual(sourceContracts);
    expect(targetContracts.map((c: { insurer_name: string }) => c.insurer_name)).toEqual(['DKV']);

    const sourceInvoices = await (await source.app.request('/api/invoices')).json();
    const targetInvoices = await (await target.app.request('/api/invoices')).json();
    expect(targetInvoices).toEqual(sourceInvoices);
  });

  it('restores the invoice status-event audit trail without orphaning the target', async () => {
    // The source's audit trail must survive the export→import round-trip
    // (Art. 20 portability), and — because the target already holds its own
    // invoices *with* status events (the real shape of any API-populated DB) —
    // reloading the invoices table without also reloading invoice_status_events
    // would leave the target's events dangling and the final foreign_key_check
    // would roll the whole import back with a 422.
    const source = makeApp('source.sqlite');
    seedChain(source.handle, 'DKV');
    const bytes = await exportBytes(source.app);

    const target = makeApp('target.sqlite');
    seedChain(target.handle, 'Allianz');

    const res = await target.app.request('/api/import/db?confirm=true', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sqlite3' },
      body: bytes,
    });
    expect(res.status).toBe(200);

    // The target now holds exactly the source's audit trail — no orphans, no loss.
    const sourceEvents = source.handle.db.select().from(invoiceStatusEvents).all();
    const targetEvents = target.handle.db.select().from(invoiceStatusEvents).all();
    expect(sourceEvents).toHaveLength(1);
    expect(targetEvents).toEqual(sourceEvents);
  });

  it('accepts a multipart/form-data upload', async () => {
    const source = makeApp('source.sqlite');
    seedChain(source.handle, 'DKV');
    const bytes = await exportBytes(source.app);

    const target = makeApp('target.sqlite');
    const form = new FormData();
    form.append('file', new File([bytes], 'backup.sqlite', { type: 'application/x-sqlite3' }));

    const res = await target.app.request('/api/import/db?confirm=true', {
      method: 'POST',
      body: form,
    });
    expect(res.status).toBe(200);
    const targetContracts = await (await target.app.request('/api/contracts')).json();
    expect(targetContracts).toHaveLength(1);
  });

  it('refuses without the ?confirm=true guard', async () => {
    const source = makeApp('source.sqlite');
    seedChain(source.handle, 'DKV');
    const bytes = await exportBytes(source.app);

    const target = makeApp('target.sqlite');
    const res = await target.app.request('/api/import/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sqlite3' },
      body: bytes,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain('confirm=true');
  });

  it('rejects a non-SQLite upload with 400', async () => {
    const target = makeApp('target.sqlite');
    const res = await target.app.request('/api/import/db?confirm=true', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sqlite3' },
      body: new TextEncoder().encode('this is not a database'),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an incompatible schema (422) and leaves the data untouched', async () => {
    // A valid SQLite file, but without the app's tables.
    const foreignPath = join(tmp, 'foreign.sqlite');
    const foreign = new BetterSqlite3(foreignPath);
    foreign.exec('CREATE TABLE unrelated (x INTEGER)');
    const foreignBytes = foreign.serialize();
    foreign.close();

    const target = makeApp('target.sqlite');
    seedChain(target.handle, 'Allianz');

    const res = await target.app.request('/api/import/db?confirm=true', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sqlite3' },
      body: foreignBytes,
    });
    expect(res.status).toBe(422);

    // The existing data survived the rejected import.
    const targetContracts = await (await target.app.request('/api/contracts')).json();
    expect(targetContracts.map((c: { insurer_name: string }) => c.insurer_name)).toEqual([
      'Allianz',
    ]);
  });
});

// SPDX-License-Identifier: Apache-2.0
//
// Integration tests for the /api/persons endpoints (§7.1) with a focus on the
// DSGVO right to erasure (Art. 17): deleting a person is the identity-root
// erasure path, so it must cascade down *both* relationships — the contracts
// they hold (policyholder_id) and the insured-person rows they occupy on any
// contract (person_id) — and leave no orphaned personal data, while touching
// nothing that belongs to other people.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createDb, type DbHandle } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import {
  brePeriods,
  contracts,
  insuredPersons,
  invoicePositions,
  invoiceStatusEvents,
  invoices,
  persons,
  submissions,
} from '../db/schema.js';

let handle: DbHandle;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  handle = createDb(':memory:');
  runMigrations(handle);
  app = createApp({ db: handle.db, config: loadConfig({}) });
});

afterEach(() => {
  if (handle.sqlite.open) handle.sqlite.close();
});

function json(method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('/api/persons CRUD', () => {
  it('creates, reads, updates and lists a person', async () => {
    const created = await json('POST', '/api/persons', {
      name: 'Erika Mustermann',
      birth_date: '1980-05-01',
    });
    expect(created.status).toBe(201);
    const person = await created.json();
    expect(person.id).toMatch(/[0-9a-f-]{36}/);
    expect(person.name).toBe('Erika Mustermann');

    expect((await json('GET', `/api/persons/${person.id}`)).status).toBe(200);

    const updated = await json('PUT', `/api/persons/${person.id}`, { name: 'Erika Musterfrau' });
    expect((await updated.json()).name).toBe('Erika Musterfrau');

    const list = await (await json('GET', '/api/persons')).json();
    expect(list).toHaveLength(1);
  });

  it('returns 404 for an unknown person on GET, PUT and DELETE', async () => {
    expect((await json('GET', '/api/persons/does-not-exist')).status).toBe(404);
    expect((await json('PUT', '/api/persons/does-not-exist', { name: 'X' })).status).toBe(404);
    expect((await json('DELETE', '/api/persons/does-not-exist')).status).toBe(404);
  });
});

describe('DELETE /api/persons/:id (Art. 17 erasure cascade)', () => {
  it('erases a person via both relationships and leaves no orphaned data, sparing others', async () => {
    const db = handle.db;

    // Two people. Person A holds contract A and is also insured on person B's
    // contract B (the dual-path case). Person B holds contract B.
    const personA = db.insert(persons).values({ name: 'Anna A' }).returning().get().id;
    const personB = db.insert(persons).values({ name: 'Ben B' }).returning().get().id;

    const contractA = db
      .insert(contracts)
      .values({
        policyholderId: personA,
        insurerName: 'DKV',
        type: 'vollversicherung',
        startDate: '2024-01-01',
      })
      .returning()
      .get().id;
    const contractB = db
      .insert(contracts)
      .values({
        policyholderId: personB,
        insurerName: 'Allianz',
        type: 'vollversicherung',
        startDate: '2024-01-01',
      })
      .returning()
      .get().id;

    // A on her own contract, A on B's contract, and B on his own contract.
    const insuredAonA = db
      .insert(insuredPersons)
      .values({ contractId: contractA, personId: personA, monthlyPremium: 200 })
      .returning()
      .get().id;
    const insuredAonB = db
      .insert(insuredPersons)
      .values({ contractId: contractB, personId: personA, monthlyPremium: 150 })
      .returning()
      .get().id;
    const insuredBonB = db
      .insert(insuredPersons)
      .values({ contractId: contractB, personId: personB, monthlyPremium: 300 })
      .returning()
      .get().id;

    // Personal data hanging off A's insured rows: invoices (+ positions, status
    // events, submissions) and a BRE period. Plus one invoice + BRE period for B.
    const invoiceA = db
      .insert(invoices)
      .values({
        insuredPersonId: insuredAonA,
        invoiceDate: '2026-06-01',
        providerName: 'Dr. Müller',
        totalAmount: 85,
      })
      .returning()
      .get().id;
    db.insert(invoicePositions)
      .values({
        invoiceId: invoiceA,
        goaeNumber: '1',
        treatmentDate: '2026-06-01',
        multiplier: 2.3,
        baseAmount: 4.66,
        chargedAmount: 10.72,
      })
      .run();
    db.insert(invoiceStatusEvents).values({ invoiceId: invoiceA, status: 'neu' }).run();
    db.insert(submissions).values({ invoiceId: invoiceA, submittedVia: 'post' }).run();
    db.insert(brePeriods).values({ insuredPersonId: insuredAonB, year: 2026 }).run();

    const invoiceB = db
      .insert(invoices)
      .values({
        insuredPersonId: insuredBonB,
        invoiceDate: '2026-06-02',
        providerName: 'Dr. Schmidt',
        totalAmount: 42,
      })
      .returning()
      .get().id;
    db.insert(brePeriods).values({ insuredPersonId: insuredBonB, year: 2026 }).run();

    // Erase person A through the public DELETE route.
    expect((await json('DELETE', `/api/persons/${personA}`)).status).toBe(204);

    // Person B and their contract/insured row/invoice/BRE survive untouched.
    expect(
      db
        .select()
        .from(persons)
        .all()
        .map((p) => p.id),
    ).toEqual([personB]);
    expect(
      db
        .select()
        .from(contracts)
        .all()
        .map((c) => c.id),
    ).toEqual([contractB]);
    expect(
      db
        .select()
        .from(insuredPersons)
        .all()
        .map((i) => i.id),
    ).toEqual([insuredBonB]);
    expect(
      db
        .select()
        .from(invoices)
        .all()
        .map((i) => i.id),
    ).toEqual([invoiceB]);

    // Everything belonging to A is gone — no orphans across any child table.
    expect(db.select().from(invoicePositions).all()).toHaveLength(0);
    expect(db.select().from(invoiceStatusEvents).all()).toHaveLength(0);
    expect(db.select().from(submissions).all()).toHaveLength(0);
    // A's insured rows (on both contracts) and her BRE period are gone; only B's remains.
    expect(db.select().from(brePeriods).all()).toHaveLength(1);
    expect(
      db
        .select()
        .from(insuredPersons)
        .all()
        .some((i) => i.id === insuredAonA || i.id === insuredAonB),
    ).toBe(false);
  });
});

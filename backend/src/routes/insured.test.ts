// SPDX-License-Identifier: Apache-2.0
//
// Integration tests for the versicherte-Personen endpoints (§7.1): nested
// list/create under a contract, the item operations at /api/insured/:id, the
// bre_structure JSON round-trip, validation/404s, and the cascade on delete.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createDb, type DbHandle } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { contracts, invoices, persons } from '../db/schema.js';

let handle: DbHandle;
let app: ReturnType<typeof createApp>;
let personId: string;
let contractId: string;

beforeEach(() => {
  handle = createDb(':memory:');
  runMigrations(handle);
  app = createApp({ db: handle.db, config: loadConfig({}) });
  const db = handle.db;
  personId = db.insert(persons).values({ name: 'Erika Mustermann' }).returning().get().id;
  contractId = db
    .insert(contracts)
    .values({
      policyholderId: personId,
      insurerName: 'DKV',
      type: 'vollversicherung',
      startDate: '2024-01-01',
    })
    .returning()
    .get().id;
});

afterEach(() => {
  if (handle.sqlite.open) handle.sqlite.close();
});

const baseInsured = () => ({ person_id: personId, kvnr: 'A123456789', monthly_premium: 452.3 });

function json(method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('POST /api/contracts/:id/insured', () => {
  it('adds an insured person and returns 201 with its KVNR', async () => {
    const res = await json('POST', `/api/contracts/${contractId}/insured`, baseInsured());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toMatch(/[0-9a-f-]{36}/);
    expect(body.contract_id).toBe(contractId);
    expect(body.kvnr).toBe('A123456789');
    // DB DEFAULT applied for the omitted Selbstbehalt.
    expect(body.self_retention).toBe(0);
  });

  it('persists and types the bre_structure JSON', async () => {
    const res = await json('POST', `/api/contracts/${contractId}/insured`, {
      ...baseInsured(),
      bre_structure: {
        type: 'staffel',
        levels: [{ leistungsfrei_months: 12, bre_months: 1, pct_of_premium: 100 }],
        current_streak_start: '2025-01-01',
      },
      included_benefits: ['Ambulant', 'Zahn 80%'],
    });
    const body = await res.json();
    expect(body.bre_structure.levels[0].bre_months).toBe(1);
    expect(body.included_benefits).toEqual(['Ambulant', 'Zahn 80%']);
  });

  it('rejects an insured person for a non-existent contract with 400', async () => {
    const res = await json('POST', `/api/contracts/${crypto.randomUUID()}/insured`, baseInsured());
    expect(res.status).toBe(400);
  });

  it('rejects an insured person referencing a non-existent person with 400', async () => {
    const res = await json('POST', `/api/contracts/${contractId}/insured`, {
      ...baseInsured(),
      person_id: crypto.randomUUID(),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/contracts/:id/insured', () => {
  it('lists the insured persons on a contract', async () => {
    await json('POST', `/api/contracts/${contractId}/insured`, baseInsured());
    const child = handle.db.insert(persons).values({ name: 'Lena' }).returning().get().id;
    await json('POST', `/api/contracts/${contractId}/insured`, {
      person_id: child,
      kvnr: 'A987654321',
      monthly_premium: 168.5,
    });

    const res = await app.request(`/api/contracts/${contractId}/insured`);
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(2);
  });
});

describe('GET/PUT/DELETE /api/insured/:id', () => {
  async function create() {
    return (await json('POST', `/api/contracts/${contractId}/insured`, baseInsured())).json();
  }

  it('returns a single insured person', async () => {
    const created = await create();
    const res = await app.request(`/api/insured/${created.id}`);
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(created.id);
  });

  it('returns 404 for an unknown insured person', async () => {
    const res = await app.request(`/api/insured/${crypto.randomUUID()}`);
    expect(res.status).toBe(404);
  });

  it('updates only the supplied fields', async () => {
    const created = await create();
    const res = await json('PUT', `/api/insured/${created.id}`, {
      monthly_premium: 500,
      self_retention: 600,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.monthly_premium).toBe(500);
    expect(body.self_retention).toBe(600);
    expect(body.kvnr).toBe('A123456789');
  });

  it('deletes an insured person (204) and cascades to its invoices', async () => {
    const created = await create();
    handle.db
      .insert(invoices)
      .values({
        insuredPersonId: created.id,
        invoiceDate: '2026-06-01',
        providerName: 'Dr. Müller',
        totalAmount: 85,
      })
      .run();

    const res = await json('DELETE', `/api/insured/${created.id}`);
    expect(res.status).toBe(204);
    expect(handle.db.select().from(invoices).all()).toHaveLength(0);
  });

  it('returns 404 when deleting an unknown insured person', async () => {
    const res = await json('DELETE', `/api/insured/${crypto.randomUUID()}`);
    expect(res.status).toBe(404);
  });
});

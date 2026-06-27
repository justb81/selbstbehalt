// SPDX-License-Identifier: Apache-2.0
//
// Integration tests for /api/contracts (#11): happy paths, 404s, validation
// errors, the person_id filter, and the cascade on delete. Each test runs
// against a fresh in-memory database with the checked-in migrations applied.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createDb, type DbHandle } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { invoices, persons } from '../db/schema.js';

let handle: DbHandle;
let app: ReturnType<typeof createApp>;
let personId: string;

beforeEach(() => {
  handle = createDb(':memory:');
  runMigrations(handle);
  app = createApp({ db: handle.db, config: loadConfig({}) });
  personId = handle.db.insert(persons).values({ name: 'Erika Mustermann' }).returning().get().id;
});

afterEach(() => {
  if (handle.sqlite.open) handle.sqlite.close();
});

const baseContract = () => ({
  person_id: personId,
  insurer_name: 'DKV',
  type: 'vollversicherung' as const,
  start_date: '2024-01-01',
  monthly_premium: 452.3,
});

function post(body: unknown) {
  return app.request('/api/contracts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/contracts', () => {
  it('creates a contract and returns 201 with a generated id', async () => {
    const res = await post(baseContract());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toMatch(/[0-9a-f-]{36}/);
    expect(body.insurer_name).toBe('DKV');
    // DB DEFAULT applied for the omitted Selbstbehalt.
    expect(body.self_retention).toBe(0);
  });

  it('persists and types the bre_structure JSON', async () => {
    const res = await post({
      ...baseContract(),
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

  it('rejects an invalid payload with 400', async () => {
    const res = await post({ ...baseContract(), type: 'reise' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.status).toBe(400);
  });

  it('rejects a contract for a non-existent person with 400', async () => {
    const res = await post({ ...baseContract(), person_id: crypto.randomUUID() });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/contracts', () => {
  it('lists contracts and filters by person_id', async () => {
    const other = handle.db.insert(persons).values({ name: 'Max' }).returning().get().id;
    await post(baseContract());
    await post({ ...baseContract(), person_id: other, insurer_name: 'Allianz' });

    const all = await (await app.request('/api/contracts')).json();
    expect(all).toHaveLength(2);

    const filtered = await (await app.request(`/api/contracts?person_id=${personId}`)).json();
    expect(filtered).toHaveLength(1);
    expect(filtered[0].insurer_name).toBe('DKV');
  });
});

describe('GET /api/contracts/:id', () => {
  it('returns a single contract', async () => {
    const created = await (await post(baseContract())).json();
    const res = await app.request(`/api/contracts/${created.id}`);
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(created.id);
  });

  it('returns 404 for an unknown id', async () => {
    const res = await app.request(`/api/contracts/${crypto.randomUUID()}`);
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/contracts/:id', () => {
  it('updates only the supplied fields', async () => {
    const created = await (await post(baseContract())).json();
    const res = await app.request(`/api/contracts/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monthly_premium: 500, self_retention: 600 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.monthly_premium).toBe(500);
    expect(body.self_retention).toBe(600);
    expect(body.insurer_name).toBe('DKV');
  });

  it('returns 404 when updating an unknown contract', async () => {
    const res = await app.request(`/api/contracts/${crypto.randomUUID()}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monthly_premium: 500 }),
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/contracts/:id', () => {
  it('deletes a contract (204) and cascades to its invoices', async () => {
    const created = await (await post(baseContract())).json();
    handle.db
      .insert(invoices)
      .values({
        contractId: created.id,
        invoiceDate: '2026-06-01',
        providerName: 'Dr. Müller',
        totalAmount: 85,
      })
      .run();

    const res = await app.request(`/api/contracts/${created.id}`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(handle.db.select().from(invoices).all()).toHaveLength(0);
  });

  it('returns 404 when deleting an unknown contract', async () => {
    const res = await app.request(`/api/contracts/${crypto.randomUUID()}`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});

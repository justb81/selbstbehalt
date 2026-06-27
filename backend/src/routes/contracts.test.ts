// SPDX-License-Identifier: Apache-2.0
//
// Integration tests for /api/contracts (#11): happy paths, 404s, validation
// errors, the policyholder_id filter, and the cascade on delete. Each test runs
// against a fresh in-memory database with the checked-in migrations applied.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createDb, type DbHandle } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { insuredPersons, invoices, persons } from '../db/schema.js';

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
  policyholder_id: personId,
  insurer_name: 'DKV',
  type: 'vollversicherung' as const,
  start_date: '2024-01-01',
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
    expect(body.policyholder_id).toBe(personId);
  });

  it('rejects an invalid payload with 400', async () => {
    const res = await post({ ...baseContract(), type: 'reise' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.status).toBe(400);
  });

  it('rejects a contract for a non-existent policyholder with 400', async () => {
    const res = await post({ ...baseContract(), policyholder_id: crypto.randomUUID() });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/contracts', () => {
  it('lists contracts and filters by policyholder_id', async () => {
    const other = handle.db.insert(persons).values({ name: 'Max' }).returning().get().id;
    await post(baseContract());
    await post({ ...baseContract(), policyholder_id: other, insurer_name: 'Allianz' });

    const all = await (await app.request('/api/contracts')).json();
    expect(all).toHaveLength(2);

    const filtered = await (await app.request(`/api/contracts?policyholder_id=${personId}`)).json();
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
      body: JSON.stringify({ contract_number: 'KV-999', notes: 'aktualisiert' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contract_number).toBe('KV-999');
    expect(body.notes).toBe('aktualisiert');
    expect(body.insurer_name).toBe('DKV');
  });

  it('returns 404 when updating an unknown contract', async () => {
    const res = await app.request(`/api/contracts/${crypto.randomUUID()}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contract_number: 'KV-999' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/contracts/:id', () => {
  it('deletes a contract (204) and cascades to its insured persons and invoices', async () => {
    const created = await (await post(baseContract())).json();
    const insuredId = handle.db
      .insert(insuredPersons)
      .values({ contractId: created.id, personId, monthlyPremium: 452.3 })
      .returning()
      .get().id;
    handle.db
      .insert(invoices)
      .values({
        insuredPersonId: insuredId,
        invoiceDate: '2026-06-01',
        providerName: 'Dr. Müller',
        totalAmount: 85,
      })
      .run();

    const res = await app.request(`/api/contracts/${created.id}`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(handle.db.select().from(insuredPersons).all()).toHaveLength(0);
    expect(handle.db.select().from(invoices).all()).toHaveLength(0);
  });

  it('returns 404 when deleting an unknown contract', async () => {
    const res = await app.request(`/api/contracts/${crypto.randomUUID()}`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});

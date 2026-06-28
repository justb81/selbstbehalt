// SPDX-License-Identifier: Apache-2.0
//
// Integration tests for /api/invoices (#12): atomic invoice+positions creation,
// detail-with-positions, the filter query, and the submit/refund status machine.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createDb, type DbHandle } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { contracts, insuredPersons, invoicePositions, persons } from '../db/schema.js';

let handle: DbHandle;
let app: ReturnType<typeof createApp>;
let insuredPersonId: string;

beforeEach(() => {
  handle = createDb(':memory:');
  runMigrations(handle);
  app = createApp({ db: handle.db, config: loadConfig({}) });
  const db = handle.db;
  const personId = db.insert(persons).values({ name: 'Erika' }).returning().get().id;
  const contractId = db
    .insert(contracts)
    .values({
      policyholderId: personId,
      insurerName: 'DKV',
      type: 'vollversicherung',
      startDate: '2024-01-01',
    })
    .returning()
    .get().id;
  insuredPersonId = db
    .insert(insuredPersons)
    .values({ contractId, personId, monthlyPremium: 452.3 })
    .returning()
    .get().id;
});

afterEach(() => {
  if (handle.sqlite.open) handle.sqlite.close();
});

const baseInvoice = () => ({
  insured_person_id: insuredPersonId,
  invoice_date: '2026-06-01',
  provider_name: 'Dr. med. Müller',
  total_amount: 85.0,
});

function json(method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createInvoice(body: unknown = baseInvoice()) {
  const res = await json('POST', '/api/invoices', body);
  return { res, body: await res.json() };
}

describe('POST /api/invoices', () => {
  it('stores an invoice with its positions atomically', async () => {
    const { res, body } = await createInvoice({
      ...baseInvoice(),
      positions: [
        { goae_number: '0001', multiplier: 2.3, base_amount: 4.66, charged_amount: 10.72 },
        {
          goae_number: '0340',
          multiplier: 3.5,
          base_amount: 20.11,
          charged_amount: 70.39,
          is_valid: false,
          flag_reason: 'Steigerungsfaktor überschreitet Regelgrenze',
        },
      ],
    });
    expect(res.status).toBe(201);
    expect(body.positions).toHaveLength(2);
    expect(body.positions[1].is_valid).toBe(false);
    expect(body.status).toBe('neu');
  });

  it('rolls back the invoice when a position is invalid (atomicity)', async () => {
    const res = await json('POST', '/api/invoices', {
      ...baseInvoice(),
      positions: [{ goae_number: '0001', multiplier: 0, base_amount: 1, charged_amount: 1 }],
    });
    // multiplier 0 fails validation before any insert; nothing is persisted.
    expect(res.status).toBe(400);
    expect(handle.db.select().from(invoicePositions).all()).toHaveLength(0);
  });

  it('rejects an invoice for an unknown insured person with 400', async () => {
    const res = await json('POST', '/api/invoices', {
      ...baseInvoice(),
      insured_person_id: crypto.randomUUID(),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/invoices', () => {
  it('filters by insured person, status, period and search term', async () => {
    await createInvoice({
      ...baseInvoice(),
      invoice_date: '2026-01-15',
      provider_name: 'Zahn Dr. A',
    });
    await createInvoice({ ...baseInvoice(), invoice_date: '2026-08-20', provider_name: 'Dr. B' });

    const byPeriod = await (
      await app.request('/api/invoices?from=2026-06-01&to=2026-12-31')
    ).json();
    expect(byPeriod).toHaveLength(1);
    expect(byPeriod[0].provider_name).toBe('Dr. B');

    const bySearch = await (await app.request('/api/invoices?q=Zahn')).json();
    expect(bySearch).toHaveLength(1);

    const byInsured = await (
      await app.request(`/api/invoices?insured_person_id=${insuredPersonId}`)
    ).json();
    expect(byInsured).toHaveLength(2);

    const byStatus = await (await app.request('/api/invoices?status=erstattet')).json();
    expect(byStatus).toHaveLength(0);
  });

  it('treats LIKE wildcards in the search term literally', async () => {
    await createInvoice({ ...baseInvoice(), provider_name: 'Dr. 50% Rabatt' });
    await createInvoice({ ...baseInvoice(), provider_name: 'Dr. ohne Sonderzeichen' });

    // A literal '%' must not behave as the match-anything wildcard.
    const wildcard = await (await app.request(`/api/invoices?q=${encodeURIComponent('%')}`)).json();
    expect(wildcard).toHaveLength(1);
    expect(wildcard[0].provider_name).toBe('Dr. 50% Rabatt');
  });
});

describe('GET /api/invoices/:id', () => {
  it('returns the invoice with its positions', async () => {
    const { body } = await createInvoice({
      ...baseInvoice(),
      positions: [
        { goae_number: '0001', multiplier: 2.3, base_amount: 4.66, charged_amount: 10.72 },
      ],
    });
    const res = await app.request(`/api/invoices/${body.id}`);
    expect(res.status).toBe(200);
    const detail = await res.json();
    expect(detail.positions).toHaveLength(1);
    expect(detail.positions[0].goae_number).toBe('0001');
  });

  it('returns 404 for an unknown invoice', async () => {
    const res = await app.request(`/api/invoices/${crypto.randomUUID()}`);
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/invoices/:id', () => {
  it('updates invoice metadata and keeps positions', async () => {
    const { body } = await createInvoice({
      ...baseInvoice(),
      positions: [
        { goae_number: '0001', multiplier: 2.3, base_amount: 4.66, charged_amount: 10.72 },
      ],
    });
    const res = await json('PUT', `/api/invoices/${body.id}`, { status: 'geprüft', notes: 'ok' });
    const updated = await res.json();
    expect(updated.status).toBe('geprüft');
    expect(updated.notes).toBe('ok');
    expect(updated.positions).toHaveLength(1);
  });
});

describe('DELETE /api/invoices/:id', () => {
  it('deletes an invoice (204) and cascades to positions', async () => {
    const { body } = await createInvoice({
      ...baseInvoice(),
      positions: [
        { goae_number: '0001', multiplier: 2.3, base_amount: 4.66, charged_amount: 10.72 },
      ],
    });
    const res = await json('DELETE', `/api/invoices/${body.id}`);
    expect(res.status).toBe(204);
    expect(handle.db.select().from(invoicePositions).all()).toHaveLength(0);
  });
});

describe('POST /api/invoices/:id/submit', () => {
  it('records a submission and moves the invoice to eingereicht', async () => {
    const { body } = await createInvoice();
    const res = await json('POST', `/api/invoices/${body.id}/submit`, {
      submitted_via: 'email',
      expected_refund: 62.5,
    });
    expect(res.status).toBe(201);
    const submission = await res.json();
    expect(submission.invoice_id).toBe(body.id);
    expect(submission.submitted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const detail = await (await app.request(`/api/invoices/${body.id}`)).json();
    expect(detail.status).toBe('eingereicht');
  });

  it('rejects submitting an already-submitted invoice with 409', async () => {
    const { body } = await createInvoice();
    await json('POST', `/api/invoices/${body.id}/submit`, { submitted_via: 'email' });
    const res = await json('POST', `/api/invoices/${body.id}/submit`, { submitted_via: 'post' });
    expect(res.status).toBe(409);
  });

  it('returns 404 when submitting an unknown invoice', async () => {
    const res = await json('POST', `/api/invoices/${crypto.randomUUID()}/submit`, {});
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/invoices/:id/refund', () => {
  async function submitted() {
    const { body } = await createInvoice();
    await json('POST', `/api/invoices/${body.id}/submit`, { submitted_via: 'email' });
    return body.id as string;
  }

  it('records a refund and moves the invoice to erstattet', async () => {
    const id = await submitted();
    const res = await json('PUT', `/api/invoices/${id}/refund`, {
      actual_refund: 62.5,
      refund_date: '2026-07-01',
    });
    expect(res.status).toBe(200);
    expect((await res.json()).actual_refund).toBe(62.5);

    const detail = await (await app.request(`/api/invoices/${id}`)).json();
    expect(detail.status).toBe('erstattet');
  });

  it('marks the invoice abgelehnt when a rejection reason is given', async () => {
    const id = await submitted();
    await json('PUT', `/api/invoices/${id}/refund`, {
      actual_refund: 0,
      rejection_reason: 'Leistung nicht im Tarif',
    });
    const detail = await (await app.request(`/api/invoices/${id}`)).json();
    expect(detail.status).toBe('abgelehnt');
  });

  it('rejects refunding an invoice that was never submitted with 409', async () => {
    const { body } = await createInvoice();
    const res = await json('PUT', `/api/invoices/${body.id}/refund`, { actual_refund: 10 });
    expect(res.status).toBe(409);
  });
});

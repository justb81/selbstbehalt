// SPDX-License-Identifier: Apache-2.0
//
// Integration tests for /api/invoices (#12/#139/#142): atomic invoice+positions
// creation, detail-with-positions, the filter query, and the two independent
// lifecycle tracks (review / payment / submission) derived from the event log.

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

const review = (id: string, status = 'geprüft', extra: object = {}) =>
  json('POST', `/api/invoices/${id}/review`, { status, ...extra });
const pay = (id: string, extra: object = {}) =>
  json('POST', `/api/invoices/${id}/payment`, { status: 'bezahlt', ...extra });
const getDetail = async (id: string) => (await app.request(`/api/invoices/${id}`)).json();

describe('POST /api/invoices', () => {
  it('stores an invoice with its positions atomically and starts in the ground state', async () => {
    const { res, body } = await createInvoice({
      ...baseInvoice(),
      positions: [
        {
          goae_number: '0001',
          treatment_date: '2026-06-01',
          multiplier: 2.3,
          base_amount: 4.66,
          charged_amount: 10.72,
        },
        {
          goae_number: '0340',
          treatment_date: '2026-06-01',
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
    expect(body.status).toEqual({
      review: 'neu',
      payment: 'offen',
      submission: 'nicht_eingereicht',
      paid_on: null,
    });
  });

  it('rejects a client-set status field (lifecycle is server-derived)', async () => {
    const res = await json('POST', '/api/invoices', { ...baseInvoice(), status: 'geprüft' });
    expect(res.status).toBe(400);
  });

  it('rejects an Arznei-/Hilfsmittel position whose Gesamtbetrag ≠ Anzahl × Basis with 400', async () => {
    const res = await json('POST', '/api/invoices', {
      ...baseInvoice(),
      positions: [
        {
          goae_number: '',
          goae_category: 'Arznei-/Hilfsmittel',
          treatment_date: '2026-06-01',
          quantity: 2,
          multiplier: 1,
          base_amount: 24.95,
          charged_amount: 40.0, // should be 49.90
        },
      ],
    });
    expect(res.status).toBe(400);
    expect(handle.db.select().from(invoicePositions).all()).toHaveLength(0);
  });

  it('rolls back the invoice when a position is invalid (atomicity)', async () => {
    const res = await json('POST', '/api/invoices', {
      ...baseInvoice(),
      positions: [
        {
          goae_number: '0001',
          treatment_date: '2026-06-01',
          multiplier: 0,
          base_amount: 1,
          charged_amount: 1,
        },
      ],
    });
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
  it('filters by insured person, track status, period and search term', async () => {
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

    const bySubmission = await (await app.request('/api/invoices?submission=erstattet')).json();
    expect(bySubmission).toHaveLength(0);
    const byPayment = await (await app.request('/api/invoices?payment=offen')).json();
    expect(byPayment).toHaveLength(2);
  });

  it('filters by an independent track once it has moved', async () => {
    const { body: a } = await createInvoice({ ...baseInvoice(), provider_name: 'Paid Dr.' });
    await createInvoice({ ...baseInvoice(), provider_name: 'Open Dr.' });
    await review(a.id);
    await pay(a.id);

    const paid = await (await app.request('/api/invoices?payment=bezahlt')).json();
    expect(paid).toHaveLength(1);
    expect(paid[0].provider_name).toBe('Paid Dr.');
    expect(paid[0].status.payment).toBe('bezahlt');
  });

  it('treats LIKE wildcards in the search term literally', async () => {
    await createInvoice({ ...baseInvoice(), provider_name: 'Dr. 50% Rabatt' });
    await createInvoice({ ...baseInvoice(), provider_name: 'Dr. ohne Sonderzeichen' });

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
        {
          goae_number: '0001',
          treatment_date: '2026-06-01',
          multiplier: 2.3,
          base_amount: 4.66,
          charged_amount: 10.72,
        },
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
  it('updates invoice metadata while it is unpaid and unsubmitted', async () => {
    const { body } = await createInvoice({
      ...baseInvoice(),
      positions: [
        {
          goae_number: '0001',
          treatment_date: '2026-06-01',
          multiplier: 2.3,
          base_amount: 4.66,
          charged_amount: 10.72,
        },
      ],
    });
    await review(body.id); // geprüft alone does not lock editing
    const res = await json('PUT', `/api/invoices/${body.id}`, { notes: 'ok' });
    const updated = await res.json();
    expect(res.status).toBe(200);
    expect(updated.notes).toBe('ok');
    expect(updated.positions).toHaveLength(1);
  });

  it('locks editing once the invoice is paid (422)', async () => {
    const { body } = await createInvoice();
    await review(body.id);
    await pay(body.id);
    const res = await json('PUT', `/api/invoices/${body.id}`, { notes: 'zu spät' });
    expect(res.status).toBe(422);
  });

  it('locks editing once the invoice is submitted (422)', async () => {
    const { body } = await createInvoice();
    await review(body.id);
    await json('POST', `/api/invoices/${body.id}/submit`, { submitted_via: 'email' });
    const res = await json('PUT', `/api/invoices/${body.id}`, { notes: 'zu spät' });
    expect(res.status).toBe(422);
  });
});

describe('DELETE /api/invoices/:id', () => {
  it('deletes an invoice (204) and cascades to positions', async () => {
    const { body } = await createInvoice({
      ...baseInvoice(),
      positions: [
        {
          goae_number: '0001',
          treatment_date: '2026-06-01',
          multiplier: 2.3,
          base_amount: 4.66,
          charged_amount: 10.72,
        },
      ],
    });
    const res = await json('DELETE', `/api/invoices/${body.id}`);
    expect(res.status).toBe(204);
    expect(handle.db.select().from(invoicePositions).all()).toHaveLength(0);
  });
});

describe('POST /api/invoices/:id/review', () => {
  it('toggles neu → geprüft', async () => {
    const { body } = await createInvoice();
    const res = await review(body.id);
    expect(res.status).toBe(200);
    expect((await res.json()).status.review).toBe('geprüft');
  });

  it('allows geprüft → neu while payment and submission are untouched', async () => {
    const { body } = await createInvoice();
    await review(body.id);
    const res = await review(body.id, 'neu');
    expect(res.status).toBe(200);
    expect((await res.json()).status.review).toBe('neu');
  });

  it('rejects geprüft → neu once the invoice is paid (409)', async () => {
    const { body } = await createInvoice();
    await review(body.id);
    await pay(body.id);
    const res = await review(body.id, 'neu');
    expect(res.status).toBe(409);
  });

  it('rejects setting the review status it already has (409)', async () => {
    const { body } = await createInvoice();
    const res = await review(body.id, 'neu');
    expect(res.status).toBe(409);
  });
});

describe('POST /api/invoices/:id/payment', () => {
  it('marks a reviewed invoice as bezahlt and records the payment date', async () => {
    const { body } = await createInvoice();
    await review(body.id);
    const res = await pay(body.id, { paid_on: '2026-07-15' });
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.status.payment).toBe('bezahlt');
    expect(updated.status.paid_on).toBe('2026-07-15');
  });

  it('defaults the payment date to today when omitted', async () => {
    const { body } = await createInvoice();
    await review(body.id);
    const updated = await (await pay(body.id)).json();
    expect(updated.status.paid_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('rejects paying an unreviewed invoice (409)', async () => {
    const { body } = await createInvoice();
    const res = await pay(body.id);
    expect(res.status).toBe(409);
  });

  it('reverts bezahlt → offen and clears the payment date', async () => {
    const { body } = await createInvoice();
    await review(body.id);
    await pay(body.id, { paid_on: '2026-07-15' });
    const res = await json('POST', `/api/invoices/${body.id}/payment`, { status: 'offen' });
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.status.payment).toBe('offen');
    expect(updated.status.paid_on).toBeNull();
  });
});

describe('POST /api/invoices/:id/submit', () => {
  it('submits a reviewed invoice without requiring payment first (parallel tracks)', async () => {
    const { body } = await createInvoice();
    await review(body.id);
    const res = await json('POST', `/api/invoices/${body.id}/submit`, {
      submitted_via: 'email',
      expected_refund: 62.5,
    });
    expect(res.status).toBe(201);
    const submission = await res.json();
    expect(submission.invoice_id).toBe(body.id);
    expect(submission.submitted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const detail = await getDetail(body.id);
    expect(detail.status.submission).toBe('eingereicht');
    // Payment is still open — reimbursement can precede paying the doctor.
    expect(detail.status.payment).toBe('offen');
  });

  it('rejects submitting an unreviewed invoice with 409', async () => {
    const { body } = await createInvoice();
    const res = await json('POST', `/api/invoices/${body.id}/submit`, { submitted_via: 'email' });
    expect(res.status).toBe(409);
  });

  it('rejects submitting an already-submitted invoice with 409', async () => {
    const { body } = await createInvoice();
    await review(body.id);
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
  async function submittedWithPosition() {
    const { body } = await createInvoice({
      ...baseInvoice(),
      positions: [
        {
          goae_number: '0001',
          treatment_date: '2026-06-01',
          multiplier: 2.3,
          base_amount: 4.66,
          charged_amount: 10.72,
        },
      ],
    });
    await review(body.id);
    await json('POST', `/api/invoices/${body.id}/submit`, { submitted_via: 'email' });
    return { invoiceId: body.id as string, positionId: body.positions[0].id as string };
  }

  it('records a refund and moves the submission track to erstattet', async () => {
    const { invoiceId, positionId } = await submittedWithPosition();
    const res = await json('PUT', `/api/invoices/${invoiceId}/refund`, {
      positions: [{ id: positionId, refund_amount: 62.5 }],
      refund_date: '2026-07-01',
    });
    expect(res.status).toBe(200);
    const detail = await getDetail(invoiceId);
    expect(detail.status.submission).toBe('erstattet');
    expect(detail.positions[0].refund_amount).toBe(62.5);
  });

  it('records a zero refund (Ablehnung) and moves the submission track to erstattet', async () => {
    const { invoiceId, positionId } = await submittedWithPosition();
    await json('PUT', `/api/invoices/${invoiceId}/refund`, {
      positions: [{ id: positionId, refund_amount: 0 }],
      note: 'Leistung nicht im Tarif',
    });
    const detail = await getDetail(invoiceId);
    expect(detail.status.submission).toBe('erstattet');
  });

  it('rejects refunding an invoice that was never submitted with 409', async () => {
    const { body } = await createInvoice();
    const res = await json('PUT', `/api/invoices/${body.id}/refund`, { positions: [] });
    expect(res.status).toBe(409);
  });

  it('corrects an already-recorded refund in place without a new status event', async () => {
    const { invoiceId, positionId } = await submittedWithPosition();
    await json('PUT', `/api/invoices/${invoiceId}/refund`, {
      positions: [{ id: positionId, refund_amount: 62.5 }],
      refund_date: '2026-07-01',
    });

    const res = await json('PUT', `/api/invoices/${invoiceId}/refund`, {
      positions: [{ id: positionId, refund_amount: 55 }],
      refund_date: '2026-07-05',
    });
    expect(res.status).toBe(200);
    const detail = await res.json();
    expect(detail.status.submission).toBe('erstattet');
    expect(detail.positions[0].refund_amount).toBe(55);

    const events = await (await app.request(`/api/invoices/${invoiceId}/events`)).json();
    expect(events.filter((e: { status: string }) => e.status === 'erstattet')).toHaveLength(1);
  });
});

describe('GET/PUT /api/invoices/:id/submission', () => {
  async function submittedInvoice() {
    const { body } = await createInvoice();
    await review(body.id);
    await json('POST', `/api/invoices/${body.id}/submit`, {
      submitted_via: 'email',
      expected_refund: 62.5,
    });
    return body.id as string;
  }

  it('returns the current submission', async () => {
    const invoiceId = await submittedInvoice();
    const res = await app.request(`/api/invoices/${invoiceId}/submission`);
    expect(res.status).toBe(200);
    const submission = await res.json();
    expect(submission.submitted_via).toBe('email');
    expect(submission.expected_refund).toBe(62.5);
  });

  it('returns 404 when the invoice was never submitted', async () => {
    const { body } = await createInvoice();
    const res = await app.request(`/api/invoices/${body.id}/submission`);
    expect(res.status).toBe(404);
  });

  it('corrects the submission in place while staying eingereicht', async () => {
    const invoiceId = await submittedInvoice();
    const res = await json('PUT', `/api/invoices/${invoiceId}/submission`, {
      submitted_via: 'post',
      expected_refund: 70,
    });
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.submitted_via).toBe('post');
    expect(updated.expected_refund).toBe(70);

    const detail = await getDetail(invoiceId);
    expect(detail.status.submission).toBe('eingereicht');
  });

  it('rejects editing the submission of a non-eingereicht invoice with 409', async () => {
    const { body } = await createInvoice();
    await review(body.id);
    const res = await json('PUT', `/api/invoices/${body.id}/submission`, { submitted_via: 'post' });
    expect(res.status).toBe(409);
  });
});

describe('POST /api/invoices/:id/submission/revert', () => {
  it('reverts eingereicht back to nicht_eingereicht and deletes the submission', async () => {
    const { body } = await createInvoice();
    await review(body.id);
    await json('POST', `/api/invoices/${body.id}/submit`, { submitted_via: 'email' });

    const res = await json('POST', `/api/invoices/${body.id}/submission/revert`, {});
    expect(res.status).toBe(200);
    const detail = await res.json();
    expect(detail.status.submission).toBe('nicht_eingereicht');

    const submissionRes = await app.request(`/api/invoices/${body.id}/submission`);
    expect(submissionRes.status).toBe(404);

    // It can be submitted again.
    const resubmit = await json('POST', `/api/invoices/${body.id}/submit`, {
      submitted_via: 'post',
    });
    expect(resubmit.status).toBe(201);
  });

  it('reverts erstattet back to eingereicht and clears the refund amounts', async () => {
    const { body } = await createInvoice({
      ...baseInvoice(),
      positions: [
        {
          goae_number: '0001',
          treatment_date: '2026-06-01',
          multiplier: 2.3,
          base_amount: 4.66,
          charged_amount: 10.72,
        },
      ],
    });
    await review(body.id);
    await json('POST', `/api/invoices/${body.id}/submit`, { submitted_via: 'email' });
    await json('PUT', `/api/invoices/${body.id}/refund`, {
      positions: [{ id: body.positions[0].id, refund_amount: 10.72 }],
      refund_date: '2026-07-01',
    });

    const res = await json('POST', `/api/invoices/${body.id}/submission/revert`, {});
    expect(res.status).toBe(200);
    const detail = await res.json();
    expect(detail.status.submission).toBe('eingereicht');
    expect(detail.positions[0].refund_amount).toBeNull();
    expect(detail.self_paid_amount).toBe(10.72);

    const submission = await (await app.request(`/api/invoices/${body.id}/submission`)).json();
    expect(submission.refund_date).toBeNull();
  });

  it('logs the revert as a submission status event', async () => {
    const { body } = await createInvoice();
    await review(body.id);
    await json('POST', `/api/invoices/${body.id}/submit`, { submitted_via: 'email' });
    await json('POST', `/api/invoices/${body.id}/submission/revert`, {
      note: 'Falsch eingereicht',
    });

    const events = await (await app.request(`/api/invoices/${body.id}/events`)).json();
    expect(events[0].track).toBe('submission');
    expect(events[0].status).toBe('nicht_eingereicht');
    expect(events[0].note).toBe('Falsch eingereicht');
  });

  it('rejects reverting a never-submitted invoice with 409', async () => {
    const { body } = await createInvoice();
    const res = await json('POST', `/api/invoices/${body.id}/submission/revert`, {});
    expect(res.status).toBe(409);
  });

  it('returns 404 when reverting an unknown invoice', async () => {
    const res = await json('POST', `/api/invoices/${crypto.randomUUID()}/submission/revert`, {});
    expect(res.status).toBe(404);
  });
});

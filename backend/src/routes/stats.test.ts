// SPDX-License-Identifier: Apache-2.0
//
// Integration tests for /api/stats (#13). A fresh in-memory database is seeded
// with invoices, submissions and BRE periods spanning several years, then the
// year roll-up and the BRE history are asserted against the known totals.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createDb, type DbHandle } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { brePeriods, contracts, invoices, persons, submissions } from '../db/schema.js';

let handle: DbHandle;
let app: ReturnType<typeof createApp>;
let contractId: string;

/** Three-tier ladder (12/24/36 months → 1/2/3 premiums) at a €200 premium. */
const ladder = {
  type: 'staffel' as const,
  levels: [
    { leistungsfrei_months: 12, bre_months: 1, pct_of_premium: 100 },
    { leistungsfrei_months: 24, bre_months: 2, pct_of_premium: 100 },
    { leistungsfrei_months: 36, bre_months: 3, pct_of_premium: 100 },
  ],
  current_streak_start: '2024-01-01',
};

beforeEach(() => {
  handle = createDb(':memory:');
  runMigrations(handle);
  app = createApp({ db: handle.db, config: loadConfig({}) });
  const db = handle.db;

  const personId = db.insert(persons).values({ name: 'Erika Mustermann' }).returning().get().id;
  contractId = db
    .insert(contracts)
    .values({
      personId,
      insurerName: 'DKV',
      type: 'vollversicherung',
      startDate: '2024-01-01',
      monthlyPremium: 200,
      breStructure: ladder,
    })
    .returning()
    .get().id;

  // Invoices: two in 2025, two in 2026 (one with a NULL eligible amount).
  const inv2025a = db
    .insert(invoices)
    .values({
      contractId,
      invoiceDate: '2025-03-01',
      providerName: 'Dr. A',
      totalAmount: 100,
      eligibleAmount: 80,
      selfPaidAmount: 20,
      status: 'erstattet',
    })
    .returning()
    .get();
  db.insert(invoices)
    .values({
      contractId,
      invoiceDate: '2025-07-01',
      providerName: 'Dr. B',
      totalAmount: 200,
      eligibleAmount: 150,
      selfPaidAmount: 50,
    })
    .run();
  const inv2026c = db
    .insert(invoices)
    .values({
      contractId,
      invoiceDate: '2026-02-01',
      providerName: 'Dr. C',
      totalAmount: 300,
      eligibleAmount: 250,
      selfPaidAmount: 50,
      status: 'erstattet',
    })
    .returning()
    .get();
  db.insert(invoices)
    .values({
      contractId,
      invoiceDate: '2026-09-01',
      providerName: 'Dr. D',
      totalAmount: 120,
      // eligibleAmount omitted (NULL) — must COALESCE to 0 in the sum.
    })
    .run();

  // Refunds received: €80 in 2025, €250 in 2026 (by refund_date).
  db.insert(submissions)
    .values({ invoiceId: inv2025a.id, actualRefund: 80, refundDate: '2025-04-01' })
    .run();
  db.insert(submissions)
    .values({ invoiceId: inv2026c.id, actualRefund: 250, refundDate: '2026-03-15' })
    .run();

  // BRE ladder progression across three years.
  db.insert(brePeriods)
    .values([
      { contractId, year: 2024, streakMonths: 0, breAmount: 0 },
      { contractId, year: 2025, streakMonths: 12, breAmount: 200 },
      { contractId, year: 2026, streakMonths: 24, breAmount: 400 },
    ])
    .run();
});

afterEach(() => {
  if (handle.sqlite.open) handle.sqlite.close();
});

describe('GET /api/stats/year/:year', () => {
  it('aggregates the 2026 totals (costs, refunds, BRE)', async () => {
    const res = await app.request('/api/stats/year/2026');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      year: 2026,
      invoice_count: 2,
      total_amount: 420,
      eligible_amount: 250, // Dr. D's NULL eligible coalesces to 0
      self_paid_amount: 50,
      refund_amount: 250,
      bre_amount: 400,
    });
  });

  it('aggregates a different year independently', async () => {
    const res = await app.request('/api/stats/year/2025');
    expect(await res.json()).toEqual({
      year: 2025,
      invoice_count: 2,
      total_amount: 300,
      eligible_amount: 230,
      self_paid_amount: 70,
      refund_amount: 80,
      bre_amount: 200,
    });
  });

  it('returns zeroed sums for a year with no data', async () => {
    const res = await app.request('/api/stats/year/2099');
    expect(await res.json()).toEqual({
      year: 2099,
      invoice_count: 0,
      total_amount: 0,
      eligible_amount: 0,
      self_paid_amount: 0,
      refund_amount: 0,
      bre_amount: 0,
    });
  });

  it('rejects a non-numeric year with 400', async () => {
    const res = await app.request('/api/stats/year/abcd');
    expect(res.status).toBe(400);
    expect((await res.json()).error.status).toBe(400);
  });
});

describe('GET /api/stats/bre/:contractId', () => {
  it('returns the ladder progression with helper-computed projections', async () => {
    const res = await app.request(`/api/stats/bre/${contractId}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      contract_id: contractId,
      years: [
        // streak 0 still aims at the first level (1 × €200)
        { year: 2024, streak_months: 0, bre_amount: 0, projected_bre: 200 },
        // 12 months → first level (1 × €200)
        { year: 2025, streak_months: 12, bre_amount: 200, projected_bre: 200 },
        // 24 months → second level (2 × €200)
        { year: 2026, streak_months: 24, bre_amount: 400, projected_bre: 400 },
      ],
    });
  });

  it('falls back to the stored projection when the contract has no bre_structure', async () => {
    const db = handle.db;
    const personId = db.insert(persons).values({ name: 'Max' }).returning().get().id;
    const bare = db
      .insert(contracts)
      .values({
        personId,
        insurerName: 'Allianz',
        type: 'zusatztarif',
        startDate: '2024-01-01',
        monthlyPremium: 50,
      })
      .returning()
      .get();
    db.insert(brePeriods)
      .values([
        { contractId: bare.id, year: 2025, streakMonths: 12, breAmount: 0, projectedBre: 99 },
        { contractId: bare.id, year: 2026, streakMonths: 24, breAmount: 0 },
      ])
      .run();

    const res = await app.request(`/api/stats/bre/${bare.id}`);
    const body = await res.json();
    expect(body.years).toEqual([
      { year: 2025, streak_months: 12, bre_amount: 0, projected_bre: 99 },
      { year: 2026, streak_months: 24, bre_amount: 0, projected_bre: null },
    ]);
  });

  it('returns an empty history for a contract without BRE periods', async () => {
    const db = handle.db;
    const personId = db.insert(persons).values({ name: 'Lea' }).returning().get().id;
    const fresh = db
      .insert(contracts)
      .values({
        personId,
        insurerName: 'Barmenia',
        type: 'vollversicherung',
        startDate: '2026-01-01',
        monthlyPremium: 300,
      })
      .returning()
      .get();
    const res = await app.request(`/api/stats/bre/${fresh.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ contract_id: fresh.id, years: [] });
  });

  it('returns 404 for an unknown contract', async () => {
    const res = await app.request(`/api/stats/bre/${crypto.randomUUID()}`);
    expect(res.status).toBe(404);
  });
});

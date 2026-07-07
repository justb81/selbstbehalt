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
import {
  brePeriods,
  contracts,
  insuredPersons,
  invoicePositions,
  invoices,
  persons,
  submissions,
} from '../db/schema.js';

let handle: DbHandle;
let app: ReturnType<typeof createApp>;
let insuredPersonId: string;

/** Three-tier ladder (1/2/3 years → 1/2/3 premiums) at a €200 premium. */
const ladder = {
  type: 'staffel' as const,
  levels: [
    { claim_free_years: 1, bre_years: 1, pct_of_premium: 100 },
    { claim_free_years: 2, bre_years: 2, pct_of_premium: 100 },
    { claim_free_years: 3, bre_years: 3, pct_of_premium: 100 },
  ],
  current_streak_start: '2024-01-01',
};

beforeEach(() => {
  handle = createDb(':memory:');
  runMigrations(handle);
  app = createApp({ db: handle.db, config: loadConfig({}) });
  const db = handle.db;

  const personId = db.insert(persons).values({ name: 'Erika Mustermann' }).returning().get().id;
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
    .values({ contractId, personId, monthlyPremium: 200, breStructure: ladder })
    .returning()
    .get().id;

  // Invoices: two in 2025, two in 2026 (one with a NULL eligible amount).
  const inv2025a = db
    .insert(invoices)
    .values({
      insuredPersonId,
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
      insuredPersonId,
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
      insuredPersonId,
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
      insuredPersonId,
      invoiceDate: '2026-09-01',
      providerName: 'Dr. D',
      totalAmount: 120,
      // eligibleAmount omitted (NULL) — must COALESCE to 0 in the sum.
    })
    .run();

  // Positions with per-position refund amounts (source of truth).
  db.insert(invoicePositions)
    .values({
      invoiceId: inv2025a.id,
      goaeNumber: '0001',
      treatmentDate: '2025-03-01',
      multiplier: 1,
      baseAmount: 100,
      chargedAmount: 100,
      refundAmount: 80,
    })
    .run();
  db.insert(invoicePositions)
    .values({
      invoiceId: inv2026c.id,
      goaeNumber: '0001',
      treatmentDate: '2026-02-01',
      multiplier: 1,
      baseAmount: 300,
      chargedAmount: 300,
      refundAmount: 250,
    })
    .run();

  // Submissions carry the refund_date; per-position refund_amount is the source of truth.
  db.insert(submissions).values({ invoiceId: inv2025a.id, refundDate: '2025-04-01' }).run();
  db.insert(submissions).values({ invoiceId: inv2026c.id, refundDate: '2026-03-15' }).run();

  // BRE ladder progression across three years.
  db.insert(brePeriods)
    .values([
      { insuredPersonId, year: 2024, streakYears: 0, breAmount: 0 },
      { insuredPersonId, year: 2025, streakYears: 1, breAmount: 200 },
      { insuredPersonId, year: 2026, streakYears: 2, breAmount: 400 },
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

describe('GET /api/stats/bre/:insuredPersonId', () => {
  /** Insert a contract + insured person and return the insured-person id. */
  function makeInsured(
    db: typeof handle.db,
    name: string,
    insurerName: string,
    values: Record<string, unknown>,
  ): string {
    const personId = db.insert(persons).values({ name }).returning().get().id;
    const contractId = db
      .insert(contracts)
      .values({
        policyholderId: personId,
        insurerName,
        type: 'zusatztarif',
        startDate: '2024-01-01',
      })
      .returning()
      .get().id;
    return db
      .insert(insuredPersons)
      .values({ contractId, personId, ...values })
      .returning()
      .get().id;
  }

  it('returns the ladder progression with helper-computed projections', async () => {
    const res = await app.request(`/api/stats/bre/${insuredPersonId}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      insured_person_id: insuredPersonId,
      years: [
        // streak 0 still aims at the first level (1 × €200)
        { year: 2024, streak_years: 0, bre_amount: 0, projected_bre: 200 },
        // 1 year → first level (1 × €200)
        { year: 2025, streak_years: 1, bre_amount: 200, projected_bre: 200 },
        // 2 years → second level (2 × €200)
        { year: 2026, streak_years: 2, bre_amount: 400, projected_bre: 400 },
      ],
    });
  });

  it('falls back to the stored projection when the insured person has no bre_structure', async () => {
    const db = handle.db;
    const bareId = makeInsured(db, 'Max', 'Allianz', { monthlyPremium: 50 });
    db.insert(brePeriods)
      .values([
        { insuredPersonId: bareId, year: 2025, streakYears: 1, breAmount: 0, projectedBre: 99 },
        { insuredPersonId: bareId, year: 2026, streakYears: 2, breAmount: 0 },
      ])
      .run();

    const res = await app.request(`/api/stats/bre/${bareId}`);
    const body = await res.json();
    expect(body.years).toEqual([
      { year: 2025, streak_years: 1, bre_amount: 0, projected_bre: 99 },
      { year: 2026, streak_years: 2, bre_amount: 0, projected_bre: null },
    ]);
  });

  it('returns an empty history for an insured person without BRE periods', async () => {
    const db = handle.db;
    const freshId = makeInsured(db, 'Lea', 'Barmenia', { monthlyPremium: 300 });
    const res = await app.request(`/api/stats/bre/${freshId}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ insured_person_id: freshId, years: [] });
  });

  it('returns 404 for an unknown insured person', async () => {
    const res = await app.request(`/api/stats/bre/${crypto.randomUUID()}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/stats/positions/:insuredPersonId', () => {
  it('rolls positions up by Leistungsjahr per the §5.2.1 status rule', async () => {
    const db = handle.db;

    // 'geprüft': contributes eligible_amount (estimate), not refund_amount.
    const invGepruft = db
      .insert(invoices)
      .values({
        insuredPersonId,
        invoiceDate: '2026-05-01',
        providerName: 'Dr. E',
        totalAmount: 50,
        status: 'geprüft',
      })
      .returning()
      .get();
    db.insert(invoicePositions)
      .values({
        invoiceId: invGepruft.id,
        goaeNumber: '0002',
        treatmentDate: '2026-05-01',
        multiplier: 1,
        baseAmount: 50,
        chargedAmount: 50,
        eligibleAmount: 40,
      })
      .run();

    // 'neu' must be ignored entirely, even though it carries a position.
    const invNeu = db
      .insert(invoices)
      .values({
        insuredPersonId,
        invoiceDate: '2026-08-01',
        providerName: 'Dr. F',
        totalAmount: 999,
      })
      .returning()
      .get();
    db.insert(invoicePositions)
      .values({
        invoiceId: invNeu.id,
        goaeNumber: '0003',
        treatmentDate: '2026-08-01',
        multiplier: 1,
        baseAmount: 999,
        chargedAmount: 999,
        eligibleAmount: 999,
      })
      .run();

    const res = await app.request(`/api/stats/positions/${insuredPersonId}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      insured_person_id: insuredPersonId,
      years: [
        // From the outer beforeEach: inv2025a ('erstattet'), charged 100 / refund 80.
        { year: 2025, charged_amount: 100, eligible_amount: 0, refund_amount: 80 },
        // inv2026c ('erstattet', charged 300 / refund 250) + the 'geprüft' position above;
        // the 'neu' invoice's 999 never enters the sum.
        { year: 2026, charged_amount: 350, eligible_amount: 40, refund_amount: 250 },
      ],
    });
  });

  it('returns an empty roll-up for an insured person without positions', async () => {
    const db = handle.db;
    const personId = db.insert(persons).values({ name: 'Lea' }).returning().get().id;
    const contractId = db
      .insert(contracts)
      .values({
        policyholderId: personId,
        insurerName: 'Barmenia',
        type: 'zusatztarif',
        startDate: '2024-01-01',
      })
      .returning()
      .get().id;
    const freshId = db
      .insert(insuredPersons)
      .values({ contractId, personId, monthlyPremium: 300 })
      .returning()
      .get().id;

    const res = await app.request(`/api/stats/positions/${freshId}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ insured_person_id: freshId, years: [] });
  });

  it('returns 404 for an unknown insured person', async () => {
    const res = await app.request(`/api/stats/positions/${crypto.randomUUID()}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/stats/reductions', () => {
  beforeEach(() => {
    const db = handle.db;

    const personA = db.insert(persons).values({ name: 'Person A' }).returning().get().id;
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
    const insuredA = db
      .insert(insuredPersons)
      .values({
        contractId: contractA,
        personId: personA,
        monthlyPremium: 200,
        tariffName: 'Komfort',
      })
      .returning()
      .get().id;

    const personB = db.insert(persons).values({ name: 'Person B' }).returning().get().id;
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
    const insuredB = db
      .insert(insuredPersons)
      .values({
        contractId: contractB,
        personId: personB,
        monthlyPremium: 150,
        tariffName: 'Basis',
      })
      .returning()
      .get().id;

    const invA = db
      .insert(invoices)
      .values({
        insuredPersonId: insuredA,
        invoiceDate: '2026-02-01',
        providerName: 'Dr. Kürzung',
        providerType: 'arzt',
        totalAmount: 180,
        status: 'erstattet',
      })
      .returning()
      .get();
    db.insert(invoicePositions)
      .values([
        {
          invoiceId: invA.id,
          goaeNumber: '5',
          treatmentDate: '2026-02-01',
          multiplier: 2.3,
          baseAmount: 100,
          chargedAmount: 100,
          eligibleAmount: 100,
          refundAmount: 80,
        },
        {
          // A rejection: refund_amount = 0 while eligible_amount > 0.
          invoiceId: invA.id,
          goaeNumber: '5',
          treatmentDate: '2026-02-01',
          multiplier: 2.3,
          baseAmount: 50,
          chargedAmount: 50,
          eligibleAmount: 50,
          refundAmount: 0,
        },
        {
          // Still open: refund_amount is null, not 0 — must not count as a rejection.
          invoiceId: invA.id,
          goaeNumber: '6',
          treatmentDate: '2026-02-01',
          multiplier: 1,
          baseAmount: 30,
          chargedAmount: 30,
          eligibleAmount: 30,
        },
      ])
      .run();

    const invB = db
      .insert(invoices)
      .values({
        insuredPersonId: insuredB,
        invoiceDate: '2026-03-01',
        providerName: 'Dr. Andere',
        providerType: 'zahnarzt',
        totalAmount: 200,
        status: 'erstattet',
      })
      .returning()
      .get();
    db.insert(invoicePositions)
      .values({
        invoiceId: invB.id,
        goaeNumber: '5',
        treatmentDate: '2026-03-01',
        multiplier: 1,
        baseAmount: 200,
        chargedAmount: 200,
        eligibleAmount: 200,
        refundAmount: 200,
      })
      .run();

    // A non-'erstattet' invoice must never contribute, even with matching data.
    const invGepruft = db
      .insert(invoices)
      .values({
        insuredPersonId: insuredA,
        invoiceDate: '2026-04-01',
        providerName: 'Dr. Kürzung',
        providerType: 'arzt',
        totalAmount: 40,
        status: 'geprüft',
      })
      .returning()
      .get();
    db.insert(invoicePositions)
      .values({
        invoiceId: invGepruft.id,
        goaeNumber: '5',
        treatmentDate: '2026-04-01',
        multiplier: 1,
        baseAmount: 40,
        chargedAmount: 40,
        eligibleAmount: 40,
      })
      .run();
  });

  it('groups the Kürzungs-Roll-up by tariff', async () => {
    const res = await app.request('/api/stats/reductions?group_by=tariff');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.group_by).toBe('tariff');
    const byGroup = Object.fromEntries(
      (body.groups as { group: string | null }[]).map((g) => [g.group, g]),
    );
    expect(byGroup.Komfort).toEqual({
      group: 'Komfort',
      eligible_amount: 150,
      refund_amount: 80,
      reduction_amount: 70,
      rejection_count: 1,
      rejection_amount: 50,
      open_count: 1,
    });
    expect(byGroup.Basis).toEqual({
      group: 'Basis',
      eligible_amount: 200,
      refund_amount: 200,
      reduction_amount: 0,
      rejection_count: 0,
      rejection_amount: 0,
      open_count: 0,
    });
  });

  it('groups by provider_type', async () => {
    const res = await app.request('/api/stats/reductions?group_by=provider_type');
    const body = await res.json();
    const byGroup = Object.fromEntries(
      (body.groups as { group: string | null }[]).map((g) => [g.group, g]),
    );
    expect(byGroup.arzt).toMatchObject({ eligible_amount: 150, refund_amount: 80, open_count: 1 });
    expect(byGroup.zahnarzt).toMatchObject({ eligible_amount: 200, refund_amount: 200 });
  });

  it('groups by goae_number, combining positions across insured persons', async () => {
    const res = await app.request('/api/stats/reductions?group_by=goae_number');
    const body = await res.json();
    const byGroup = Object.fromEntries(
      (body.groups as { group: string | null }[]).map((g) => [g.group, g]),
    );
    expect(byGroup['5']).toEqual({
      group: '5',
      eligible_amount: 350,
      refund_amount: 280,
      reduction_amount: 70,
      rejection_count: 1,
      rejection_amount: 50,
      open_count: 0,
    });
    expect(byGroup['6']).toEqual({
      group: '6',
      eligible_amount: 0,
      refund_amount: 0,
      reduction_amount: 0,
      rejection_count: 0,
      rejection_amount: 0,
      open_count: 1,
    });
  });

  it('rejects an unknown group_by dimension with 400', async () => {
    const res = await app.request('/api/stats/reductions?group_by=nope');
    expect(res.status).toBe(400);
  });

  it('rejects a missing group_by dimension with 400', async () => {
    const res = await app.request('/api/stats/reductions');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/stats/validations', () => {
  it('returns empty roll-ups when nothing is flagged or categorised', async () => {
    const res = await app.request('/api/stats/validations');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ flags: [], multiplier_distribution: [] });
  });

  it('categorises flagged positions by flag_reason and computes the multiplier distribution', async () => {
    const db = handle.db;
    const inv = db
      .insert(invoices)
      .values({
        insuredPersonId,
        invoiceDate: '2026-05-01',
        providerName: 'Dr. Prüf',
        totalAmount: 0,
        status: 'geprüft',
      })
      .returning()
      .get();

    const flagged = [
      {
        goaeNumber: '1',
        flagReason: 'Steigerungsfaktor 3.5 überschreitet den Regelhöchstsatz 2.3 (§5 GOÄ).',
        chargedAmount: 100,
      },
      {
        goaeNumber: '5',
        flagReason:
          'Position 5 ist nur mit festem Gebührensatz (1) berechnungsfähig, abgerechnet wurde Faktor 1.5.',
        chargedAmount: 60,
      },
      {
        goaeNumber: '2',
        flagReason: 'Die Ziffern 2 und 3 sind nicht nebeneinander berechnungsfähig.',
        chargedAmount: 50,
      },
      {
        goaeNumber: '4',
        flagReason:
          'Die Ziffer 4 ist ein Zuschlag und nur zusammen mit einer der Basisleistungen 1 berechnungsfähig.',
        chargedAmount: 20,
      },
      {
        goaeNumber: '6',
        flagReason:
          'Die Ziffer 6 ist Bestandteil der Leistung nach 1 und nicht separat berechnungsfähig.',
        chargedAmount: 10,
      },
      {
        goaeNumber: '7',
        flagReason:
          'Der Höchstwert von 100 EUR (1,0-fach) für die Nummern 7, 8 ist überschritten (Summe: 150 EUR).',
        chargedAmount: 150,
      },
      {
        goaeNumber: '9',
        flagReason: 'Die Ziffer 9 ist höchstens 1× je Sitzung berechnungsfähig, abgerechnet 2×.',
        chargedAmount: 40,
      },
      {
        goaeNumber: '10',
        flagReason: 'Die Ziffer 10 setzt eine Mindestdauer von 10 Minuten voraus (angegeben: 5).',
        chargedAmount: 30,
      },
      {
        goaeNumber: '11',
        flagReason:
          'Die Ziffer 11 ist nur bis zum vollendeten 18. Lebensjahr berechnungsfähig (Patientenalter: 30).',
        chargedAmount: 25,
      },
      {
        goaeNumber: '12',
        flagReason: 'Ziffer 12 ist in der GOÄ-Tabelle nicht bekannt.',
        chargedAmount: 15,
      },
      {
        goaeNumber: '',
        flagReason:
          'Keine GOÄ-Ziffer erkannt (OCR) – bitte Position manuell prüfen und Ziffer ergänzen.',
        chargedAmount: 5,
      },
      {
        goaeNumber: '13',
        flagReason: 'Unbekannter Sonderfall, manuell prüfen.',
        chargedAmount: 8,
      },
    ];

    for (const f of flagged) {
      db.insert(invoicePositions)
        .values({
          invoiceId: inv.id,
          goaeNumber: f.goaeNumber,
          treatmentDate: '2026-05-01',
          multiplier: 1,
          baseAmount: f.chargedAmount,
          chargedAmount: f.chargedAmount,
          isValid: false,
          flagReason: f.flagReason,
        })
        .run();
    }

    // A valid position must not appear in the flags roll-up.
    db.insert(invoicePositions)
      .values({
        invoiceId: inv.id,
        goaeNumber: '99',
        treatmentDate: '2026-05-01',
        multiplier: 1,
        baseAmount: 10,
        chargedAmount: 10,
        isValid: true,
      })
      .run();

    // Multiplier distribution is computed independently of is_valid.
    db.insert(invoicePositions)
      .values([
        {
          invoiceId: inv.id,
          goaeNumber: '20',
          treatmentDate: '2026-05-01',
          multiplier: 1,
          baseAmount: 10,
          chargedAmount: 10,
          goaeCategory: 'GOÄ',
        },
        {
          invoiceId: inv.id,
          goaeNumber: '21',
          treatmentDate: '2026-05-01',
          multiplier: 2.3,
          baseAmount: 10,
          chargedAmount: 23,
          goaeCategory: 'GOÄ',
        },
        {
          invoiceId: inv.id,
          goaeNumber: '22',
          treatmentDate: '2026-05-01',
          multiplier: 1.5,
          baseAmount: 10,
          chargedAmount: 15,
          goaeCategory: 'GOZ',
        },
        {
          // No goae_category — must be excluded from the distribution.
          invoiceId: inv.id,
          goaeNumber: '23',
          treatmentDate: '2026-05-01',
          multiplier: 5,
          baseAmount: 10,
          chargedAmount: 50,
        },
      ])
      .run();

    const res = await app.request('/api/stats/validations');
    expect(res.status).toBe(200);
    const body = await res.json();

    const byCategory = Object.fromEntries(
      (body.flags as { category: string }[]).map((f) => [f.category, f]),
    );
    expect(byCategory.steigerungsfaktor).toEqual({
      category: 'steigerungsfaktor',
      count: 2,
      charged_amount: 160,
    });
    expect(byCategory.ausschluss).toEqual({ category: 'ausschluss', count: 1, charged_amount: 50 });
    expect(byCategory.erfordert).toEqual({ category: 'erfordert', count: 1, charged_amount: 20 });
    expect(byCategory.bestandteil).toEqual({
      category: 'bestandteil',
      count: 1,
      charged_amount: 10,
    });
    expect(byCategory.hoechstwert).toEqual({
      category: 'hoechstwert',
      count: 1,
      charged_amount: 150,
    });
    expect(byCategory.frequenz).toEqual({ category: 'frequenz', count: 1, charged_amount: 40 });
    expect(byCategory.dauer).toEqual({ category: 'dauer', count: 1, charged_amount: 30 });
    expect(byCategory.alter).toEqual({ category: 'alter', count: 1, charged_amount: 25 });
    expect(byCategory.unbekannte_ziffer).toEqual({
      category: 'unbekannte_ziffer',
      count: 2,
      charged_amount: 20,
    });
    expect(byCategory.sonstiges).toEqual({ category: 'sonstiges', count: 1, charged_amount: 8 });

    const byGoaeCategory = Object.fromEntries(
      (body.multiplier_distribution as { goae_category: string }[]).map((m) => [
        m.goae_category,
        m,
      ]),
    );
    expect(byGoaeCategory['GOÄ']).toEqual({
      goae_category: 'GOÄ',
      count: 2,
      avg_multiplier: 1.65,
      min_multiplier: 1,
      max_multiplier: 2.3,
    });
    expect(byGoaeCategory['GOZ']).toEqual({
      goae_category: 'GOZ',
      count: 1,
      avg_multiplier: 1.5,
      min_multiplier: 1.5,
      max_multiplier: 1.5,
    });
    expect(body.multiplier_distribution).toHaveLength(2);
  });
});

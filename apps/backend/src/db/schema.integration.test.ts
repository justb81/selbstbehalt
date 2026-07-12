// SPDX-License-Identifier: Apache-2.0
//
// Integration test for the database layer: applies the checked-in migrations to
// a fresh in-memory database, then exercises the full entity chain (insert +
// read-back), JSON columns, defaults, and foreign-key cascade behaviour.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { GoaeCategory } from '@selbstbehalt/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from './client.js';
import { runMigrations } from './migrate.js';
import { seed } from './seed.js';
import {
  brePeriods,
  contracts,
  insuredPersons,
  invoiceCurrentStatus,
  invoicePositions,
  invoiceStatusEvents,
  invoices,
  persons,
  submissions,
} from './schema.js';

let handle: DbHandle;

beforeEach(() => {
  handle = createDb(':memory:');
  runMigrations(handle);
});

afterEach(() => {
  handle.sqlite.close();
});

describe('migrations', () => {
  it('create all eight tables', () => {
    const rows = handle.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = rows.map((r) => r.name);
    for (const table of [
      'persons',
      'contracts',
      'insured_persons',
      'invoices',
      'invoice_positions',
      'invoice_status_events',
      'submissions',
      'bre_periods',
    ]) {
      expect(names).toContain(table);
    }
  });
});

describe('entity chain', () => {
  it('persists Person → Vertrag → versicherte Person → Rechnung → Position and reads it back', () => {
    const { db } = handle;

    const person = db.insert(persons).values({ name: 'Max Mustermann' }).returning().get();
    expect(person.id).toMatch(/[0-9a-f-]{36}/);
    expect(person.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const contract = db
      .insert(contracts)
      .values({
        policyholderId: person.id,
        insurerName: 'Allianz',
        type: 'vollversicherung',
        startDate: '2024-01-01',
      })
      .returning()
      .get();

    const insured = db
      .insert(insuredPersons)
      .values({
        contractId: contract.id,
        personId: person.id,
        kvnr: 'A123456789',
        monthlyPremium: 400,
      })
      .returning()
      .get();
    // DEFAULT 0 applied by the DB.
    expect(insured.selfRetention).toBe(0);

    const invoice = db
      .insert(invoices)
      .values({
        insuredPersonId: insured.id,
        invoiceDate: '2026-06-01',
        providerName: 'Dr. Schmidt',
        totalAmount: 120.5,
      })
      .returning()
      .get();
    // DEFAULT from §3.2.
    expect(invoice.selfPaidAmount).toBe(0);
    // Lifecycle state is derived (no status column); the view falls back to the
    // ground state of every track when the invoice has no events yet.
    const current = db
      .select()
      .from(invoiceCurrentStatus)
      .where(eq(invoiceCurrentStatus.invoiceId, invoice.id))
      .get();
    expect(current).toMatchObject({
      review: 'neu',
      payment: 'offen',
      submission: 'nicht_eingereicht',
      paidOn: null,
    });

    const position = db
      .insert(invoicePositions)
      .values({
        invoiceId: invoice.id,
        goaeNumber: '0340',
        treatmentDate: '2026-06-01',
        multiplier: 2.3,
        baseAmount: 20.11,
        chargedAmount: 46.25,
        isValid: true,
      })
      .returning()
      .get();
    // BOOLEAN round-trips as a real boolean (integer mode).
    expect(position.isValid).toBe(true);

    const readBack = db.select().from(invoicePositions).all();
    expect(readBack).toHaveLength(1);
    expect(readBack[0]?.goaeNumber).toBe('0340');
  });

  it('stores and round-trips JSON columns (bre_structure, included_benefits)', () => {
    const { db } = handle;
    const person = db.insert(persons).values({ name: 'JSON Tester' }).returning().get();
    const contract = db
      .insert(contracts)
      .values({
        policyholderId: person.id,
        insurerName: 'DKV',
        type: 'zusatztarif',
        startDate: '2025-01-01',
      })
      .returning()
      .get();
    const insured = db
      .insert(insuredPersons)
      .values({
        contractId: contract.id,
        personId: person.id,
        monthlyPremium: 80,
        breStructure: {
          type: 'staffel',
          levels: [{ claim_free_years: 1, bre_years: 1, pct_of_premium: 100 }],
          current_streak_start: '2025-01-01',
        },
        includedBenefits: {
          benefits: [
            { category: 'zahnbehandlung', tiers: [{ up_to: null, pct: 90 }] },
            { category: 'heilmittel', tiers: [{ up_to: null, pct: 100 }] },
          ],
        },
      })
      .returning()
      .get();

    expect(insured.breStructure?.levels[0]?.bre_years).toBe(1);
    expect(insured.includedBenefits?.benefits[0]?.category).toBe('zahnbehandlung');
    expect(insured.includedBenefits?.benefits[1]?.tiers?.[0]?.pct).toBe(100);
  });

  it('cascades deletes from contract down to insured persons, invoices and positions', () => {
    const { db } = handle;
    seed(handle);

    expect(db.select().from(invoices).all().length).toBeGreaterThan(0);
    expect(db.select().from(invoicePositions).all().length).toBeGreaterThan(0);

    db.delete(contracts).run();

    expect(db.select().from(insuredPersons).all()).toHaveLength(0);
    expect(db.select().from(invoices).all()).toHaveLength(0);
    expect(db.select().from(invoicePositions).all()).toHaveLength(0);
    expect(db.select().from(invoiceStatusEvents).all()).toHaveLength(0);
    expect(db.select().from(submissions).all()).toHaveLength(0);
    expect(db.select().from(brePeriods).all()).toHaveLength(0);
  });

  it('rejects insuring the same person twice on one contract (unique index enforced)', () => {
    const { db } = handle;
    const person = db.insert(persons).values({ name: 'Doppelt Versichert' }).returning().get();
    const contract = db
      .insert(contracts)
      .values({
        policyholderId: person.id,
        insurerName: 'DKV',
        type: 'vollversicherung',
        startDate: '2024-01-01',
      })
      .returning()
      .get();
    const insure = () =>
      db
        .insert(insuredPersons)
        .values({ contractId: contract.id, personId: person.id, monthlyPremium: 400 })
        .run();
    insure();
    expect(insure).toThrow();
  });

  it('rejects an invoice referencing a non-existent insured person (FK enforced)', () => {
    const { db } = handle;
    expect(() =>
      db
        .insert(invoices)
        .values({
          insuredPersonId: 'missing-insured-id',
          invoiceDate: '2026-01-01',
          providerName: 'X',
          totalAmount: 10,
        })
        .run(),
    ).toThrow();
  });
});

describe('seed', () => {
  it('is idempotent — re-running replaces rather than duplicates', () => {
    const { db } = handle;
    seed(handle);
    seed(handle);
    expect(db.select().from(persons).all()).toHaveLength(2);
    expect(db.select().from(invoicePositions).all()).toHaveLength(5);
  });
});

describe('migration 0005 — non-fee-schedule base_amount backfill', () => {
  // Exercise the checked-in migration SQL directly against a legacy-shaped row. The
  // full chain already ran in beforeEach, so we re-apply the statement to a freshly
  // inserted row: that also proves it is idempotent.
  const backfillSql = readFileSync(
    fileURLToPath(new URL('./migrations/0005_position_basis_backfill.sql', import.meta.url)),
    'utf8',
  );

  /** Insert an invoice + one position with raw column values, bypassing the write-side schema. */
  function insertPosition(cols: {
    goaeCategory: GoaeCategory | null;
    quantity: number;
    baseAmount: number;
    chargedAmount: number;
  }): string {
    const { db } = handle;
    const person = db.insert(persons).values({ name: 'Legacy' }).returning().get();
    const contract = db
      .insert(contracts)
      .values({
        policyholderId: person.id,
        insurerName: 'X',
        type: 'vollversicherung',
        startDate: '2024-01-01',
      })
      .returning()
      .get();
    const insured = db
      .insert(insuredPersons)
      .values({ contractId: contract.id, personId: person.id, monthlyPremium: 100 })
      .returning()
      .get();
    const invoice = db
      .insert(invoices)
      .values({
        insuredPersonId: insured.id,
        invoiceDate: '2025-01-15',
        providerName: 'Y',
        totalAmount: cols.chargedAmount,
      })
      .returning()
      .get();
    return db
      .insert(invoicePositions)
      .values({
        invoiceId: invoice.id,
        goaeNumber: '',
        goaeCategory: cols.goaeCategory,
        quantity: cols.quantity,
        treatmentDate: '2025-01-15',
        multiplier: 1,
        baseAmount: cols.baseAmount,
        chargedAmount: cols.chargedAmount,
      })
      .returning()
      .get().id;
  }

  const readBase = (id: string) =>
    handle.db.select().from(invoicePositions).where(eq(invoicePositions.id, id)).get()?.baseAmount;

  it('reconstructs base_amount = charged_amount for a legacy Auslagenersatz row (quantity 1)', () => {
    const id = insertPosition({
      goaeCategory: 'Auslagenersatz',
      quantity: 1,
      baseAmount: 0,
      chargedAmount: 5,
    });
    handle.sqlite.exec(backfillSql);
    expect(readBase(id)).toBe(5);
  });

  it('divides by quantity for a multi-unit Arznei-/Hilfsmittel row', () => {
    const id = insertPosition({
      goaeCategory: 'Arznei-/Hilfsmittel',
      quantity: 4,
      baseAmount: 0,
      chargedAmount: 50,
    });
    handle.sqlite.exec(backfillSql);
    expect(readBase(id)).toBe(12.5);
  });

  it('converges (does not drift) for a non-evenly-divisible amount — the accepted residual', () => {
    // quantity 3 / charged 10.00 has no exact 2-decimal per-unit Basis: base = 3.33 and
    // 3 × 3.33 = 9.99 ≠ 10.00, so the row stays a (read-tolerated) invariant violator.
    // The backfill must rewrite it to the same 3.33 on every run rather than drift.
    const id = insertPosition({
      goaeCategory: 'Auslagenersatz',
      quantity: 3,
      baseAmount: 0,
      chargedAmount: 10,
    });
    handle.sqlite.exec(backfillSql);
    expect(readBase(id)).toBe(3.33);
    handle.sqlite.exec(backfillSql);
    expect(readBase(id)).toBe(3.33);
  });

  it('leaves GOÄ positions and already-consistent rows untouched, and is idempotent', () => {
    const goae = insertPosition({
      goaeCategory: 'GOÄ',
      quantity: 1,
      baseAmount: 20.11,
      chargedAmount: 46.25,
    });
    const consistent = insertPosition({
      goaeCategory: 'Auslagenersatz',
      quantity: 2,
      baseAmount: 3,
      chargedAmount: 6,
    });
    handle.sqlite.exec(backfillSql);
    handle.sqlite.exec(backfillSql);
    expect(readBase(goae)).toBe(20.11);
    expect(readBase(consistent)).toBe(3);
  });
});

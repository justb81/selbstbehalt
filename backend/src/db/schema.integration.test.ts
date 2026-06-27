// SPDX-License-Identifier: Apache-2.0
//
// Integration test for the database layer: applies the checked-in migrations to
// a fresh in-memory database, then exercises the full entity chain (insert +
// read-back), JSON columns, defaults, and foreign-key cascade behaviour.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from './client.js';
import { runMigrations } from './migrate.js';
import { seed } from './seed.js';
import {
  brePeriods,
  contracts,
  invoicePositions,
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
  it('create all six tables', () => {
    const rows = handle.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = rows.map((r) => r.name);
    for (const table of [
      'persons',
      'contracts',
      'invoices',
      'invoice_positions',
      'submissions',
      'bre_periods',
    ]) {
      expect(names).toContain(table);
    }
  });
});

describe('entity chain', () => {
  it('persists Person → Vertrag → Rechnung → Position and reads it back', () => {
    const { db } = handle;

    const person = db.insert(persons).values({ name: 'Max Mustermann' }).returning().get();
    expect(person.id).toMatch(/[0-9a-f-]{36}/);
    expect(person.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const contract = db
      .insert(contracts)
      .values({
        personId: person.id,
        insurerName: 'Allianz',
        type: 'vollversicherung',
        startDate: '2024-01-01',
        monthlyPremium: 400,
      })
      .returning()
      .get();
    // DEFAULT 0 applied by the DB.
    expect(contract.selfRetention).toBe(0);

    const invoice = db
      .insert(invoices)
      .values({
        contractId: contract.id,
        invoiceDate: '2026-06-01',
        providerName: 'Dr. Schmidt',
        totalAmount: 120.5,
      })
      .returning()
      .get();
    // DEFAULTs from §3.2.
    expect(invoice.status).toBe('neu');
    expect(invoice.selfPaidAmount).toBe(0);

    const position = db
      .insert(invoicePositions)
      .values({
        invoiceId: invoice.id,
        goaeNumber: '0340',
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
        personId: person.id,
        insurerName: 'DKV',
        type: 'zusatztarif',
        startDate: '2025-01-01',
        monthlyPremium: 80,
        breStructure: {
          type: 'staffel',
          levels: [{ leistungsfrei_months: 12, bre_months: 1, pct_of_premium: 100 }],
          current_streak_start: '2025-01-01',
        },
        includedBenefits: ['Zahn 90%', 'Heilpraktiker'],
      })
      .returning()
      .get();

    expect(contract.breStructure?.levels[0]?.bre_months).toBe(1);
    expect(contract.includedBenefits).toEqual(['Zahn 90%', 'Heilpraktiker']);
  });

  it('cascades deletes from contract down to invoices and positions', () => {
    const { db } = handle;
    seed(handle);

    expect(db.select().from(invoices).all().length).toBeGreaterThan(0);
    expect(db.select().from(invoicePositions).all().length).toBeGreaterThan(0);

    db.delete(contracts).run();

    expect(db.select().from(invoices).all()).toHaveLength(0);
    expect(db.select().from(invoicePositions).all()).toHaveLength(0);
    expect(db.select().from(submissions).all()).toHaveLength(0);
    expect(db.select().from(brePeriods).all()).toHaveLength(0);
  });

  it('rejects an invoice referencing a non-existent contract (FK enforced)', () => {
    const { db } = handle;
    expect(() =>
      db
        .insert(invoices)
        .values({
          contractId: 'missing-contract-id',
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
    expect(db.select().from(persons).all()).toHaveLength(1);
    expect(db.select().from(invoicePositions).all()).toHaveLength(2);
  });
});

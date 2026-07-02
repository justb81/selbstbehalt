// SPDX-License-Identifier: Apache-2.0
//
// Development seed data. Wipes the tables and inserts representative invoice
// chains (Person → Vertrag → versicherte Person → Rechnung → Positionen →
// Statusereignisse → Einreichung → BRE-Periode) so the API has something to
// serve locally. Run via `pnpm --filter backend db:seed`.
//
// Invoice 1 (geprüft): one compliant + one flagged GOÄ position, not yet submitted.
// Invoice 2 (erstattet): GOZ positions from two Leistungsjahre (2024 + 2025) — the
// canonical multi-year scenario from Issue #139 §2.3. Fully reimbursed.
//
// NEVER run this against a production database — it deletes existing rows.

import { fileURLToPath } from 'node:url';

import { loadConfig } from '../config.js';
import { createDb, type DbHandle } from './client.js';
import { runMigrations } from './migrate.js';
import {
  brePeriods,
  contracts,
  insuredPersons,
  invoicePositions,
  invoiceStatusEvents,
  invoices,
  persons,
  submissions,
} from './schema.js';

/** Insert the example dataset into an already-migrated database. */
export function seed(handle: DbHandle): void {
  const { db } = handle;

  // Clear in FK-safe order (children first). Status events cascade from invoices
  // but deleting them explicitly keeps the intention readable.
  db.delete(submissions).run();
  db.delete(invoiceStatusEvents).run();
  db.delete(invoicePositions).run();
  db.delete(invoices).run();
  db.delete(brePeriods).run();
  db.delete(insuredPersons).run();
  db.delete(contracts).run();
  db.delete(persons).run();

  // Versicherungsnehmer (policyholder) plus a covered family member.
  const person = db
    .insert(persons)
    .values({ name: 'Erika Mustermann', birthDate: '1985-03-12' })
    .returning()
    .get();
  const child = db
    .insert(persons)
    .values({ name: 'Lena Mustermann', birthDate: '2015-09-04' })
    .returning()
    .get();

  const contract = db
    .insert(contracts)
    .values({
      policyholderId: person.id,
      insurerName: 'DKV',
      contractNumber: 'KV-12345678',
      type: 'vollversicherung',
      startDate: '2024-01-01',
    })
    .returning()
    .get();

  // The policyholder's own cover on the contract (own KVNR, tariff, SB, BRE).
  const insured = db
    .insert(insuredPersons)
    .values({
      contractId: contract.id,
      personId: person.id,
      kvnr: 'A123456780',
      tariffName: 'KomfortSelect',
      monthlyPremium: 452.3,
      selfRetention: 600,
      startDate: '2024-01-01',
      breStructure: {
        type: 'staffel',
        levels: [
          { claim_free_years: 1, bre_years: 1, pct_of_premium: 100 },
          { claim_free_years: 2, bre_years: 2, pct_of_premium: 100 },
          { claim_free_years: 3, bre_years: 3, pct_of_premium: 100 },
        ],
        current_streak_start: '2025-07-01',
      },
      includedBenefits: {
        benefits: [
          { category: 'ambulant', tiers: [{ up_to: null, pct: 100 }] },
          { category: 'stationaer', tiers: [{ up_to: null, pct: 100 }] },
          { category: 'zahnbehandlung', tiers: [{ up_to: null, pct: 100 }] },
          { category: 'zahnersatz', waiting_period_months: 8, tiers: [{ up_to: null, pct: 80 }] },
        ],
      },
    })
    .returning()
    .get();

  // A second insured person (child) on the same contract, own KVNR and tariff.
  db.insert(insuredPersons)
    .values({
      contractId: contract.id,
      personId: child.id,
      kvnr: 'A123456781',
      tariffName: 'KinderSelect',
      monthlyPremium: 168.5,
      selfRetention: 0,
      startDate: '2024-01-01',
      includedBenefits: {
        benefits: [
          { category: 'ambulant', tiers: [{ up_to: null, pct: 100 }] },
          { category: 'stationaer', tiers: [{ up_to: null, pct: 100 }] },
          { category: 'zahnbehandlung', tiers: [{ up_to: null, pct: 100 }] },
        ],
      },
    })
    .run();

  // ── Invoice 1: geprüft, nicht eingereicht ──────────────────────────────────
  // GOÄ-Rechnung mit einer regelkonformen und einer überschreitenden Position.
  // eligible_amount = 10.72 (nur Position 1), self_paid_amount = 81.11 (Σ charged)
  const invoice1 = db
    .insert(invoices)
    .values({
      insuredPersonId: insured.id,
      invoiceDate: '2026-06-01',
      invoiceNumber: 'R-2026-0042',
      providerName: 'Dr. med. Müller',
      providerType: 'arzt',
      totalAmount: 81.11,
      eligibleAmount: 10.72,
      selfPaidAmount: 81.11,
      status: 'geprüft',
    })
    .returning()
    .get();

  db.insert(invoicePositions)
    .values([
      {
        invoiceId: invoice1.id,
        goaeNumber: '0001',
        goaeCategory: 'GOÄ',
        description: 'Beratung, auch mittels Fernsprecher',
        multiplier: 2.3,
        baseAmount: 4.66,
        chargedAmount: 10.72,
        treatmentDate: '2026-06-01',
        eligibleAmount: 10.72,
        isValid: true,
      },
      {
        invoiceId: invoice1.id,
        goaeNumber: '0340',
        goaeCategory: 'GOÄ',
        description: 'Erörterung (mind. 20 Min.)',
        multiplier: 3.5,
        baseAmount: 20.11,
        chargedAmount: 70.39,
        treatmentDate: '2026-06-01',
        eligibleAmount: null, // nicht erstattungsfähig (Steigerungsfaktor überschritten)
        isValid: false,
        flagReason: 'Steigerungsfaktor 3.5 überschreitet Regelgrenze 2.3 (§5 GOÄ)',
      },
    ])
    .run();

  db.insert(invoiceStatusEvents)
    .values([
      { invoiceId: invoice1.id, status: 'neu' },
      { invoiceId: invoice1.id, status: 'geprüft', note: 'GOÄ-Prüfung abgeschlossen' },
    ])
    .run();

  // ── Invoice 2: erstattet — Positionen aus zwei Leistungsjahren (§2.3) ──────
  // GOZ-Rechnung mit Leistungen aus 2024 und 2025. Zeigt, dass das Leistungsdatum
  // je Position die BRE-Jahreszuordnung bestimmt (Issue #139).
  // eligible_amount = 40.92 + 496.0 = 536.92
  // self_paid_amount = (40.92−40.92) + (579.08−396.8) = 182.28
  const invoice2 = db
    .insert(invoices)
    .values({
      insuredPersonId: insured.id,
      invoiceDate: '2025-11-15',
      invoiceNumber: 'R-2025-0089',
      providerName: 'Zahnarztpraxis Dr. Weber',
      providerType: 'zahnarzt',
      totalAmount: 620.0,
      eligibleAmount: 536.92,
      selfPaidAmount: 182.28,
      status: 'erstattet',
    })
    .returning()
    .get();

  db.insert(invoicePositions)
    .values([
      {
        invoiceId: invoice2.id,
        goaeNumber: '0040',
        goaeCategory: 'GOZ',
        description: 'Befundaufnahme und Beratung',
        multiplier: 2.3,
        baseAmount: 17.79,
        chargedAmount: 40.92,
        treatmentDate: '2024-12-10', // ← Leistungsjahr 2024
        eligibleAmount: 40.92,
        refundAmount: 40.92,
        isValid: true,
      },
      {
        invoiceId: invoice2.id,
        goaeNumber: '2060',
        goaeCategory: 'GOZ',
        description: 'Versorgung eines Zahnes mit einer Vollkrone',
        multiplier: 3.5,
        baseAmount: 159.67,
        chargedAmount: 579.08,
        treatmentDate: '2025-10-22', // ← Leistungsjahr 2025
        eligibleAmount: 496.0,
        refundAmount: 396.8, // 80 % der erstattungsfähigen Menge (Zahnersatz-Tarif)
        isValid: true,
      },
    ])
    .run();

  db.insert(submissions)
    .values({
      invoiceId: invoice2.id,
      submittedVia: 'app',
      expectedRefund: 536.92,
      submittedAt: '2025-11-20T10:00:00.000Z',
      refundDate: '2025-12-05',
    })
    .run();

  db.insert(invoiceStatusEvents)
    .values([
      { invoiceId: invoice2.id, status: 'neu' },
      { invoiceId: invoice2.id, status: 'geprüft' },
      { invoiceId: invoice2.id, status: 'bezahlt', note: 'Eigenanteil überwiesen' },
      { invoiceId: invoice2.id, status: 'eingereicht', note: 'Per App eingereicht' },
      { invoiceId: invoice2.id, status: 'erstattet', note: 'Erstattung eingegangen am 05.12.2025' },
    ])
    .run();

  db.insert(brePeriods)
    .values({
      insuredPersonId: insured.id,
      year: 2026,
      streakYears: 0,
      breAmount: 0,
      projectedBre: 452.3,
    })
    .run();
}

function seedCli(): void {
  const { databasePath } = loadConfig();
  const handle = createDb(databasePath);
  try {
    runMigrations(handle);
    seed(handle);
    console.log(`Seeded example data into ${databasePath}`);
  } finally {
    handle.sqlite.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seedCli();
}

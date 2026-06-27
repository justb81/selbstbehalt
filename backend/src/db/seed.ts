// SPDX-License-Identifier: Apache-2.0
//
// Development seed data. Wipes the tables and inserts one representative chain
// (Person → Vertrag → versicherte Person → Rechnung → Positionen → Einreichung →
// BRE-Periode) so the API has something to serve locally. Run via
// `pnpm --filter backend db:seed`.
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
  invoices,
  persons,
  submissions,
} from './schema.js';

/** Insert the example dataset into an already-migrated database. */
export function seed(handle: DbHandle): void {
  const { db } = handle;

  // Clear in FK-safe order (children first).
  db.delete(submissions).run();
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
          { leistungsfrei_months: 12, bre_months: 1, pct_of_premium: 100 },
          { leistungsfrei_months: 24, bre_months: 2, pct_of_premium: 100 },
          { leistungsfrei_months: 36, bre_months: 3, pct_of_premium: 100 },
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

  const invoice = db
    .insert(invoices)
    .values({
      insuredPersonId: insured.id,
      invoiceDate: '2026-06-01',
      invoiceNumber: 'R-2026-0042',
      providerName: 'Dr. med. Müller',
      providerType: 'arzt',
      totalAmount: 85.0,
      eligibleAmount: 62.5,
      status: 'geprüft',
      decision: 'selbst_zahlen',
    })
    .returning()
    .get();

  db.insert(invoicePositions)
    .values([
      {
        invoiceId: invoice.id,
        goaeNumber: '0001',
        goaeCategory: 'GOÄ',
        description: 'Beratung, auch mittels Fernsprecher',
        multiplier: 2.3,
        baseAmount: 4.66,
        chargedAmount: 10.72,
        isValid: true,
      },
      {
        invoiceId: invoice.id,
        goaeNumber: '0340',
        goaeCategory: 'GOÄ',
        description: 'Erörterung (mind. 20 Min.)',
        multiplier: 3.5,
        baseAmount: 20.11,
        chargedAmount: 70.39,
        isValid: false,
        flagReason: 'Steigerungsfaktor 3.5 überschreitet Regelgrenze 2.3 (§5 GOÄ)',
      },
    ])
    .run();

  db.insert(submissions)
    .values({
      invoiceId: invoice.id,
      submittedVia: 'email',
      expectedRefund: 62.5,
    })
    .run();

  db.insert(brePeriods)
    .values({
      insuredPersonId: insured.id,
      year: 2026,
      streakMonths: 11,
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

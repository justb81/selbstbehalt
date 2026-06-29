// SPDX-License-Identifier: Apache-2.0
//
// Drizzle ORM schema — the persistent data model from docs/design.md §3.2.
//
// Conventions (per §3.2 and CLAUDE.md):
//   - UUID TEXT primary keys, generated app-side via `crypto.randomUUID()`.
//   - Money is REAL (EUR).
//   - `bre_structure` / `included_benefits` are JSON stored as TEXT.
//   - Timestamps are ISO-8601 strings (TEXT) so they round-trip 1:1 with the
//     `@selbstbehalt/shared` Zod schemas (which expect ISO-8601 with offset).
//   - String enum columns are typed against the shared enum unions.

import { randomUUID } from 'node:crypto';

import type {
  BREStructure,
  ContractType,
  GoaeCategory,
  IncludedBenefits,
  InvoiceDecision,
  InvoiceStatus,
  ProviderType,
  SubmissionChannel,
} from '@selbstbehalt/shared';
import { integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/** A UUID TEXT primary key with an app-side default. */
const uuidPk = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => randomUUID());

/** An ISO-8601 creation timestamp defaulted at insert time. */
const createdAt = () =>
  text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString());

export const persons = sqliteTable('persons', {
  id: uuidPk(),
  name: text('name').notNull(),
  birthDate: text('birth_date'),
  createdAt: createdAt(),
});

// The Hauptvertrag: insurer, contract number and the Versicherungsnehmer
// (policyholder). Tariff-specific cover lives per insured person below.
export const contracts = sqliteTable('contracts', {
  id: uuidPk(),
  policyholderId: text('policyholder_id')
    .notNull()
    .references(() => persons.id, { onDelete: 'cascade' }),
  insurerName: text('insurer_name').notNull(),
  contractNumber: text('contract_number'),
  type: text('type').$type<ContractType>().notNull(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date'),
  notes: text('notes'),
  createdAt: createdAt(),
});

// A versicherte Person on a contract — the join of persons × contracts that
// carries the individual cover (own KVNR, tariff, premium, Selbstbehalt, BRE).
// A given person may appear only once per contract: the (contract, person) pair
// is unique, so invoices and BRE periods always reference an unambiguous row.
export const insuredPersons = sqliteTable(
  'insured_persons',
  {
    id: uuidPk(),
    contractId: text('contract_id')
      .notNull()
      .references(() => contracts.id, { onDelete: 'cascade' }),
    personId: text('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    kvnr: text('kvnr'),
    tariffName: text('tariff_name'),
    monthlyPremium: real('monthly_premium').notNull(),
    selfRetention: real('self_retention').notNull().default(0),
    breStructure: text('bre_structure', { mode: 'json' }).$type<BREStructure>(),
    includedBenefits: text('included_benefits', { mode: 'json' }).$type<IncludedBenefits>(),
    startDate: text('start_date'),
    endDate: text('end_date'),
    notes: text('notes'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('insured_persons_contract_person_unique').on(table.contractId, table.personId),
  ],
);

export const invoices = sqliteTable('invoices', {
  id: uuidPk(),
  insuredPersonId: text('insured_person_id')
    .notNull()
    .references(() => insuredPersons.id, { onDelete: 'cascade' }),
  invoiceDate: text('invoice_date').notNull(),
  invoiceNumber: text('invoice_number'),
  providerName: text('provider_name').notNull(),
  providerType: text('provider_type').$type<ProviderType>(),
  totalAmount: real('total_amount').notNull(),
  eligibleAmount: real('eligible_amount'),
  selfPaidAmount: real('self_paid_amount').notNull().default(0),
  status: text('status').$type<InvoiceStatus>().notNull().default('neu'),
  decision: text('decision').$type<InvoiceDecision>(),
  filePath: text('file_path'),
  ocrRaw: text('ocr_raw'),
  notes: text('notes'),
  createdAt: createdAt(),
});

export const invoicePositions = sqliteTable('invoice_positions', {
  id: uuidPk(),
  invoiceId: text('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  goaeNumber: text('goae_number').notNull(),
  goaeCategory: text('goae_category').$type<GoaeCategory>(),
  /** Anzahl (quantity); defaults to 1. */
  quantity: integer('quantity').notNull().default(1),
  /** Leistungsdatum (ISO YYYY-MM-DD); null when not stated per-line. */
  treatmentDate: text('treatment_date'),
  description: text('description'),
  multiplier: real('multiplier').notNull(),
  baseAmount: real('base_amount').notNull(),
  chargedAmount: real('charged_amount').notNull(),
  isValid: integer('is_valid', { mode: 'boolean' }),
  flagReason: text('flag_reason'),
});

export const submissions = sqliteTable('submissions', {
  id: uuidPk(),
  invoiceId: text('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  submittedAt: text('submitted_at'),
  submittedVia: text('submitted_via').$type<SubmissionChannel>(),
  expectedRefund: real('expected_refund'),
  actualRefund: real('actual_refund'),
  refundDate: text('refund_date'),
  rejectionReason: text('rejection_reason'),
});

export const brePeriods = sqliteTable('bre_periods', {
  id: uuidPk(),
  insuredPersonId: text('insured_person_id')
    .notNull()
    .references(() => insuredPersons.id, { onDelete: 'cascade' }),
  year: integer('year').notNull(),
  streakMonths: integer('streak_months').notNull().default(0),
  breAmount: real('bre_amount').notNull().default(0),
  projectedBre: real('projected_bre'),
});

/** Convenience grouping passed to `drizzle(client, { schema })`. */
export const schema = {
  persons,
  contracts,
  insuredPersons,
  invoices,
  invoicePositions,
  submissions,
  brePeriods,
};

export type Schema = typeof schema;

// SPDX-License-Identifier: Apache-2.0
//
// Translation layer between the Drizzle row shape (camelCase columns) and the
// snake_case wire shape defined by the shared Zod schemas (#10). Keeping every
// field map in one place means the two naming worlds only meet here, and the
// `@selbstbehalt/shared` types make the mappings compile-time exhaustive.

import type {
  Contract,
  ContractCreate,
  ContractUpdate,
  InsuredPerson,
  InsuredPersonCreate,
  InsuredPersonUpdate,
  Invoice,
  InvoiceCreate,
  InvoicePosition,
  InvoicePositionInput,
  InvoiceUpdate,
  Person,
  PersonCreate,
  PersonUpdate,
  Submission,
  SubmissionInput,
  SubmissionUpdate,
} from '@selbstbehalt/shared';

import type {
  contracts,
  insuredPersons,
  invoicePositions,
  invoices,
  persons,
  submissions,
} from '../db/schema.js';

type PersonRow = typeof persons.$inferSelect;
type PersonInsert = typeof persons.$inferInsert;
type ContractRow = typeof contracts.$inferSelect;
type ContractInsert = typeof contracts.$inferInsert;
type InsuredPersonRow = typeof insuredPersons.$inferSelect;
type InsuredPersonInsert = typeof insuredPersons.$inferInsert;
type InvoiceRow = typeof invoices.$inferSelect;
type InvoiceInsert = typeof invoices.$inferInsert;
type PositionRow = typeof invoicePositions.$inferSelect;
type PositionInsert = typeof invoicePositions.$inferInsert;
type SubmissionRow = typeof submissions.$inferSelect;
type SubmissionInsert = typeof submissions.$inferInsert;

// ── Persons ──────────────────────────────────────────────────────────────────

export function serializePerson(row: PersonRow): Person {
  return {
    id: row.id,
    created_at: row.createdAt,
    name: row.name,
    birth_date: row.birthDate,
  };
}

export function toPersonInsert(input: PersonCreate): PersonInsert {
  return {
    name: input.name,
    birthDate: input.birth_date,
  };
}

export function toPersonUpdate(input: PersonUpdate): Partial<PersonInsert> {
  const u: Partial<PersonInsert> = {};
  if (input.name !== undefined) u.name = input.name;
  if (input.birth_date !== undefined) u.birthDate = input.birth_date;
  return u;
}

// ── Contracts (Hauptvertrag) ─────────────────────────────────────────────────

export function serializeContract(row: ContractRow): Contract {
  return {
    id: row.id,
    created_at: row.createdAt,
    policyholder_id: row.policyholderId,
    insurer_name: row.insurerName,
    contract_number: row.contractNumber,
    type: row.type,
    start_date: row.startDate,
    end_date: row.endDate,
    notes: row.notes,
  };
}

export function toContractInsert(input: ContractCreate): ContractInsert {
  return {
    policyholderId: input.policyholder_id,
    insurerName: input.insurer_name,
    contractNumber: input.contract_number,
    type: input.type,
    startDate: input.start_date,
    endDate: input.end_date,
    notes: input.notes,
  };
}

export function toContractUpdate(input: ContractUpdate): Partial<ContractInsert> {
  const u: Partial<ContractInsert> = {};
  if (input.policyholder_id !== undefined) u.policyholderId = input.policyholder_id;
  if (input.insurer_name !== undefined) u.insurerName = input.insurer_name;
  if (input.contract_number !== undefined) u.contractNumber = input.contract_number;
  if (input.type !== undefined) u.type = input.type;
  if (input.start_date !== undefined) u.startDate = input.start_date;
  if (input.end_date !== undefined) u.endDate = input.end_date;
  if (input.notes !== undefined) u.notes = input.notes;
  return u;
}

// ── Insured persons (versicherte Personen) ───────────────────────────────────

export function serializeInsuredPerson(row: InsuredPersonRow): InsuredPerson {
  return {
    id: row.id,
    created_at: row.createdAt,
    contract_id: row.contractId,
    person_id: row.personId,
    kvnr: row.kvnr,
    tariff_name: row.tariffName,
    monthly_premium: row.monthlyPremium,
    self_retention: row.selfRetention,
    bre_structure: row.breStructure,
    included_benefits: row.includedBenefits,
    start_date: row.startDate,
    end_date: row.endDate,
    notes: row.notes,
  };
}

export function toInsuredPersonInsert(input: InsuredPersonCreate): InsuredPersonInsert {
  return {
    contractId: input.contract_id,
    personId: input.person_id,
    kvnr: input.kvnr,
    tariffName: input.tariff_name,
    monthlyPremium: input.monthly_premium,
    // Omitted (undefined) on create → DB DEFAULT 0 applies.
    selfRetention: input.self_retention,
    breStructure: input.bre_structure,
    includedBenefits: input.included_benefits,
    startDate: input.start_date,
    endDate: input.end_date,
    notes: input.notes,
  };
}

export function toInsuredPersonUpdate(input: InsuredPersonUpdate): Partial<InsuredPersonInsert> {
  const u: Partial<InsuredPersonInsert> = {};
  if (input.contract_id !== undefined) u.contractId = input.contract_id;
  if (input.person_id !== undefined) u.personId = input.person_id;
  if (input.kvnr !== undefined) u.kvnr = input.kvnr;
  if (input.tariff_name !== undefined) u.tariffName = input.tariff_name;
  if (input.monthly_premium !== undefined) u.monthlyPremium = input.monthly_premium;
  if (input.self_retention !== undefined) u.selfRetention = input.self_retention;
  if (input.bre_structure !== undefined) u.breStructure = input.bre_structure;
  if (input.included_benefits !== undefined) u.includedBenefits = input.included_benefits;
  if (input.start_date !== undefined) u.startDate = input.start_date;
  if (input.end_date !== undefined) u.endDate = input.end_date;
  if (input.notes !== undefined) u.notes = input.notes;
  return u;
}

// ── Invoices ───────────────────────────────────────────────────────────────

export function serializeInvoice(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    created_at: row.createdAt,
    insured_person_id: row.insuredPersonId,
    invoice_date: row.invoiceDate,
    invoice_number: row.invoiceNumber,
    provider_name: row.providerName,
    provider_type: row.providerType,
    total_amount: row.totalAmount,
    eligible_amount: row.eligibleAmount,
    self_paid_amount: row.selfPaidAmount,
    status: row.status,
    decision: row.decision,
    file_path: row.filePath,
    ocr_raw: row.ocrRaw,
    notes: row.notes,
  };
}

export function toInvoiceInsert(input: InvoiceCreate): InvoiceInsert {
  return {
    insuredPersonId: input.insured_person_id,
    invoiceDate: input.invoice_date,
    invoiceNumber: input.invoice_number,
    providerName: input.provider_name,
    providerType: input.provider_type,
    totalAmount: input.total_amount,
    eligibleAmount: input.eligible_amount,
    // Omitted (undefined) on create → DB DEFAULTs apply.
    selfPaidAmount: input.self_paid_amount,
    status: input.status,
    decision: input.decision,
    filePath: input.file_path,
    ocrRaw: input.ocr_raw,
    notes: input.notes,
  };
}

export function toInvoiceUpdate(input: InvoiceUpdate): Partial<InvoiceInsert> {
  const u: Partial<InvoiceInsert> = {};
  if (input.insured_person_id !== undefined) u.insuredPersonId = input.insured_person_id;
  if (input.invoice_date !== undefined) u.invoiceDate = input.invoice_date;
  if (input.invoice_number !== undefined) u.invoiceNumber = input.invoice_number;
  if (input.provider_name !== undefined) u.providerName = input.provider_name;
  if (input.provider_type !== undefined) u.providerType = input.provider_type;
  if (input.total_amount !== undefined) u.totalAmount = input.total_amount;
  if (input.eligible_amount !== undefined) u.eligibleAmount = input.eligible_amount;
  if (input.self_paid_amount !== undefined) u.selfPaidAmount = input.self_paid_amount;
  if (input.status !== undefined) u.status = input.status;
  if (input.decision !== undefined) u.decision = input.decision;
  if (input.file_path !== undefined) u.filePath = input.file_path;
  if (input.ocr_raw !== undefined) u.ocrRaw = input.ocr_raw;
  if (input.notes !== undefined) u.notes = input.notes;
  return u;
}

// ── Invoice positions ──────────────────────────────────────────────────────

export function serializePosition(row: PositionRow): InvoicePosition {
  return {
    id: row.id,
    invoice_id: row.invoiceId,
    goae_number: row.goaeNumber,
    goae_category: row.goaeCategory,
    description: row.description,
    multiplier: row.multiplier,
    base_amount: row.baseAmount,
    charged_amount: row.chargedAmount,
    is_valid: row.isValid,
    flag_reason: row.flagReason,
  };
}

export function toPositionInsert(invoiceId: string, input: InvoicePositionInput): PositionInsert {
  return {
    invoiceId,
    goaeNumber: input.goae_number,
    goaeCategory: input.goae_category,
    description: input.description,
    multiplier: input.multiplier,
    baseAmount: input.base_amount,
    chargedAmount: input.charged_amount,
    isValid: input.is_valid,
    flagReason: input.flag_reason,
  };
}

// ── Submissions ────────────────────────────────────────────────────────────

export function serializeSubmission(row: SubmissionRow): Submission {
  return {
    id: row.id,
    invoice_id: row.invoiceId,
    submitted_at: row.submittedAt,
    submitted_via: row.submittedVia,
    expected_refund: row.expectedRefund,
    actual_refund: row.actualRefund,
    refund_date: row.refundDate,
    rejection_reason: row.rejectionReason,
  };
}

export function toSubmissionInsert(invoiceId: string, input: SubmissionInput): SubmissionInsert {
  return {
    invoiceId,
    submittedAt: input.submitted_at,
    submittedVia: input.submitted_via,
    expectedRefund: input.expected_refund,
    actualRefund: input.actual_refund,
    refundDate: input.refund_date,
    rejectionReason: input.rejection_reason,
  };
}

export function toSubmissionUpdate(input: SubmissionUpdate): Partial<SubmissionInsert> {
  const u: Partial<SubmissionInsert> = {};
  if (input.submitted_at !== undefined) u.submittedAt = input.submitted_at;
  if (input.submitted_via !== undefined) u.submittedVia = input.submitted_via;
  if (input.expected_refund !== undefined) u.expectedRefund = input.expected_refund;
  if (input.actual_refund !== undefined) u.actualRefund = input.actual_refund;
  if (input.refund_date !== undefined) u.refundDate = input.refund_date;
  if (input.rejection_reason !== undefined) u.rejectionReason = input.rejection_reason;
  return u;
}

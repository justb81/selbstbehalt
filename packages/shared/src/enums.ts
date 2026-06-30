// SPDX-License-Identifier: Apache-2.0
//
// Central enumerations shared across the data model. Each `*Values` tuple is the
// single source of truth: the Zod schemas below derive their `z.enum(...)` from
// it, the Drizzle schema reuses the same tuples for its `text(...).$type<>()`
// columns, and the inferred TS unions flow out to backend and frontend alike.

import { z } from 'zod';

/** Kind of insurance contract (`contracts.type`). */
export const contractTypeValues = ['vollversicherung', 'zusatztarif', 'beihilfe'] as const;
export const contractTypeSchema = z.enum(contractTypeValues);
export type ContractType = z.infer<typeof contractTypeSchema>;

/** Kind of healthcare provider that issued an invoice (`invoices.provider_type`). */
export const providerTypeValues = ['arzt', 'zahnarzt', 'krankenhaus', 'sonstiges'] as const;
export const providerTypeSchema = z.enum(providerTypeValues);
export type ProviderType = z.infer<typeof providerTypeSchema>;

/**
 * Lifecycle status of an invoice (`invoices.status`).
 * Allowed transitions: neu↔geprüft → bezahlt → eingereicht → erstattet.
 * Rejection (Ablehnung) is modelled as erstattet with refund_amount = 0 per position.
 * Self-pay (Selbstzahlung) leaves the invoice in bezahlt without proceeding to eingereicht.
 */
export const invoiceStatusValues = [
  'neu',
  'geprüft',
  'bezahlt',
  'eingereicht',
  'erstattet',
] as const;
export const invoiceStatusSchema = z.enum(invoiceStatusValues);
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;

/**
 * Fee-schedule a position is billed under (`invoice_positions.goae_category`).
 * `Auslagenersatz` is not a real fee schedule but §10 GOÄ expense reimbursement
 * (typically Porto-/Versandkosten) — always reimbursed at 100 % of `charged_amount`,
 * with no Ziffer/Steigerungsfaktor validation against a fee table.
 */
export const goaeCategoryValues = ['GOÄ', 'GOZ', 'GOT', 'UV-GOÄ', 'Auslagenersatz'] as const;
export const goaeCategorySchema = z.enum(goaeCategoryValues);
export type GoaeCategory = z.infer<typeof goaeCategorySchema>;

/** Channel an invoice was submitted through (`submissions.submitted_via`). */
export const submissionChannelValues = ['app', 'post', 'email'] as const;
export const submissionChannelSchema = z.enum(submissionChannelValues);
export type SubmissionChannel = z.infer<typeof submissionChannelSchema>;

/**
 * Benefit area a tariff reimbursement rule applies to (a `category` entry in
 * `insured_persons.included_benefits`). See §3.2 `included_benefits`.
 */
export const benefitCategoryValues = [
  'ambulant',
  'stationaer',
  'zahnbehandlung',
  'zahnersatz',
  'kieferorthopaedie',
  'heilmittel',
  'hilfsmittel',
  'wahlleistung',
  'sonstiges',
] as const;
export const benefitCategorySchema = z.enum(benefitCategoryValues);
export type BenefitCategory = z.infer<typeof benefitCategorySchema>;

/**
 * Scope a benefit `limit` caps spending over (a `limits[].scope` entry in
 * `insured_persons.included_benefits`): per treatment case, per policy year, or
 * lifelong. See §3.2 `included_benefits`.
 */
export const benefitLimitScopeValues = ['behandlung', 'jahr', 'lebenslang'] as const;
export const benefitLimitScopeSchema = z.enum(benefitLimitScopeValues);
export type BenefitLimitScope = z.infer<typeof benefitLimitScopeSchema>;

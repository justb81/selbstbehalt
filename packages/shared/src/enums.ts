// SPDX-License-Identifier: Apache-2.0
//
// Central enumerations shared across the data model. Each `*Values` tuple is the
// single source of truth: the Zod schemas below derive their `z.enum(...)` from
// it, the Drizzle schema reuses the same tuples for its `text(...).$type<>()`
// columns, and the inferred TS unions flow out to backend and frontend alike.

import { z } from 'zod';

/** Role of a person within the household (`persons.role`). */
export const personRoleValues = ['primary', 'family_member'] as const;
export const personRoleSchema = z.enum(personRoleValues);
export type PersonRole = z.infer<typeof personRoleSchema>;

/** Kind of insurance contract (`contracts.type`). */
export const contractTypeValues = ['vollversicherung', 'zusatztarif', 'beihilfe'] as const;
export const contractTypeSchema = z.enum(contractTypeValues);
export type ContractType = z.infer<typeof contractTypeSchema>;

/** Kind of healthcare provider that issued an invoice (`invoices.provider_type`). */
export const providerTypeValues = ['arzt', 'zahnarzt', 'krankenhaus', 'sonstiges'] as const;
export const providerTypeSchema = z.enum(providerTypeValues);
export type ProviderType = z.infer<typeof providerTypeSchema>;

/** Lifecycle status of an invoice (`invoices.status`). */
export const invoiceStatusValues = [
  'neu',
  'geprüft',
  'eingereicht',
  'erstattet',
  'abgelehnt',
  'selbst_gezahlt',
] as const;
export const invoiceStatusSchema = z.enum(invoiceStatusValues);
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;

/** Result of the Günstigerprüfung (`invoices.decision`). */
export const invoiceDecisionValues = ['einreichen', 'selbst_zahlen'] as const;
export const invoiceDecisionSchema = z.enum(invoiceDecisionValues);
export type InvoiceDecision = z.infer<typeof invoiceDecisionSchema>;

/** Fee-schedule a position is billed under (`invoice_positions.goae_category`). */
export const goaeCategoryValues = ['GOÄ', 'GOZ', 'GOT', 'UV-GOÄ'] as const;
export const goaeCategorySchema = z.enum(goaeCategoryValues);
export type GoaeCategory = z.infer<typeof goaeCategorySchema>;

/** Channel an invoice was submitted through (`submissions.submitted_via`). */
export const submissionChannelValues = ['app', 'post', 'email'] as const;
export const submissionChannelSchema = z.enum(submissionChannelValues);
export type SubmissionChannel = z.infer<typeof submissionChannelSchema>;

// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

import { auditFields, isoDate, money, uuid } from '../common.js';
import { invoiceDecisionSchema, invoiceStatusSchema, providerTypeSchema } from '../enums.js';

export const invoiceCreateSchema = z.object({
  contract_id: uuid,
  invoice_date: isoDate,
  invoice_number: z.string().nullish(),
  provider_name: z.string().min(1, 'Leistungserbringer darf nicht leer sein'),
  provider_type: providerTypeSchema.nullish(),
  total_amount: money,
  eligible_amount: money.nullish(),
  // NOT NULL DEFAULT 0 — omittable on create.
  self_paid_amount: money.optional(),
  // NOT NULL DEFAULT 'neu' — omittable on create.
  status: invoiceStatusSchema.optional(),
  decision: invoiceDecisionSchema.nullish(),
  file_path: z.string().nullish(),
  ocr_raw: z.string().nullish(),
  notes: z.string().nullish(),
});

export const invoiceSchema = invoiceCreateSchema.extend({
  ...auditFields,
  // Always present when read back (DB defaults applied).
  self_paid_amount: money,
  status: invoiceStatusSchema,
});

export const invoiceUpdateSchema = invoiceCreateSchema.partial();

export type InvoiceCreate = z.infer<typeof invoiceCreateSchema>;
export type Invoice = z.infer<typeof invoiceSchema>;
export type InvoiceUpdate = z.infer<typeof invoiceUpdateSchema>;

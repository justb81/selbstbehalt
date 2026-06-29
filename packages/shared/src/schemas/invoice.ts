// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

import { auditFields, isoDate, money, uuid } from '../common.js';
import { invoiceDecisionSchema, invoiceStatusSchema, providerTypeSchema } from '../enums.js';
import { invoicePositionInputSchema, invoicePositionSchema } from './invoice-position.js';

export const invoiceCreateSchema = z
  .object({
    insured_person_id: uuid,
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
  })
  .strict();

/**
 * `POST /api/invoices` body: an invoice plus its line items, persisted together
 * in one transaction (§7.1). Positions omit `invoice_id` — it is assigned from
 * the invoice the same request creates.
 */
export const invoiceCreatePayloadSchema = invoiceCreateSchema.extend({
  positions: z.array(invoicePositionInputSchema).optional(),
});

export const invoiceSchema = invoiceCreateSchema.extend({
  ...auditFields,
  // Always present when read back (DB defaults applied).
  self_paid_amount: money,
  status: invoiceStatusSchema,
});

/** Detail shape returned by `GET /api/invoices/:id` — the invoice with its lines. */
export const invoiceWithPositionsSchema = invoiceSchema.extend({
  positions: z.array(invoicePositionSchema),
});

export const invoiceUpdateSchema = invoiceCreateSchema.partial();

/** `PUT /api/invoices/:id` body: partial invoice fields plus optional positions replacement. */
export const invoiceUpdatePayloadSchema = invoiceUpdateSchema.extend({
  positions: z.array(invoicePositionInputSchema).optional(),
});

export type InvoiceCreate = z.infer<typeof invoiceCreateSchema>;
export type InvoiceCreatePayload = z.infer<typeof invoiceCreatePayloadSchema>;
export type Invoice = z.infer<typeof invoiceSchema>;
export type InvoiceWithPositions = z.infer<typeof invoiceWithPositionsSchema>;
export type InvoiceUpdate = z.infer<typeof invoiceUpdateSchema>;
export type InvoiceUpdatePayload = z.infer<typeof invoiceUpdatePayloadSchema>;

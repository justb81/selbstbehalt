// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

import { auditFields, isoDate, money, uuid } from '../common.js';
import { invoiceStatusSchema, providerTypeSchema } from '../enums.js';
import { invoicePositionInputSchema, invoicePositionSchema } from './invoice-position.js';

/**
 * Client-settable fields on invoice create/update.
 * `eligible_amount` and `self_paid_amount` are derived server-side from positions
 * (Σ positions.eligible_amount and Σ charged_amount − Σ coalesce(refund_amount,0))
 * and must not be sent by the client.
 */
export const invoiceCreateSchema = z
  .object({
    insured_person_id: uuid,
    invoice_date: isoDate,
    invoice_number: z.string().nullish(),
    provider_name: z.string().min(1, 'Leistungserbringer darf nicht leer sein'),
    provider_type: providerTypeSchema.nullish(),
    total_amount: money,
    // NOT NULL DEFAULT 'neu' — omittable on create.
    status: invoiceStatusSchema.optional(),
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

/**
 * Read-back shape of a persisted invoice. `eligible_amount` and `self_paid_amount`
 * are server-computed aggregates from positions (read-only from the client's perspective).
 */
export const invoiceSchema = invoiceCreateSchema.extend({
  ...auditFields,
  // Server-computed: Σ positions.eligible_amount (nullable until the engine has run).
  eligible_amount: money.nullish(),
  // Server-computed: Σ charged_amount − Σ coalesce(refund_amount, 0).
  self_paid_amount: money,
  // Always present when read back (DB defaults applied).
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

/**
 * `POST /api/invoices/:id/status` body: explicit status transition with optional note.
 * Allowed transitions: neu↔geprüft, geprüft→bezahlt, bezahlt→eingereicht, eingereicht→erstattet.
 */
export const invoiceStatusChangeSchema = z
  .object({
    status: invoiceStatusSchema,
    note: z.string().nullish(),
  })
  .strict();

/**
 * `PUT /api/invoices/:id/refund` body: per-position refund amounts.
 * From status `eingereicht`, sets invoice status → erstattet and writes
 * refund_amount per position. From status `erstattet`, corrects the
 * already-recorded amounts in place without changing the status (issue #230
 * "Bearbeiten"). refund_amount = 0 represents a rejection (Ablehnung) for
 * that position.
 */
export const invoiceRefundPayloadSchema = z
  .object({
    positions: z.array(z.object({ id: uuid, refund_amount: money.nullable() }).strict()),
    note: z.string().nullish(),
    refund_date: isoDate.nullish(),
  })
  .strict();

/**
 * `POST /api/invoices/:id/revert` body (issue #230 "Löschen"): undoes the
 * invoice's last status transition, moving it back to the predecessor status
 * (bezahlt→geprüft, eingereicht→bezahlt, erstattet→eingereicht) and discarding
 * the data that step captured — the `submissions` row for eingereicht, or the
 * per-position `refund_amount`/`refund_date` for erstattet.
 */
export const invoiceRevertSchema = z
  .object({
    note: z.string().nullish(),
  })
  .strict();

export type InvoiceCreate = z.infer<typeof invoiceCreateSchema>;
export type InvoiceCreatePayload = z.infer<typeof invoiceCreatePayloadSchema>;
export type Invoice = z.infer<typeof invoiceSchema>;
export type InvoiceWithPositions = z.infer<typeof invoiceWithPositionsSchema>;
export type InvoiceUpdate = z.infer<typeof invoiceUpdateSchema>;
export type InvoiceUpdatePayload = z.infer<typeof invoiceUpdatePayloadSchema>;
export type InvoiceStatusChange = z.infer<typeof invoiceStatusChangeSchema>;
export type InvoiceRefundPayload = z.infer<typeof invoiceRefundPayloadSchema>;
export type InvoiceRevert = z.infer<typeof invoiceRevertSchema>;

// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

import { auditFields, isoDate, money, uuid } from '../common.js';
import { paymentStatusSchema, providerTypeSchema, reviewStatusSchema } from '../enums.js';
import { invoiceStatusSchema } from '../utils/derive-invoice-status.js';
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
    // Lifecycle state is derived from the status-event log, never set on create:
    // a new invoice always starts in every track's ground state.
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
  // Server-derived from the status-event log (latest event per track); read-only.
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
 * `POST /api/invoices/:id/review` body: toggles the review track (`neu ↔ geprüft`).
 * `geprüft → neu` is only allowed while both other tracks are still in their ground state.
 */
export const invoiceReviewChangeSchema = z
  .object({
    status: reviewStatusSchema,
    note: z.string().nullish(),
  })
  .strict();

/**
 * `POST /api/invoices/:id/payment` body: toggles the payment track (`offen ↔ bezahlt`),
 * independent of submission. `offen → bezahlt` requires `review = 'geprüft'`. `paid_on`
 * becomes the event's `changed_at` (Zahlungsdatum), defaulting to today when omitted.
 */
export const invoicePaymentChangeSchema = z
  .object({
    status: paymentStatusSchema,
    paid_on: isoDate.nullish(),
    note: z.string().nullish(),
  })
  .strict();

/**
 * `PUT /api/invoices/:id/refund` body: per-position refund amounts.
 * From `submission = 'eingereicht'`, advances the submission track → `erstattet` and
 * writes refund_amount per position. From `erstattet`, corrects the already-recorded
 * amounts in place without a track change (issue #230 "Bearbeiten"). refund_amount = 0
 * represents a rejection (Ablehnung) for that position.
 */
export const invoiceRefundPayloadSchema = z
  .object({
    positions: z.array(z.object({ id: uuid, refund_amount: money.nullable() }).strict()),
    note: z.string().nullish(),
    refund_date: isoDate.nullish(),
  })
  .strict();

/**
 * `POST /api/invoices/:id/submission/revert` body (issue #230 "Löschen"): steps the
 * submission track back one level (`erstattet → eingereicht`, `eingereicht →
 * nicht_eingereicht`) by appending a ground-state event, and discards the data that
 * step captured — the per-position `refund_amount`/`refund_date` for `erstattet`, or
 * the `submissions` row for `eingereicht`. (Reverting a payment is just
 * `POST /api/invoices/:id/payment {status:'offen'}`.)
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
export type InvoiceReviewChange = z.infer<typeof invoiceReviewChangeSchema>;
export type InvoicePaymentChange = z.infer<typeof invoicePaymentChangeSchema>;
export type InvoiceRefundPayload = z.infer<typeof invoiceRefundPayloadSchema>;
export type InvoiceRevert = z.infer<typeof invoiceRevertSchema>;

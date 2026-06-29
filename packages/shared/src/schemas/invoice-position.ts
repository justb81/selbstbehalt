// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

import { money, uuid } from '../common.js';
import { goaeCategorySchema } from '../enums.js';

/**
 * Client-supplied fields of an invoice line (§3.2 `invoice_positions`), with no
 * `invoice_id`. This is the shape used when positions are created nested inside
 * their parent invoice (`POST /api/invoices`): the FK comes from the freshly
 * inserted invoice, so a body-level `invoice_id` would be redundant — mirrors
 * the submission input/create split.
 */
export const invoicePositionInputSchema = z
  .object({
    goae_number: z.string().min(1, 'GOÄ-Ziffer darf nicht leer sein'),
    goae_category: goaeCategorySchema.nullish(),
    /** Anzahl (quantity); defaults to 1 when not stated on the invoice line. */
    quantity: z.number().int().positive('Anzahl muss mindestens 1 sein').default(1),
    /**
     * Leistungsdatum (ISO YYYY-MM-DD). Relevant for BRE year assignment and
     * for session-scoped constraint validation on Sammelrechnungen.
     */
    treatment_date: z.string().date().nullish(),
    description: z.string().nullish(),
    multiplier: z
      .number({ invalid_type_error: 'Steigerungsfaktor muss eine Zahl sein' })
      .finite()
      .positive('Steigerungsfaktor muss größer als 0 sein'),
    base_amount: money,
    charged_amount: money,
    is_valid: z.boolean().nullish(),
    flag_reason: z.string().nullish(),
  })
  .strict();

/** Full create payload, including the `invoice_id` FK the server persists. */
export const invoicePositionCreateSchema = invoicePositionInputSchema.extend({ invoice_id: uuid });

/**
 * A persisted invoice line. Note this table carries no `created_at` — its only
 * server-assigned field is `id`.
 */
export const invoicePositionSchema = invoicePositionCreateSchema.extend({ id: uuid });

export const invoicePositionUpdateSchema = invoicePositionInputSchema.partial();

export type InvoicePositionInput = z.infer<typeof invoicePositionInputSchema>;
export type InvoicePositionCreate = z.infer<typeof invoicePositionCreateSchema>;
export type InvoicePosition = z.infer<typeof invoicePositionSchema>;
export type InvoicePositionUpdate = z.infer<typeof invoicePositionUpdateSchema>;

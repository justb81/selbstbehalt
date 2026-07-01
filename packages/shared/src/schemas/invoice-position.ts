// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

import { money, uuid } from '../common.js';
import { goaeCategorySchema } from '../enums.js';

/**
 * Client-supplied fields of an invoice line (§3.2 `invoice_positions`), with no
 * `invoice_id`. This is the shape used when positions are created nested inside
 * their parent invoice (`POST /api/invoices`): the FK comes from the freshly
 * inserted invoice, so a body-level `invoice_id` would be redundant.
 */
export const invoicePositionInputSchema = z
  .object({
    /** Empty for `goae_category: 'Auslagenersatz'`, which has no Ziffer to bill under. */
    goae_number: z.string(),
    /**
     * GOÄ | GOZ | GOT, or `Auslagenersatz` for §10 GOÄ expense reimbursement
     * (Porto/Versand etc.) — see {@link goaeCategoryValues}.
     */
    goae_category: goaeCategorySchema.nullish(),
    /** Anzahl (quantity); omitted when not stated on the invoice line (backend defaults to 1). */
    quantity: z.number().int().positive('Anzahl muss mindestens 1 sein').optional(),
    /**
     * Leistungsdatum (ISO YYYY-MM-DD). Pflichtfeld: bestimmt das Leistungsjahr für die
     * Günstigerprüfung und die BRE-Berechnung (§5.1, Issue #139).
     */
    treatment_date: z.string().date('Leistungsdatum muss im Format JJJJ-MM-TT vorliegen'),
    description: z.string().nullish(),
    multiplier: z
      .number({ invalid_type_error: 'Steigerungsfaktor muss eine Zahl sein' })
      .finite()
      .positive('Steigerungsfaktor muss größer als 0 sein'),
    base_amount: money,
    charged_amount: money,
    /**
     * Erstattungsfähiger Betrag je Position in EUR (nullable = noch nicht berechnet).
     * Wird von der Erstattungs-Engine befüllt; das Backend aggregiert daraus invoice.eligible_amount.
     */
    eligible_amount: money.nullish(),
    /**
     * Tatsächlich erstatteter Betrag je Position in EUR (nullable = noch nicht erstattet).
     * 0 = Ablehnung. Wird über PUT /api/invoices/:id/refund gesetzt.
     */
    refund_amount: money.nullish(),
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

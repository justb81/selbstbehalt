// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

import { money, uuid } from '../common.js';
import { goaeCategorySchema, isNonScheduleCategory } from '../enums.js';
import { roundCents } from '../utils/money.js';

/**
 * Client-supplied fields of an invoice line (§3.2 `invoice_positions`), with no
 * `invoice_id`. This is the base object shape used when positions are created
 * nested inside their parent invoice (`POST /api/invoices`): the FK comes from
 * the freshly inserted invoice, so a body-level `invoice_id` would be redundant.
 *
 * The exported schemas below layer {@link refineNonScheduleAmount} on top; this
 * raw object is kept separate so `.extend()`/`.partial()` stay available (a
 * refined schema is a ZodEffects and can no longer be extended).
 */
const invoicePositionFields = z
  .object({
    /** Empty for non-fee-schedule categories (Auslagenersatz, Arznei-/Hilfsmittel) — no Ziffer to bill under. */
    goae_number: z.string(),
    /**
     * GOÄ | GOZ | GOT, or a non-fee-schedule category (`Auslagenersatz` for §10 GOÄ
     * expense reimbursement, `Arznei-/Hilfsmittel` for per-Rezept medication/aids) —
     * see {@link goaeCategoryValues}.
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
    /**
     * Steigerungsfaktor (§5 GOÄ). For non-fee-schedule categories it carries no meaning
     * and is fixed at 1 (there the amount is Anzahl × Basis, not Basis × Faktor).
     */
    multiplier: z
      .number({ error: 'Steigerungsfaktor muss eine Zahl sein' })
      .finite()
      .positive('Steigerungsfaktor muss größer als 0 sein'),
    /** Basis: 1-facher GOÄ-Satz, or the Einzelpreis for non-fee-schedule categories. */
    base_amount: money,
    /** Gesamtbetrag; for non-fee-schedule categories it must equal Anzahl × Basis (see refinement). */
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

/**
 * For non-fee-schedule categories (Auslagenersatz, Arznei-/Hilfsmittel) the amount is
 * `quantity × base_amount` (Anzahl × Basis) — enforce that `charged_amount` matches, to
 * the cent. GOÄ/GOZ/GOT positions (Basis × Steigerungsfaktor × Anzahl) are unconstrained.
 * Defensive: skips the check when the relevant fields are absent (partial updates).
 */
function refineNonScheduleAmount(
  data: {
    goae_category?: z.infer<typeof goaeCategorySchema> | null;
    quantity?: number;
    base_amount?: number;
    charged_amount?: number;
  },
  ctx: z.RefinementCtx,
): void {
  if (!isNonScheduleCategory(data.goae_category)) return;
  if (typeof data.base_amount !== 'number' || typeof data.charged_amount !== 'number') return;
  const expected = roundCents((data.quantity ?? 1) * data.base_amount);
  if (roundCents(data.charged_amount) !== expected) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['charged_amount'],
      message: 'Gesamtbetrag muss Anzahl × Basis entsprechen',
    });
  }
}

export const invoicePositionInputSchema =
  invoicePositionFields.superRefine(refineNonScheduleAmount);

/** Full create payload, including the `invoice_id` FK the server persists. */
export const invoicePositionCreateSchema = invoicePositionFields
  .extend({ invoice_id: uuid })
  .superRefine(refineNonScheduleAmount);

/**
 * A persisted invoice line. Note this table carries no `created_at` — its only
 * server-assigned field is `id`.
 */
export const invoicePositionSchema = invoicePositionFields
  .extend({ invoice_id: uuid, id: uuid })
  .superRefine(refineNonScheduleAmount);

export const invoicePositionUpdateSchema = invoicePositionFields
  .partial()
  .superRefine(refineNonScheduleAmount);

export type InvoicePositionInput = z.infer<typeof invoicePositionInputSchema>;
export type InvoicePositionCreate = z.infer<typeof invoicePositionCreateSchema>;
export type InvoicePosition = z.infer<typeof invoicePositionSchema>;
export type InvoicePositionUpdate = z.infer<typeof invoicePositionUpdateSchema>;

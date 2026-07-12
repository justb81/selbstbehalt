// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

import { money, uuid } from '../common.js';
import { benefitCategorySchema, goaeCategorySchema, isNonScheduleCategory } from '../enums.js';
import { roundCents } from '../utils/money.js';

/**
 * Client-supplied fields of an invoice line (§3.2 `invoice_positions`), with no
 * `invoice_id`. This is the base object shape used when positions are created
 * nested inside their parent invoice (`POST /api/invoices`): the FK comes from
 * the freshly inserted invoice, so a body-level `invoice_id` would be redundant.
 *
 * The write-side schemas below layer {@link refineNonScheduleAmount} on top; this
 * raw object is kept separate so `.extend()`/`.partial()` stay available (a
 * refined schema is a ZodEffects and can no longer be extended). The persisted
 * read schema ({@link invoicePositionSchema}) deliberately omits that refinement —
 * see the note there.
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
    /**
     * Tarif-Leistungsbereich, unter dem die Position erstattet wird (`ambulant`,
     * `zahnbehandlung`, `kieferorthopaedie`, … — siehe {@link benefitCategoryValues}).
     * Wird beim Speichern aus der Gebühren-Tabelle bzw. der Auslagen-Herleitung
     * aufgelöst (voller Rechnungskontext, `InvoiceForm`) und persistiert, damit die
     * Erstattungs-Erfassung je Kategorie und spätere Auswertungen ohne erneuten
     * Tabellen-Lookup gruppieren können. Nullable = Alt-Position vor #-Feature.
     */
    benefit_category: benefitCategorySchema.nullish(),
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
 * A persisted invoice line, as read back from the server. Note this table carries
 * no `created_at` — its only server-assigned field is `id`.
 *
 * Unlike the write-side schemas this does **not** enforce {@link refineNonScheduleAmount}:
 * `charged_amount == Anzahl × Basis` is a write-time invariant, and a response schema
 * must faithfully deserialize whatever is already persisted. Positions created before the
 * non-fee-schedule model (#248) stored `base_amount = 0` alongside a non-zero
 * `charged_amount`, and an old SQLite backup restored via `/api/import/db` (rows copied
 * verbatim, no migration re-run) can still carry such rows. Enforcing the invariant here
 * would reject the whole invoice on read — surfacing as "Antwort des Servers entsprach
 * nicht dem erwarteten Schema" — instead of at most flagging one line. Migration 0005
 * backfills the legacy rows; keeping the read schema permissive means reads stay robust
 * even where it has not run (imports, manual edits).
 */
export const invoicePositionSchema = invoicePositionFields.extend({
  invoice_id: uuid,
  id: uuid,
});

export const invoicePositionUpdateSchema = invoicePositionFields
  .partial()
  .superRefine(refineNonScheduleAmount);

export type InvoicePositionInput = z.infer<typeof invoicePositionInputSchema>;
export type InvoicePositionCreate = z.infer<typeof invoicePositionCreateSchema>;
export type InvoicePosition = z.infer<typeof invoicePositionSchema>;
export type InvoicePositionUpdate = z.infer<typeof invoicePositionUpdateSchema>;

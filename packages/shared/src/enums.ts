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
export const providerTypeValues = [
  'arzt',
  'zahnarzt',
  'kieferorthopaede',
  'krankenhaus',
  'sonstiges',
] as const;
export const providerTypeSchema = z.enum(providerTypeValues);
export type ProviderType = z.infer<typeof providerTypeSchema>;

/**
 * The invoice lifecycle is modelled as **three independent tracks** rather than one
 * linear status, because paying the doctor and submitting to the insurer run in
 * parallel (the reimbursement often arrives before the invoice is paid). The current
 * state per track is **derived** from the append-only `invoice_status_events` log
 * (latest event per track, see `deriveInvoiceStatus`); these tuples are only the
 * value *vocabulary* — there is no denormalised status column on `invoices`.
 *
 * - **`review`** — Anlage/Prüfung gate. In the Günstigerprüfung only `neu` is ignored.
 * - **`payment`** — Bezahlung an den Arzt. Independent of submission; the payment date
 *   is the `changed_at` of the `bezahlt` event. "Selbst zahlen" = `bezahlt` payment with
 *   the submission track left at `nicht_eingereicht`.
 * - **`submission`** — Einreichung/Erstattung beim Versicherer. Rejection (Ablehnung) is
 *   `erstattet` with `refund_amount = 0` per position.
 *
 * `payment` and `submission` may only leave their ground state once `review = 'geprüft'`.
 */
export const reviewStatusValues = ['neu', 'geprüft'] as const;
export const reviewStatusSchema = z.enum(reviewStatusValues);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

export const paymentStatusValues = ['offen', 'bezahlt'] as const;
export const paymentStatusSchema = z.enum(paymentStatusValues);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

export const submissionStatusValues = ['nicht_eingereicht', 'eingereicht', 'erstattet'] as const;
export const submissionStatusSchema = z.enum(submissionStatusValues);
export type SubmissionStatus = z.infer<typeof submissionStatusSchema>;

/** The three lifecycle tracks (`invoice_status_events.track`). */
export const statusTrackValues = ['review', 'payment', 'submission'] as const;
export const statusTrackSchema = z.enum(statusTrackValues);
export type StatusTrack = z.infer<typeof statusTrackSchema>;

/**
 * Any value that can appear as an `invoice_status_events.status` (across all tracks).
 * All seven values are globally unique, so a single flat label/variant lookup drives
 * the badges without needing the track discriminator.
 */
export const invoiceStatusEventValueValues = [
  ...reviewStatusValues,
  ...paymentStatusValues,
  ...submissionStatusValues,
] as const;
export const invoiceStatusEventValueSchema = z.enum(invoiceStatusEventValueValues);
export type InvoiceStatusEventValue = z.infer<typeof invoiceStatusEventValueSchema>;

/** Maps an event value to the track it belongs to (all values are globally unique). */
export function trackForStatusValue(value: InvoiceStatusEventValue): StatusTrack {
  if (value === 'neu' || value === 'geprüft') return 'review';
  if (value === 'offen' || value === 'bezahlt') return 'payment';
  return 'submission';
}

/**
 * Fee-schedule a position is billed under (`invoice_positions.goae_category`).
 *
 * `GOÄ`/`GOZ`/`GOT` are real fee schedules (Ziffer + Steigerungsfaktor). The
 * remaining values are **non-fee-schedule** categories (see
 * {@link nonScheduleGoaeCategoryValues}): they carry no Ziffer/Steigerungsfaktor
 * and their amount is `quantity × base_amount` (Anzahl × Basis):
 * - `Auslagenersatz` — §10 GOÄ expense reimbursement (Porto-/Versandkosten **and**
 *   Materialkosten).
 * - `Arznei-/Hilfsmittel` — per-Rezept medication/aids receipts (Apotheke/Sanitätshaus):
 *   Bezeichnung, Menge, Einzelpreis.
 * - `Material-/Laborkosten` — §9 GOZ practice-lab expenses billed as a single
 *   summary line on dental/orthodontic invoices (the itemised BEB/BEL breakdown
 *   is only in the attached Eigenlabor-/Materialbeleg).
 *
 * Only `Arznei-/Hilfsmittel` is reimbursed at a flat 100 % of `charged_amount`
 * ({@link isFlatReimbursedCategory}) — provisional, later corrected by the insurer's
 * actual `refund_amount`. `Auslagenersatz` and `Material-/Laborkosten` run through
 * the normal §5.1 tariff pipeline with a benefit_category derived from the invoice's
 * honorar positions (see design §5.1).
 */
export const goaeCategoryValues = [
  'GOÄ',
  'GOZ',
  'GOT',
  'Auslagenersatz',
  'Arznei-/Hilfsmittel',
  'Material-/Laborkosten',
] as const;
export const goaeCategorySchema = z.enum(goaeCategoryValues);
export type GoaeCategory = z.infer<typeof goaeCategorySchema>;

/**
 * The non-fee-schedule position categories: no Ziffer/Steigerungsfaktor, amount is
 * `quantity × base_amount` (Anzahl × Basis). This governs the **amount arithmetic**
 * and the review UI (hidden Ziffer/Faktor fields, Betrag = Anzahl × Basis) only — it
 * does **not** imply flat 100 % reimbursement. Only `Arznei-/Hilfsmittel` is reimbursed
 * flat ({@link isFlatReimbursedCategory}); `Auslagenersatz` (§10 GOÄ) and
 * `Material-/Laborkosten` (§9 GOZ) run through the §5.1 tariff pipeline with a derived
 * benefit_category. See {@link goaeCategoryValues} and design §3.2/§5.1.
 */
export const nonScheduleGoaeCategoryValues = [
  'Auslagenersatz',
  'Arznei-/Hilfsmittel',
  'Material-/Laborkosten',
] as const;
export type NonScheduleGoaeCategory = (typeof nonScheduleGoaeCategoryValues)[number];

/**
 * Whether `cat` is a non-fee-schedule category (Auslagenersatz, Arznei-/Hilfsmittel
 * or Material-/Laborkosten): billed as `quantity × base_amount`, no
 * Ziffer/Steigerungsfaktor. Governs amount arithmetic and the review UI — **not**
 * whether the reimbursement is flat 100 % (that is {@link isFlatReimbursedCategory}).
 */
export function isNonScheduleCategory(
  cat: GoaeCategory | null | undefined,
): cat is NonScheduleGoaeCategory {
  return (
    cat === 'Auslagenersatz' || cat === 'Arznei-/Hilfsmittel' || cat === 'Material-/Laborkosten'
  );
}

/**
 * Whether `cat` is reimbursed at a flat 100 % of `charged_amount`, bypassing the
 * §5.1 tariff pipeline entirely (Wartezeit, Schwellen-Staffel, Beihilfe-Quote,
 * Summengrenzen, Aufbaujahres-Staffel). Only `Arznei-/Hilfsmittel` (per-Rezept
 * medication/aids, #248) — provisional, later corrected by the insurer's actual
 * `refund_amount`.
 *
 * Distinct from {@link isNonScheduleCategory}, the broader "Anzahl × Basis, no
 * Ziffer/Faktor" arithmetic/UI concern: `Auslagenersatz` and `Material-/Laborkosten`
 * are non-schedule but **not** flat — they run the tariff pipeline with a
 * benefit_category derived from the invoice's honorar positions.
 */
export function isFlatReimbursedCategory(cat: GoaeCategory | null | undefined): boolean {
  return cat === 'Arznei-/Hilfsmittel';
}

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

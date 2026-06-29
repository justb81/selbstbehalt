// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

import { auditFields, isoDate, money, uuid } from '../common.js';
import { includedBenefitsSchema } from './included-benefits.js';

/**
 * One tier of a premium-refund (Beitragsrückerstattung) ladder: stay
 * claim-free for `leistungsfrei_years` calendar years and you earn either
 * `bre_months × pct_of_premium / 100` months of premium back (percentage mode)
 * or a `fixed_amount_eur` (fixed-amount mode). Exactly one mode must be set.
 */
export const breLevelSchema = z
  .object({
    leistungsfrei_years: z.number().int().nonnegative(),
    // Percentage mode: bre_months × monthly_premium × pct_of_premium / 100
    bre_months: z.number().nonnegative().optional(),
    pct_of_premium: z.number().min(0).max(100).optional(),
    // Fixed-amount mode: exact EUR refund regardless of premium
    fixed_amount_eur: money.optional(),
  })
  .strict()
  .refine(
    (d) =>
      d.fixed_amount_eur !== undefined ||
      (d.pct_of_premium !== undefined && d.bre_months !== undefined),
    { message: 'Entweder fixed_amount_eur oder (bre_months + pct_of_premium) erforderlich.' },
  );

/** Structured `insured_persons.bre_structure` (stored as JSON TEXT). */
export const breStructureSchema = z
  .object({
    type: z.literal('staffel'),
    levels: z.array(breLevelSchema).min(1, 'Mindestens eine Staffel-Stufe erforderlich'),
    current_streak_start: isoDate.nullish(),
  })
  .strict();

/**
 * A versicherte Person on a contract — the link between `persons` and
 * `contracts` that carries the individual cover (§3.2 `insured_persons`). Each
 * one has its own Krankenversichertennummer (`kvnr`), tariff, premium,
 * Selbstbehalt and BRE structure.
 */
export const insuredPersonCreateSchema = z
  .object({
    contract_id: uuid,
    person_id: uuid,
    kvnr: z.string().nullish(),
    tariff_name: z.string().nullish(),
    monthly_premium: money,
    // NOT NULL DEFAULT 0 in the DB — omittable on create, the DB supplies 0.
    self_retention: money.optional(),
    bre_structure: breStructureSchema.nullish(),
    included_benefits: includedBenefitsSchema.nullish(),
    start_date: isoDate.nullish(),
    end_date: isoDate.nullish(),
    notes: z.string().nullish(),
  })
  .strict();

export const insuredPersonSchema = insuredPersonCreateSchema.extend({
  ...auditFields,
  // Always present when read back (DB default applied).
  self_retention: money,
});

export const insuredPersonUpdateSchema = insuredPersonCreateSchema.partial();

export type BRELevel = z.infer<typeof breLevelSchema>;
export type BREStructure = z.infer<typeof breStructureSchema>;
export type InsuredPersonCreate = z.infer<typeof insuredPersonCreateSchema>;
export type InsuredPerson = z.infer<typeof insuredPersonSchema>;
export type InsuredPersonUpdate = z.infer<typeof insuredPersonUpdateSchema>;

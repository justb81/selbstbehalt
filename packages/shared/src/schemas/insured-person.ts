// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

import { auditFields, isoDate, money, uuid } from '../common.js';

/**
 * One tier of a premium-refund (Beitragsrückerstattung) ladder: stay
 * claim-free for `leistungsfrei_months` and you earn `bre_months` worth of
 * premium back, at `pct_of_premium` percent. Mirrors the JSON example in §3.2.
 */
export const breLevelSchema = z.object({
  leistungsfrei_months: z.number().int().nonnegative(),
  bre_months: z.number().nonnegative(),
  pct_of_premium: z.number().min(0).max(100),
});

/** Structured `insured_persons.bre_structure` (stored as JSON TEXT). */
export const breStructureSchema = z.object({
  type: z.literal('staffel'),
  levels: z.array(breLevelSchema).min(1, 'Mindestens eine Staffel-Stufe erforderlich'),
  current_streak_start: isoDate.nullish(),
});

/** Structured `insured_persons.included_benefits` (stored as JSON TEXT). */
export const includedBenefitsSchema = z.array(z.string().min(1));

/**
 * A versicherte Person on a contract — the link between `persons` and
 * `contracts` that carries the individual cover (§3.2 `insured_persons`). Each
 * one has its own Krankenversichertennummer (`kvnr`), tariff, premium,
 * Selbstbehalt and BRE structure.
 */
export const insuredPersonCreateSchema = z.object({
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
});

export const insuredPersonSchema = insuredPersonCreateSchema.extend({
  ...auditFields,
  // Always present when read back (DB default applied).
  self_retention: money,
});

export const insuredPersonUpdateSchema = insuredPersonCreateSchema.partial();

export type BRELevel = z.infer<typeof breLevelSchema>;
export type BREStructure = z.infer<typeof breStructureSchema>;
export type IncludedBenefits = z.infer<typeof includedBenefitsSchema>;
export type InsuredPersonCreate = z.infer<typeof insuredPersonCreateSchema>;
export type InsuredPerson = z.infer<typeof insuredPersonSchema>;
export type InsuredPersonUpdate = z.infer<typeof insuredPersonUpdateSchema>;

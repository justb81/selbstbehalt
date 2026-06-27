// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

import { auditFields, isoDate, money, uuid } from '../common.js';
import { contractTypeSchema } from '../enums.js';

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

/** Structured `contracts.bre_structure` (stored as JSON TEXT). */
export const breStructureSchema = z.object({
  type: z.literal('staffel'),
  levels: z.array(breLevelSchema).min(1, 'Mindestens eine Staffel-Stufe erforderlich'),
  current_streak_start: isoDate.nullish(),
});

/** Structured `contracts.included_benefits` (stored as JSON TEXT). */
export const includedBenefitsSchema = z.array(z.string().min(1));

export const contractCreateSchema = z.object({
  person_id: uuid,
  insurer_name: z.string().min(1, 'Versicherername darf nicht leer sein'),
  contract_number: z.string().nullish(),
  tariff_name: z.string().nullish(),
  type: contractTypeSchema,
  start_date: isoDate,
  end_date: isoDate.nullish(),
  monthly_premium: money,
  // NOT NULL DEFAULT 0 in the DB — omittable on create, the DB supplies 0.
  self_retention: money.optional(),
  bre_structure: breStructureSchema.nullish(),
  included_benefits: includedBenefitsSchema.nullish(),
  notes: z.string().nullish(),
});

export const contractSchema = contractCreateSchema.extend({
  ...auditFields,
  // Always present when read back (DB default applied).
  self_retention: money,
});

export const contractUpdateSchema = contractCreateSchema.partial();

export type BRELevel = z.infer<typeof breLevelSchema>;
export type BREStructure = z.infer<typeof breStructureSchema>;
export type IncludedBenefits = z.infer<typeof includedBenefitsSchema>;
export type ContractCreate = z.infer<typeof contractCreateSchema>;
export type Contract = z.infer<typeof contractSchema>;
export type ContractUpdate = z.infer<typeof contractUpdateSchema>;

// SPDX-License-Identifier: Apache-2.0
//
// Structured `insured_persons.included_benefits` (stored as JSON TEXT, §3.2).
// Per-category tariff reimbursement rules — the data the Erstattungs-Engine
// (§5.1) turns into a concrete `eligible_amount` per insured person. Each
// benefit block combines the four usual PKV/Zusatz knobs:
//   - Erstattungssatz / Schwellen-Staffel (`tiers`),
//   - Summengrenzen (`limits`, per case / year / lifelong, optionally age-bound),
//   - Aufbaujahres-Staffel (`annual_staffel`, the dental "Zahnstaffel"),
//   - Wartezeit (`waiting_period_months`),
// plus `beihilfe_satz` for Beihilfe-compliant tariffs (the tariff carries the
// residual quota to the Beihilfe entitlement).

import { z } from 'zod';

import { benefitCategorySchema, benefitLimitScopeSchema } from '../enums.js';
import { money } from '../common.js';

/** A reimbursement percentage, 0–100. */
const pct = z
  .number({ invalid_type_error: 'Prozentsatz muss eine Zahl sein' })
  .min(0, 'Prozentsatz darf nicht negativ sein')
  .max(100, 'Prozentsatz darf 100 nicht überschreiten');

/** A non-negative whole number of months. */
const months = z.number().int().nonnegative();

/** An age in whole years, 0 or more. */
const age = z.number().int().nonnegative();

/**
 * One step of a threshold ladder: reimburse `pct` % up to the cumulative amount
 * `up_to` (EUR), beyond which the next tier applies. `up_to: null` marks the
 * open-ended top tier ("everything above"). See §3.2 `tiers`.
 */
export const benefitTierSchema = z
  .object({
    up_to: money.nullable(),
    pct,
  })
  .strict();

/**
 * A spending cap. `max_amount: null` = unlimited (used to declare an age-bound
 * carve-out without a money limit). `age_min`/`age_max` restrict the cap to a
 * patient age range (inclusive). See §3.2 `limits`.
 */
export const benefitLimitSchema = z
  .object({
    scope: benefitLimitScopeSchema,
    max_amount: money.nullable(),
    age_min: age.optional(),
    age_max: age.optional(),
  })
  .strict();

/**
 * One year of the build-up ladder (Zahnstaffel): the cumulative cap
 * `cumulative_cap` (EUR) that applies in `policy_year`. The final entry with
 * `cumulative_cap: null` means "unlimited from that policy year on". See §3.2
 * `annual_staffel`.
 */
export const annualStaffelEntrySchema = z
  .object({
    policy_year: z.number().int().positive(),
    cumulative_cap: money.nullable(),
  })
  .strict();

/**
 * The reimbursement rules for a single benefit area. `tiers`, when present, must
 * be an ascending ladder with exactly one trailing open-ended (`up_to: null`)
 * entry; the validation below enforces that the steps form a coherent staffel.
 */
export const includedBenefitSchema = z
  .object({
    category: benefitCategorySchema,
    waiting_period_months: months.optional(),
    beihilfe_satz: pct.optional(),
    tiers: z.array(benefitTierSchema).min(1).optional(),
    limits: z.array(benefitLimitSchema).optional(),
    annual_staffel: z.array(annualStaffelEntrySchema).optional(),
  })
  .strict()
  .superRefine((benefit, ctx) => {
    if (benefit.tiers) {
      validateTiers(benefit.tiers, ctx);
    }
    if (benefit.annual_staffel) {
      validateAnnualStaffel(benefit.annual_staffel, ctx);
    }
  });

/**
 * `tiers` must be a well-formed threshold ladder:
 *   - exactly one open-ended (`up_to: null`) entry, and it must be the last one,
 *   - the finite `up_to` thresholds strictly ascending.
 */
function validateTiers(tiers: z.infer<typeof benefitTierSchema>[], ctx: z.RefinementCtx): void {
  const openIndexes = tiers.flatMap((tier, i) => (tier.up_to === null ? [i] : []));
  if (openIndexes.length !== 1 || openIndexes[0] !== tiers.length - 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['tiers'],
      message: 'tiers müssen mit genau einer abschließenden Stufe (up_to: null) enden',
    });
    return;
  }
  // All but the last entry have a finite `up_to`; they must strictly ascend.
  for (let i = 1; i < tiers.length - 1; i++) {
    if (tiers[i]!.up_to! <= tiers[i - 1]!.up_to!) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tiers', i, 'up_to'],
        message: 'tiers müssen aufsteigend nach up_to sortiert sein',
      });
    }
  }
}

/**
 * `annual_staffel` must ascend by `policy_year`, with any open-ended
 * (`cumulative_cap: null`) entry coming last (unlimited from that year on).
 */
function validateAnnualStaffel(
  staffel: z.infer<typeof annualStaffelEntrySchema>[],
  ctx: z.RefinementCtx,
): void {
  for (let i = 1; i < staffel.length; i++) {
    if (staffel[i]!.policy_year <= staffel[i - 1]!.policy_year) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['annual_staffel', i, 'policy_year'],
        message: 'annual_staffel muss aufsteigend nach policy_year sortiert sein',
      });
    }
  }
  const openIndex = staffel.findIndex((entry) => entry.cumulative_cap === null);
  if (openIndex !== -1 && openIndex !== staffel.length - 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['annual_staffel', openIndex, 'cumulative_cap'],
      message: 'eine unbegrenzte Stufe (cumulative_cap: null) muss die letzte sein',
    });
  }
}

/** Structured `insured_persons.included_benefits` (stored as JSON TEXT). */
export const includedBenefitsSchema = z
  .object({
    benefits: z.array(includedBenefitSchema),
  })
  .strict();

export type BenefitTier = z.infer<typeof benefitTierSchema>;
export type BenefitLimit = z.infer<typeof benefitLimitSchema>;
export type AnnualStaffelEntry = z.infer<typeof annualStaffelEntrySchema>;
export type IncludedBenefit = z.infer<typeof includedBenefitSchema>;
export type IncludedBenefits = z.infer<typeof includedBenefitsSchema>;

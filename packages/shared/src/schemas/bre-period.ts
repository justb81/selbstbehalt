// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

import { money, uuid } from '../common.js';

/** A per-year premium-refund tracking row (§3.2 `bre_periods`). */
export const brePeriodCreateSchema = z
  .object({
    insured_person_id: uuid,
    year: z
      .number({ error: 'Jahr muss eine Zahl sein' })
      .int('Jahr muss eine Ganzzahl sein')
      .min(1900, 'Jahr ist unplausibel')
      .max(2200, 'Jahr ist unplausibel'),
    // NOT NULL DEFAULT 0 — omittable on create.
    streak_years: z.number().int().nonnegative().optional(),
    bre_amount: money.optional(),
    projected_bre: money.nullish(),
  })
  .strict();

export const brePeriodSchema = brePeriodCreateSchema.extend({
  id: uuid,
  // Always present when read back (DB defaults applied).
  streak_years: z.number().int().nonnegative(),
  bre_amount: money,
});

export const brePeriodUpdateSchema = brePeriodCreateSchema.partial();

export type BREPeriodCreate = z.infer<typeof brePeriodCreateSchema>;
export type BREPeriod = z.infer<typeof brePeriodSchema>;
export type BREPeriodUpdate = z.infer<typeof brePeriodUpdateSchema>;

// SPDX-License-Identifier: Apache-2.0
//
// Transport-level contracts shared by the backend (which produces them) and the
// frontend (which parses them). These are not persisted entities — they are the
// wire shapes of the REST envelope and the health probe. Keeping them here is
// the single source of truth so the two sides cannot drift apart.

import { z } from 'zod';

import { money, uuid } from './common.js';
import { goaeCategorySchema } from './enums.js';

/**
 * The unified error envelope the backend returns for every non-2xx response
 * (see `apps/backend/src/middleware/error.ts`).
 */
export const errorBodySchema = z.object({
  error: z.object({
    status: z.number(),
    message: z.string(),
  }),
});
export type ErrorBody = z.infer<typeof errorBodySchema>;

/**
 * Response shape of the unauthenticated `/api/health` liveness/readiness probe
 * (see `apps/backend/src/routes/health.ts`).
 */
export const healthBodySchema = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.string(),
  db: z.enum(['up', 'down']),
});
export type HealthBody = z.infer<typeof healthBodySchema>;

/**
 * Response of `GET /api/stats/year/:year` (#13): the calendar-year roll-up that
 * feeds the dashboard and statistics page. `total_amount` / `eligible_amount` /
 * `self_paid_amount` sum the year's invoices (by `invoice_date`), `refund_amount`
 * sums refunds actually received that year (by `submissions.refund_date`), and
 * `bre_amount` the premium refund booked in that year's `bre_periods`.
 */
export const yearStatsSchema = z.object({
  year: z.number().int(),
  invoice_count: z.number().int().nonnegative(),
  total_amount: money,
  eligible_amount: money,
  self_paid_amount: money,
  refund_amount: money,
  bre_amount: money,
});
export type YearStats = z.infer<typeof yearStatsSchema>;

/** One year on an insured person's premium-refund (BRE) progression (see #13). */
export const breHistoryYearSchema = z.object({
  year: z.number().int(),
  /** Claim-free years recorded for that year (`bre_periods.streak_years`). */
  streak_years: z.number().int().nonnegative(),
  /** Premium refund actually booked that year (`bre_periods.bre_amount`). */
  bre_amount: money,
  /**
   * Premium refund the streak projects to (shared BRE helper, #17). `null` only
   * when the insured person carries no `bre_structure` and no value was stored.
   */
  projected_bre: money.nullable(),
});
export type BREHistoryYear = z.infer<typeof breHistoryYearSchema>;

/** Response of `GET /api/stats/bre/:insuredPersonId` (#13): the BRE ladder over time. */
export const breHistorySchema = z.object({
  insured_person_id: uuid,
  years: z.array(breHistoryYearSchema),
});
export type BREHistory = z.infer<typeof breHistorySchema>;

/**
 * One Leistungsjahr on an insured person's positions roll-up (see #239). Amounts
 * are split by the §5.2.1 status rule: `refund_amount` sums only positions on
 * `erstattet` invoices, `eligible_amount` only positions on `geprüft`/`bezahlt`/
 * `eingereicht` invoices, and `charged_amount` sums across all of those (i.e.
 * everything except `neu`). Summing `eligible_amount + refund_amount` yields the
 * Günstigerprüfung's `R_Y` for that year.
 */
export const positionYearRollupYearSchema = z.object({
  year: z.number().int(),
  charged_amount: money,
  eligible_amount: money,
  refund_amount: money,
});
export type PositionYearRollupYear = z.infer<typeof positionYearRollupYearSchema>;

/**
 * Response of `GET /api/stats/positions/:insuredPersonId` (#239): the positions
 * roll-up by Leistungsjahr (`invoice_positions.treatment_date` year) that feeds
 * the Günstigerprüfung KPIs (#234/#235/#236). Years with no non-`neu` positions
 * are omitted rather than zero-filled.
 */
export const positionYearRollupSchema = z.object({
  insured_person_id: uuid,
  years: z.array(positionYearRollupYearSchema),
});
export type PositionYearRollup = z.infer<typeof positionYearRollupSchema>;

/** Dimension `GET /api/stats/reductions` (#239) groups the Kürzungs-Roll-up by. */
export const reductionGroupByValues = [
  'tariff',
  'provider_name',
  'provider_type',
  'goae_number',
] as const;
export const reductionGroupBySchema = z.enum(reductionGroupByValues);
export type ReductionGroupBy = z.infer<typeof reductionGroupBySchema>;

/**
 * One group of the Kürzungs-Roll-up (see #239): `eligible_amount` (expected) vs.
 * `refund_amount` (received) over `erstattet` positions with a decided
 * `refund_amount` (i.e. not `null`). `rejection_count`/`rejection_amount` count
 * the subset that was rejected outright (`refund_amount = 0` while
 * `eligible_amount > 0`). `open_count` — positions with `refund_amount = null`,
 * "not yet decided" — is reported separately so it is never mistaken for a €0
 * outcome.
 */
export const reductionRollupGroupSchema = z.object({
  /** The tariff/provider/Ziffer value for this group; `null` when unset. */
  group: z.string().nullable(),
  eligible_amount: money,
  refund_amount: money,
  reduction_amount: money,
  rejection_count: z.number().int().nonnegative(),
  rejection_amount: money,
  open_count: z.number().int().nonnegative(),
});
export type ReductionRollupGroup = z.infer<typeof reductionRollupGroupSchema>;

/** Response of `GET /api/stats/reductions?group_by=...` (#239). */
export const reductionRollupSchema = z.object({
  group_by: reductionGroupBySchema,
  groups: z.array(reductionRollupGroupSchema),
});
export type ReductionRollup = z.infer<typeof reductionRollupSchema>;

/**
 * Coarse category a `flag_reason` string is bucketed into (see #239). Derived
 * heuristically from the fixed German phrase templates the GOÄ parser emits
 * (`packages/medic-invoice-check/.../goae-parser.ts`) — not a persisted column.
 */
export const validationFlagCategoryValues = [
  'steigerungsfaktor',
  'ausschluss',
  'erfordert',
  'bestandteil',
  'hoechstwert',
  'frequenz',
  'dauer',
  'alter',
  'unbekannte_ziffer',
  'sonstiges',
] as const;
export const validationFlagCategorySchema = z.enum(validationFlagCategoryValues);
export type ValidationFlagCategory = z.infer<typeof validationFlagCategorySchema>;

/** One `flag_reason` category in the Validierungs-Roll-up (see #239). */
export const validationFlagRollupGroupSchema = z.object({
  category: validationFlagCategorySchema,
  count: z.number().int().nonnegative(),
  charged_amount: money,
});
export type ValidationFlagRollupGroup = z.infer<typeof validationFlagRollupGroupSchema>;

/** Steigerungsfaktor distribution for one `goae_category` (see #239). */
export const multiplierDistributionSchema = z.object({
  goae_category: goaeCategorySchema,
  count: z.number().int().positive(),
  avg_multiplier: z.number().positive(),
  min_multiplier: z.number().positive(),
  max_multiplier: z.number().positive(),
});
export type MultiplierDistribution = z.infer<typeof multiplierDistributionSchema>;

/**
 * Response of `GET /api/stats/validations` (#239): the beanstandete-Positionen
 * roll-up (grouped by `flag_reason` category) plus the Steigerungsfaktor
 * distribution per `goae_category`, feeding #238.
 */
export const validationRollupSchema = z.object({
  flags: z.array(validationFlagRollupGroupSchema),
  multiplier_distribution: z.array(multiplierDistributionSchema),
});
export type ValidationRollup = z.infer<typeof validationRollupSchema>;

/**
 * Response of `POST /api/import/db` (#14): the result of restoring an uploaded
 * SQLite database. `backup_path` is the server-side path of the pre-overwrite
 * safety backup, or `null` for an ephemeral (`:memory:`) database.
 */
export const importResultSchema = z.object({
  status: z.literal('ok'),
  tables_imported: z.number().int().nonnegative(),
  rows_imported: z.number().int().nonnegative(),
  backup_path: z.string().nullable(),
});
export type ImportResult = z.infer<typeof importResultSchema>;

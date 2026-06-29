// SPDX-License-Identifier: Apache-2.0
//
// Transport-level contracts shared by the backend (which produces them) and the
// frontend (which parses them). These are not persisted entities — they are the
// wire shapes of the REST envelope and the health probe. Keeping them here is
// the single source of truth so the two sides cannot drift apart.

import { z } from 'zod';

import { money, uuid } from './common.js';

/**
 * The unified error envelope the backend returns for every non-2xx response
 * (see `backend/src/middleware/error.ts`).
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
 * (see `backend/src/routes/health.ts`).
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

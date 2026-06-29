// SPDX-License-Identifier: Apache-2.0
//
// `/api/stats` aggregation endpoints (§7.1, issue #13). These are read-only
// roll-ups that drive the dashboard (#23) and the statistics page (#28):
//   - `GET /year/:year`              calendar-year totals (costs, refunds, BRE)
//   - `GET /bre/:insuredPersonId`    an insured person's premium-refund ladder
//
// The aggregation runs as SQL `SUM`s in the database (not row-by-row in JS), and
// the BRE projection reuses the shared ladder helper (#17) — no duplication.

import {
  projectedBREForStreak,
  roundCents,
  type BREHistory,
  type BREHistoryYear,
  type YearStats,
} from '@selbstbehalt/shared';
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

import type { Database } from '../db/client.js';
import { brePeriods, insuredPersons, invoices, submissions } from '../db/schema.js';

/** Parse and bounds-check the `:year` path param, throwing 400 on bad input. */
function parseYear(raw: string): number {
  const year = Number(raw);
  if (!Number.isInteger(year) || year < 1900 || year > 2200) {
    throw new HTTPException(400, { message: `Ungültiges Jahr: '${raw}' (erwartet JJJJ)` });
  }
  return year;
}

export function createStatsRoute(db: Database) {
  return new Hono()
    .get('/year/:year', (c) => {
      const year = parseYear(c.req.param('year'));
      const yearStart = `${year}-01-01`;
      const yearEnd = `${year}-12-31`;

      // Invoices of the year, summed by invoice_date. COALESCE turns the empty
      // set (and NULL eligible_amount) into 0 instead of NULL.
      const invoiceAgg = db
        .select({
          count: sql<number>`count(*)`,
          total: sql<number>`coalesce(sum(${invoices.totalAmount}), 0)`,
          eligible: sql<number>`coalesce(sum(${invoices.eligibleAmount}), 0)`,
          selfPaid: sql<number>`coalesce(sum(${invoices.selfPaidAmount}), 0)`,
        })
        .from(invoices)
        .where(and(gte(invoices.invoiceDate, yearStart), lte(invoices.invoiceDate, yearEnd)))
        .get();

      // Refunds actually received in the year, by the submission's refund_date.
      const refundAgg = db
        .select({ refunds: sql<number>`coalesce(sum(${submissions.actualRefund}), 0)` })
        .from(submissions)
        .where(and(gte(submissions.refundDate, yearStart), lte(submissions.refundDate, yearEnd)))
        .get();

      // Premium refund booked in the year across all insured persons.
      const breAgg = db
        .select({ bre: sql<number>`coalesce(sum(${brePeriods.breAmount}), 0)` })
        .from(brePeriods)
        .where(eq(brePeriods.year, year))
        .get();

      const body: YearStats = {
        year,
        invoice_count: invoiceAgg?.count ?? 0,
        total_amount: roundCents(invoiceAgg?.total ?? 0),
        eligible_amount: roundCents(invoiceAgg?.eligible ?? 0),
        self_paid_amount: roundCents(invoiceAgg?.selfPaid ?? 0),
        refund_amount: roundCents(refundAgg?.refunds ?? 0),
        bre_amount: roundCents(breAgg?.bre ?? 0),
      };
      return c.json(body);
    })
    .get('/bre/:insuredPersonId', (c) => {
      const insuredPersonId = c.req.param('insuredPersonId');
      const insured = db
        .select()
        .from(insuredPersons)
        .where(eq(insuredPersons.id, insuredPersonId))
        .get();
      if (!insured) throw new HTTPException(404, { message: 'Versicherte Person nicht gefunden' });

      const rows = db
        .select()
        .from(brePeriods)
        .where(eq(brePeriods.insuredPersonId, insuredPersonId))
        .orderBy(asc(brePeriods.year))
        .all();

      const years: BREHistoryYear[] = rows.map((row) => ({
        year: row.year,
        streak_years: row.streakYears,
        bre_amount: roundCents(row.breAmount),
        // Project from the recorded streak via the shared helper (#17). Without a
        // bre_structure there is no ladder to project, so fall back to the stored
        // value (which is itself nullable).
        projected_bre: insured.breStructure
          ? projectedBREForStreak(insured.breStructure, insured.monthlyPremium, row.streakYears)
          : (row.projectedBre ?? null),
      }));

      const body: BREHistory = { insured_person_id: insuredPersonId, years };
      return c.json(body);
    });
}

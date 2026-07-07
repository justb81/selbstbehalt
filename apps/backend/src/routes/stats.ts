// SPDX-License-Identifier: Apache-2.0
//
// `/api/stats` aggregation endpoints (§7.1, issues #13 and #239). These are
// read-only roll-ups that drive the dashboard (#23) and the statistics page
// (#28):
//   - `GET /year/:year`                 calendar-year totals (costs, refunds, BRE)
//   - `GET /bre/:insuredPersonId`       an insured person's premium-refund ladder
//   - `GET /positions/:insuredPersonId` positions-by-Leistungsjahr roll-up (§5.2.1)
//   - `GET /reductions?group_by=...`    Kürzungs-/Ablehnungs-Roll-up (erstattet)
//   - `GET /validations`                Beanstandungen + Steigerungsfaktor-Verteilung
//
// The aggregation runs as SQL `SUM`s in the database (not row-by-row in JS), and
// the BRE projection reuses the shared ladder helper (#17) — no duplication.

import {
  projectedBREForStreak,
  reductionGroupBySchema,
  roundCents,
  type BREHistory,
  type BREHistoryYear,
  type MultiplierDistribution,
  type PositionYearRollup,
  type PositionYearRollupYear,
  type ReductionGroupBy,
  type ReductionRollup,
  type ReductionRollupGroup,
  type ValidationFlagCategory,
  type ValidationFlagRollupGroup,
  type ValidationRollup,
  type YearStats,
} from '@selbstbehalt/shared';
import { and, asc, eq, gte, isNotNull, lte, ne, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

import type { Database } from '../db/client.js';
import {
  brePeriods,
  insuredPersons,
  invoicePositions,
  invoices,
  submissions,
} from '../db/schema.js';

/**
 * Categorises a `flag_reason` string into a {@link ValidationFlagCategory} by
 * matching the fixed German phrase templates the GOÄ parser emits
 * (`packages/medic-invoice-check/.../utils/goae-parser.ts`). `flag_reason` is
 * never user-edited, so substring matching on these constant templates is
 * stable — see #239 / #238 for why this lives here rather than as a persisted
 * column.
 */
const FLAG_CATEGORY_CASE = sql<ValidationFlagCategory>`
  case
    when ${invoicePositions.flagReason} like '%Steigerungsfaktor%'
      or ${invoicePositions.flagReason} like '%festem Gebührensatz%' then 'steigerungsfaktor'
    when ${invoicePositions.flagReason} like '%nicht nebeneinander berechnungsfähig%' then 'ausschluss'
    when ${invoicePositions.flagReason} like '%nur zusammen mit%' then 'erfordert'
    when ${invoicePositions.flagReason} like '%Bestandteil der Leistung%' then 'bestandteil'
    when ${invoicePositions.flagReason} like '%Höchstwert%' then 'hoechstwert'
    when ${invoicePositions.flagReason} like '%ist höchstens%' then 'frequenz'
    when ${invoicePositions.flagReason} like '%Mindestdauer%' then 'dauer'
    when ${invoicePositions.flagReason} like '%Lebensjahr%'
      or ${invoicePositions.flagReason} like '%Alter von%' then 'alter'
    when ${invoicePositions.flagReason} like '%nicht bekannt%'
      or ${invoicePositions.flagReason} like '%Ziffer erkannt%' then 'unbekannte_ziffer'
    else 'sonstiges'
  end
`;

/** Leistungsjahr extracted from `treatment_date` (`YYYY-MM-DD` → `YYYY`). */
const TREATMENT_YEAR = sql<number>`cast(substr(${invoicePositions.treatmentDate}, 1, 4) as integer)`;

/** The column each `group_by` dimension of `GET /reductions` groups by. */
function reductionGroupColumn(groupBy: ReductionGroupBy) {
  switch (groupBy) {
    case 'tariff':
      return insuredPersons.tariffName;
    case 'provider_name':
      return invoices.providerName;
    case 'provider_type':
      return invoices.providerType;
    case 'goae_number':
      return invoicePositions.goaeNumber;
  }
}

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

      // Refunds actually received in the year: sum invoice_positions.refund_amount
      // for positions whose invoice has a submission with refund_date in this year.
      const refundAgg = db
        .select({
          refunds: sql<number>`coalesce(sum(${invoicePositions.refundAmount}), 0)`,
        })
        .from(invoicePositions)
        .innerJoin(submissions, eq(submissions.invoiceId, invoicePositions.invoiceId))
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
    })
    .get('/positions/:insuredPersonId', (c) => {
      const insuredPersonId = c.req.param('insuredPersonId');
      const insured = db
        .select({ id: insuredPersons.id })
        .from(insuredPersons)
        .where(eq(insuredPersons.id, insuredPersonId))
        .get();
      if (!insured) throw new HTTPException(404, { message: 'Versicherte Person nicht gefunden' });

      // §5.2.1 status rule: `erstattet` positions contribute `refund_amount`
      // (actual), `geprüft`/`bezahlt`/`eingereicht` contribute `eligible_amount`
      // (estimate), `neu` is excluded entirely — `charged_amount` sums the rest.
      const rows = db
        .select({
          year: TREATMENT_YEAR,
          charged: sql<number>`coalesce(sum(${invoicePositions.chargedAmount}), 0)`,
          eligible: sql<number>`coalesce(sum(case when ${invoices.status} in ('geprüft', 'bezahlt', 'eingereicht') then ${invoicePositions.eligibleAmount} else 0 end), 0)`,
          refund: sql<number>`coalesce(sum(case when ${invoices.status} = 'erstattet' then ${invoicePositions.refundAmount} else 0 end), 0)`,
        })
        .from(invoicePositions)
        .innerJoin(invoices, eq(invoices.id, invoicePositions.invoiceId))
        .where(and(eq(invoices.insuredPersonId, insuredPersonId), ne(invoices.status, 'neu')))
        .groupBy(TREATMENT_YEAR)
        .orderBy(asc(TREATMENT_YEAR))
        .all();

      const years: PositionYearRollupYear[] = rows.map((row) => ({
        year: row.year,
        charged_amount: roundCents(row.charged),
        eligible_amount: roundCents(row.eligible),
        refund_amount: roundCents(row.refund),
      }));

      const body: PositionYearRollup = { insured_person_id: insuredPersonId, years };
      return c.json(body);
    })
    .get('/reductions', (c) => {
      const parsed = reductionGroupBySchema.safeParse(c.req.query('group_by'));
      if (!parsed.success) {
        throw new HTTPException(400, {
          message: `Ungültige group_by-Dimension: '${c.req.query('group_by') ?? ''}' (erwartet tariff/provider_name/provider_type/goae_number)`,
        });
      }
      const groupBy = parsed.data;
      const groupColumn = reductionGroupColumn(groupBy);

      // Only `erstattet` positions have a meaningful eligible-vs-refund gap.
      // Positions with `refund_amount = null` are "not yet decided" and are
      // reported only via `open_count`, never folded into the € sums as 0.
      const rows = db
        .select({
          group: groupColumn,
          eligible: sql<number>`coalesce(sum(case when ${invoicePositions.refundAmount} is not null then coalesce(${invoicePositions.eligibleAmount}, 0) else 0 end), 0)`,
          refund: sql<number>`coalesce(sum(case when ${invoicePositions.refundAmount} is not null then ${invoicePositions.refundAmount} else 0 end), 0)`,
          reduction: sql<number>`coalesce(sum(case when ${invoicePositions.refundAmount} is not null then max(0, coalesce(${invoicePositions.eligibleAmount}, 0) - ${invoicePositions.refundAmount}) else 0 end), 0)`,
          rejectionCount: sql<number>`coalesce(sum(case when ${invoicePositions.refundAmount} = 0 and coalesce(${invoicePositions.eligibleAmount}, 0) > 0 then 1 else 0 end), 0)`,
          rejectionAmount: sql<number>`coalesce(sum(case when ${invoicePositions.refundAmount} = 0 and coalesce(${invoicePositions.eligibleAmount}, 0) > 0 then ${invoicePositions.eligibleAmount} else 0 end), 0)`,
          openCount: sql<number>`coalesce(sum(case when ${invoicePositions.refundAmount} is null then 1 else 0 end), 0)`,
        })
        .from(invoicePositions)
        .innerJoin(invoices, eq(invoices.id, invoicePositions.invoiceId))
        .innerJoin(insuredPersons, eq(insuredPersons.id, invoices.insuredPersonId))
        .where(eq(invoices.status, 'erstattet'))
        .groupBy(groupColumn)
        .all();

      const groups: ReductionRollupGroup[] = rows.map((row) => ({
        group: row.group,
        eligible_amount: roundCents(row.eligible),
        refund_amount: roundCents(row.refund),
        reduction_amount: roundCents(row.reduction),
        rejection_count: row.rejectionCount,
        rejection_amount: roundCents(row.rejectionAmount),
        open_count: row.openCount,
      }));

      const body: ReductionRollup = { group_by: groupBy, groups };
      return c.json(body);
    })
    .get('/validations', (c) => {
      const flagRows = db
        .select({
          category: FLAG_CATEGORY_CASE,
          count: sql<number>`count(*)`,
          charged: sql<number>`coalesce(sum(${invoicePositions.chargedAmount}), 0)`,
        })
        .from(invoicePositions)
        .where(eq(invoicePositions.isValid, false))
        .groupBy(FLAG_CATEGORY_CASE)
        .all();

      const flags: ValidationFlagRollupGroup[] = flagRows.map((row) => ({
        category: row.category,
        count: row.count,
        charged_amount: roundCents(row.charged),
      }));

      // Steigerungsfaktor distribution across all positions with a known
      // goae_category (independent of is_valid — it contextualises flagged
      // outliers against the whole category's spread).
      const multiplierRows = db
        .select({
          category: invoicePositions.goaeCategory,
          count: sql<number>`count(*)`,
          avg: sql<number>`avg(${invoicePositions.multiplier})`,
          min: sql<number>`min(${invoicePositions.multiplier})`,
          max: sql<number>`max(${invoicePositions.multiplier})`,
        })
        .from(invoicePositions)
        .where(isNotNull(invoicePositions.goaeCategory))
        .groupBy(invoicePositions.goaeCategory)
        .all();

      const multiplier_distribution: MultiplierDistribution[] = multiplierRows.flatMap((row) =>
        row.category == null
          ? []
          : [
              {
                goae_category: row.category,
                count: row.count,
                avg_multiplier: Math.round(row.avg * 100) / 100,
                min_multiplier: row.min,
                max_multiplier: row.max,
              },
            ],
      );

      const body: ValidationRollup = { flags, multiplier_distribution };
      return c.json(body);
    });
}

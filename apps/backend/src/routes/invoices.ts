// SPDX-License-Identifier: Apache-2.0
//
// `/api/invoices` CRUD plus the lifecycle endpoints (§7.1, issue #12/#139/#142).
//
// The lifecycle is modelled as three INDEPENDENT tracks whose current value is
// derived from the append-only `invoice_status_events` log (latest event per track,
// see `deriveInvoiceStatus` / the `invoice_current_status` view):
//   review:      neu ↔ geprüft            (Anlage/Prüfung gate)
//   payment:     offen ↔ bezahlt          (Bezahlung an den Arzt)
//   submission:  nicht_eingereicht → eingereicht → erstattet
//
// Payment and submission run in parallel — the insurer's refund often arrives before
// the doctor is paid — and both may only leave their ground state once review = geprüft.
// An invoice is locked for editing once it is paid or submitted. `eligible_amount` and
// `self_paid_amount` are server-computed from positions on every write.
//
// Stepping back (issue #230): reverting a payment is POST /:id/payment {status:'offen'};
// POST /:id/submission/revert steps the submission track back one level, discarding the
// data that step captured. PUT /:id/submission and PUT /:id/refund correct that data in
// place without a track change.

import {
  deriveInvoiceStatus,
  invoiceCreatePayloadSchema,
  invoicePaymentChangeSchema,
  invoiceRefundPayloadSchema,
  invoiceReviewChangeSchema,
  invoiceRevertSchema,
  invoiceUpdatePayloadSchema,
  isoDate,
  paymentStatusValues,
  reviewStatusValues,
  submissionInputSchema,
  submissionStatusValues,
  submissionUpdateSchema,
  uuid,
  type InvoiceStatus,
  type InvoiceStatusEvent,
  type InvoiceWithPositions,
} from '@selbstbehalt/shared';
import { and, desc, eq, gte, lte, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import type { Database } from '../db/client.js';
import {
  insuredPersons,
  invoiceCurrentStatus,
  invoicePositions,
  invoiceStatusEvents,
  invoices,
  submissions,
} from '../db/schema.js';
import { assertFkExists, requireRow, updateOrReturn } from '../lib/db-helpers.js';
import {
  serializeInvoice,
  serializePosition,
  serializeStatusEvent,
  serializeSubmission,
  toInvoiceInsert,
  toInvoiceUpdate,
  toPositionInsert,
  toStatusEventInsert,
  toSubmissionInsert,
  toSubmissionUpdate,
} from '../lib/serialize.js';
import { parseJsonBody, parseQuery } from '../lib/validation.js';

const listQuerySchema = z.object({
  insured_person_id: uuid.optional(),
  review: z.enum(reviewStatusValues).optional(),
  payment: z.enum(paymentStatusValues).optional(),
  submission: z.enum(submissionStatusValues).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  q: z.string().min(1).optional(),
});

function findInvoice(db: Database, id: string) {
  return db.select().from(invoices).where(eq(invoices.id, id)).get();
}

/** The most recent submission of an invoice, or undefined if it was never submitted. */
function findLatestSubmission(db: Database, invoiceId: string) {
  return db
    .select()
    .from(submissions)
    .where(eq(submissions.invoiceId, invoiceId))
    .orderBy(desc(submissions.submittedAt))
    .limit(1)
    .get();
}

/**
 * Derives the current per-track lifecycle state of one invoice from its event log.
 * Events are ordered oldest-first so the derivation's tie-break (later wins) matches
 * the `invoice_current_status` view's `ORDER BY changed_at DESC, id DESC`.
 */
function deriveStatus(db: Database, invoiceId: string): InvoiceStatus {
  // Order by rowid (insertion / append order), matching the invoice_current_status
  // view. This is the authoritative order of transitions — a payment event's
  // changed_at carries the user-supplied Zahlungsdatum, so it cannot order the log.
  // deriveInvoiceStatus takes the last event per track, so feed them oldest-first.
  const rows = db
    .select()
    .from(invoiceStatusEvents)
    .where(eq(invoiceStatusEvents.invoiceId, invoiceId))
    .orderBy(sql`${invoiceStatusEvents}.rowid ASC`)
    .all();
  return deriveInvoiceStatus(rows.map(serializeStatusEvent));
}

/** Append an immutable status event for a track transition. */
function appendEvent(
  db: Database,
  invoiceId: string,
  track: InvoiceStatusEvent['track'],
  status: InvoiceStatusEvent['status'],
  note?: string | null,
  changedAt?: string,
): void {
  db.insert(invoiceStatusEvents)
    .values(toStatusEventInsert(invoiceId, track, status, note, changedAt))
    .run();
}

/**
 * Case-sensitive substring match that treats the search term literally: the LIKE
 * wildcards `%` and `_` (and the escape `\`) are escaped so a query like `%` or
 * `_` matches those characters instead of "anything". `ESCAPE '\'` activates the
 * escaping in SQLite.
 */
function likeContains(column: AnyColumn, term: string): SQL {
  const escaped = term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  return sql`${column} LIKE ${`%${escaped}%`} ESCAPE '\\'`;
}

/** Assemble the detail response: the invoice joined with its line items. */
function invoiceWithPositions(db: Database, id: string): InvoiceWithPositions {
  const invoice = requireRow(() => findInvoice(db, id), 'Rechnung nicht gefunden');
  const positions = db
    .select()
    .from(invoicePositions)
    .where(eq(invoicePositions.invoiceId, id))
    .all();
  return {
    ...serializeInvoice(invoice, deriveStatus(db, id)),
    positions: positions.map(serializePosition),
  };
}

/**
 * Recompute and persist the derived invoice aggregates after any position change:
 *   eligible_amount = Σ positions.eligible_amount
 *   self_paid_amount = Σ charged_amount − Σ coalesce(refund_amount, 0)
 * Must be called inside the same transaction that modified positions.
 */
function recalcInvoiceSums(db: Database, invoiceId: string): void {
  db.run(sql`
    UPDATE ${invoices}
    SET
      eligible_amount = (
        SELECT SUM(eligible_amount) FROM ${invoicePositions}
        WHERE invoice_id = ${invoiceId}
      ),
      self_paid_amount = (
        SELECT COALESCE(SUM(charged_amount - COALESCE(refund_amount, 0)), 0)
        FROM ${invoicePositions}
        WHERE invoice_id = ${invoiceId}
      )
    WHERE id = ${invoiceId}
  `);
}

export function createInvoicesRoute(db: Database) {
  return new Hono()
    .get('/', (c) => {
      const f = parseQuery(c, listQuerySchema);
      const conditions: (SQL | undefined)[] = [
        f.insured_person_id ? eq(invoices.insuredPersonId, f.insured_person_id) : undefined,
        f.review ? eq(invoiceCurrentStatus.review, f.review) : undefined,
        f.payment ? eq(invoiceCurrentStatus.payment, f.payment) : undefined,
        f.submission ? eq(invoiceCurrentStatus.submission, f.submission) : undefined,
        f.from ? gte(invoices.invoiceDate, f.from) : undefined,
        f.to ? lte(invoices.invoiceDate, f.to) : undefined,
        f.q
          ? or(likeContains(invoices.providerName, f.q), likeContains(invoices.invoiceNumber, f.q))
          : undefined,
      ];
      const rows = db
        .select({
          inv: invoices,
          review: invoiceCurrentStatus.review,
          payment: invoiceCurrentStatus.payment,
          submission: invoiceCurrentStatus.submission,
          paidOn: invoiceCurrentStatus.paidOn,
        })
        .from(invoices)
        .innerJoin(invoiceCurrentStatus, eq(invoiceCurrentStatus.invoiceId, invoices.id))
        .where(and(...conditions))
        .all();
      return c.json(
        rows.map((r) =>
          serializeInvoice(r.inv, {
            review: r.review,
            payment: r.payment,
            submission: r.submission,
            paid_on: r.paidOn ?? null,
          }),
        ),
      );
    })
    .post('/', async (c) => {
      const input = await parseJsonBody(c, invoiceCreatePayloadSchema);
      assertFkExists(
        db,
        insuredPersons,
        input.insured_person_id,
        `Versicherte Person ${input.insured_person_id} existiert nicht`,
      );
      const { positions, ...invoiceInput } = input;

      // Invoice + its positions are written in one transaction so a partial
      // insert can never leave an invoice without its lines. After inserting,
      // recalculate the derived eligible_amount / self_paid_amount.
      const { invoice, insertedPositions } = db.transaction((tx) => {
        const invoice = tx.insert(invoices).values(toInvoiceInsert(invoiceInput)).returning().get();
        const insertedPositions =
          positions && positions.length > 0
            ? tx
                .insert(invoicePositions)
                .values(positions.map((p) => toPositionInsert(invoice.id, p)))
                .returning()
                .all()
            : [];
        if (insertedPositions.length > 0) {
          recalcInvoiceSums(tx as unknown as Database, invoice.id);
        }
        return { invoice: findInvoice(tx as unknown as Database, invoice.id)!, insertedPositions };
      });

      // Record the initial review event so the Statusverlauf reflects creation
      // (the ground state derives correctly with or without it).
      appendEvent(db, invoice.id, 'review', 'neu');

      const body: InvoiceWithPositions = {
        ...serializeInvoice(invoice, deriveStatus(db, invoice.id)),
        positions: insertedPositions.map(serializePosition),
      };
      return c.json(body, 201);
    })
    .get('/:id/events', (c) => {
      const id = c.req.param('id');
      requireRow(() => findInvoice(db, id), 'Rechnung nicht gefunden');
      const rows = db
        .select()
        .from(invoiceStatusEvents)
        .where(eq(invoiceStatusEvents.invoiceId, id))
        .orderBy(desc(invoiceStatusEvents.changedAt))
        .all();
      return c.json(rows.map(serializeStatusEvent));
    })
    .get('/:id', (c) => c.json(invoiceWithPositions(db, c.req.param('id'))))
    .put('/:id', async (c) => {
      const id = c.req.param('id');
      requireRow(() => findInvoice(db, id), 'Rechnung nicht gefunden');

      // Editier-Sperre: once paid or submitted, the invoice is immutable.
      const status = deriveStatus(db, id);
      if (status.payment === 'bezahlt' || status.submission !== 'nicht_eingereicht') {
        throw new HTTPException(422, {
          message: 'Bezahlte oder eingereichte Rechnungen können nicht mehr bearbeitet werden',
        });
      }

      const input = await parseJsonBody(c, invoiceUpdatePayloadSchema);
      if (input.insured_person_id !== undefined)
        assertFkExists(
          db,
          insuredPersons,
          input.insured_person_id,
          `Versicherte Person ${input.insured_person_id} existiert nicht`,
        );

      const { positions, ...invoiceInput } = input;
      const changes = toInvoiceUpdate(invoiceInput);

      if (positions !== undefined) {
        db.transaction((tx) => {
          if (Object.keys(changes).length > 0) {
            tx.update(invoices).set(changes).where(eq(invoices.id, id)).run();
          }
          tx.delete(invoicePositions).where(eq(invoicePositions.invoiceId, id)).run();
          if (positions.length > 0) {
            tx.insert(invoicePositions)
              .values(positions.map((p) => toPositionInsert(id, p)))
              .run();
          }
          recalcInvoiceSums(tx as unknown as Database, id);
        });
      } else if (Object.keys(changes).length > 0) {
        db.update(invoices).set(changes).where(eq(invoices.id, id)).run();
      }
      return c.json(invoiceWithPositions(db, id));
    })
    .delete('/:id', (c) => {
      // Cascades to positions, status events, and the submission (FK ON DELETE CASCADE).
      const deleted = db
        .delete(invoices)
        .where(eq(invoices.id, c.req.param('id')))
        .returning()
        .get();
      if (!deleted) throw new HTTPException(404, { message: 'Rechnung nicht gefunden' });
      return c.body(null, 204);
    })
    .post('/:id/review', async (c) => {
      const id = c.req.param('id');
      const invoice = requireRow(() => findInvoice(db, id), 'Rechnung nicht gefunden');
      const input = await parseJsonBody(c, invoiceReviewChangeSchema);
      const status = deriveStatus(db, id);
      if (status.review === input.status) {
        throw new HTTPException(409, {
          message: `Prüfstatus ist bereits '${input.status}'`,
        });
      }
      if (
        input.status === 'neu' &&
        (status.payment !== 'offen' || status.submission !== 'nicht_eingereicht')
      ) {
        throw new HTTPException(409, {
          message:
            'Die Prüfung kann nicht zurückgenommen werden, solange Zahlung oder Einreichung erfasst ist',
        });
      }
      appendEvent(db, id, 'review', input.status, input.note);
      return c.json(serializeInvoice(invoice, deriveStatus(db, id)));
    })
    .post('/:id/payment', async (c) => {
      const id = c.req.param('id');
      const invoice = requireRow(() => findInvoice(db, id), 'Rechnung nicht gefunden');
      const input = await parseJsonBody(c, invoicePaymentChangeSchema);
      const status = deriveStatus(db, id);
      if (status.payment === input.status) {
        throw new HTTPException(409, { message: `Zahlungsstatus ist bereits '${input.status}'` });
      }
      if (input.status === 'bezahlt' && status.review !== 'geprüft') {
        throw new HTTPException(409, {
          message: "Die Rechnung muss vor der Zahlung geprüft sein (Status 'geprüft')",
        });
      }
      // The payment event's changed_at carries the Zahlungsdatum (paid_on): store it
      // at day granularity so the derived paid_on round-trips exactly (else: now).
      const changedAt =
        input.status === 'bezahlt'
          ? `${input.paid_on ?? new Date().toISOString().slice(0, 10)}T00:00:00.000Z`
          : undefined;
      appendEvent(db, id, 'payment', input.status, input.note, changedAt);
      return c.json(serializeInvoice(invoice, deriveStatus(db, id)));
    })
    .post('/:id/submit', async (c) => {
      const id = c.req.param('id');
      requireRow(() => findInvoice(db, id), 'Rechnung nicht gefunden');
      const status = deriveStatus(db, id);
      if (status.review !== 'geprüft') {
        throw new HTTPException(409, {
          message: "Die Rechnung muss vor der Einreichung geprüft sein (Status 'geprüft')",
        });
      }
      if (status.submission !== 'nicht_eingereicht') {
        throw new HTTPException(409, {
          message: `Rechnung ist bereits '${status.submission}' und kann nicht erneut eingereicht werden`,
        });
      }

      const input = await parseJsonBody(c, submissionInputSchema);
      const submission = db.transaction((tx) => {
        const row = tx
          .insert(submissions)
          .values({
            ...toSubmissionInsert(id, input),
            submittedAt: input.submitted_at ?? new Date().toISOString(),
          })
          .returning()
          .get();
        appendEvent(tx as unknown as Database, id, 'submission', 'eingereicht');
        return row;
      });

      return c.json(serializeSubmission(submission), 201);
    })
    .get('/:id/submission', (c) => {
      const id = c.req.param('id');
      requireRow(() => findInvoice(db, id), 'Rechnung nicht gefunden');
      const submission = requireRow(
        () => findLatestSubmission(db, id),
        'Für diese Rechnung liegt keine Einreichung vor',
      );
      return c.json(serializeSubmission(submission));
    })
    .put('/:id/submission', async (c) => {
      // Corrects the submission captured by /submit in place (issue #230
      // "Bearbeiten") — the submission track stays 'eingereicht', no new event.
      const id = c.req.param('id');
      requireRow(() => findInvoice(db, id), 'Rechnung nicht gefunden');
      const status = deriveStatus(db, id);
      if (status.submission !== 'eingereicht') {
        throw new HTTPException(409, {
          message: `Einreichung kann nur im Status 'eingereicht' bearbeitet werden (Status: '${status.submission}')`,
        });
      }
      const submission = requireRow(
        () => findLatestSubmission(db, id),
        'Für diese Rechnung liegt keine Einreichung vor',
      );

      const input = await parseJsonBody(c, submissionUpdateSchema);
      const changes = toSubmissionUpdate(input);
      const updated = updateOrReturn(
        changes,
        () =>
          db
            .update(submissions)
            .set(changes)
            .where(eq(submissions.id, submission.id))
            .returning()
            .get()!,
        submission,
      );
      return c.json(serializeSubmission(updated));
    })
    .put('/:id/refund', async (c) => {
      const id = c.req.param('id');
      requireRow(() => findInvoice(db, id), 'Rechnung nicht gefunden');
      const status = deriveStatus(db, id);
      // From 'eingereicht' this captures the refund for the first time and advances
      // the submission track to 'erstattet'; from 'erstattet' it corrects the
      // already-recorded amounts in place (issue #230 "Bearbeiten").
      const isFirstCapture = status.submission === 'eingereicht';
      if (!isFirstCapture && status.submission !== 'erstattet') {
        throw new HTTPException(409, {
          message: `Erstattung nur für eingereichte oder bereits erstattete Rechnungen möglich (Status: '${status.submission}')`,
        });
      }

      const input = await parseJsonBody(c, invoiceRefundPayloadSchema);

      db.transaction((tx) => {
        // Update refund_amount per position.
        for (const p of input.positions) {
          tx.update(invoicePositions)
            .set({ refundAmount: p.refund_amount })
            .where(and(eq(invoicePositions.id, p.id), eq(invoicePositions.invoiceId, id)))
            .run();
        }
        // Update submission refund_date if provided.
        if (input.refund_date) {
          const latest = findLatestSubmission(tx as unknown as Database, id);
          if (latest) {
            tx.update(submissions)
              .set({ refundDate: input.refund_date })
              .where(eq(submissions.id, latest.id))
              .run();
          }
        }
        recalcInvoiceSums(tx as unknown as Database, id);
        if (isFirstCapture) {
          appendEvent(tx as unknown as Database, id, 'submission', 'erstattet', input.note);
        }
      });

      return c.json(invoiceWithPositions(db, id));
    })
    .post('/:id/submission/revert', async (c) => {
      // Steps the submission track back one level (issue #230 "Löschen"),
      // discarding the data that step captured.
      const id = c.req.param('id');
      requireRow(() => findInvoice(db, id), 'Rechnung nicht gefunden');
      const status = deriveStatus(db, id);
      if (status.submission === 'nicht_eingereicht') {
        throw new HTTPException(409, {
          message: 'Für diese Rechnung liegt keine Einreichung vor, die zurückgenommen werden kann',
        });
      }
      const input = await parseJsonBody(c, invoiceRevertSchema);

      db.transaction((tx) => {
        if (status.submission === 'erstattet') {
          // Discard the refund captured by eingereicht → erstattet.
          tx.update(invoicePositions)
            .set({ refundAmount: null })
            .where(eq(invoicePositions.invoiceId, id))
            .run();
          tx.update(submissions)
            .set({ refundDate: null })
            .where(eq(submissions.invoiceId, id))
            .run();
          recalcInvoiceSums(tx as unknown as Database, id);
          appendEvent(tx as unknown as Database, id, 'submission', 'eingereicht', input.note);
        } else {
          // eingereicht → nicht_eingereicht: discard the submission row entirely.
          tx.delete(submissions).where(eq(submissions.invoiceId, id)).run();
          appendEvent(tx as unknown as Database, id, 'submission', 'nicht_eingereicht', input.note);
        }
      });

      return c.json(invoiceWithPositions(db, id));
    });
}

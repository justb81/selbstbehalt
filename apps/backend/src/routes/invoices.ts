// SPDX-License-Identifier: Apache-2.0
//
// `/api/invoices` CRUD plus the lifecycle endpoints (§7.1, issue #12).
//
// Status workflow (Issue #139):
//   neu ↔ geprüft → bezahlt → eingereicht → erstattet
//
// Every status transition is written to `invoice_status_events`.
// Invoices in status bezahlt/eingereicht/erstattet are locked for editing.
// `eligible_amount` and `self_paid_amount` on invoices are server-computed
// from positions on every write; clients must not set them directly.

import {
  invoiceCreatePayloadSchema,
  invoiceRefundPayloadSchema,
  invoiceStatusChangeSchema,
  invoiceStatusValues,
  invoiceUpdatePayloadSchema,
  submissionInputSchema,
  uuid,
  type InvoiceStatus,
  type InvoiceWithPositions,
} from '@selbstbehalt/shared';
import { and, desc, eq, gte, lte, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import type { Database } from '../db/client.js';
import {
  insuredPersons,
  invoicePositions,
  invoiceStatusEvents,
  invoices,
  submissions,
} from '../db/schema.js';
import { assertFkExists, requireRow } from '../lib/db-helpers.js';
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
} from '../lib/serialize.js';
import { parseJsonBody, parseQuery } from '../lib/validation.js';

/** Statuses from which an invoice may be formally submitted to the insurer. */
const SUBMITTABLE_FROM: InvoiceStatus[] = ['bezahlt'];

/** Statuses from which an invoice may no longer be edited. */
const LOCKED_STATUSES: InvoiceStatus[] = ['bezahlt', 'eingereicht', 'erstattet'];

/** Allowed status transitions (source → valid next statuses). */
const ALLOWED_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  neu: ['geprüft'],
  geprüft: ['neu', 'bezahlt'],
  bezahlt: ['eingereicht'],
  eingereicht: ['erstattet'],
  erstattet: [],
};

const isoDateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum muss JJJJ-MM-TT sein');

const listQuerySchema = z.object({
  insured_person_id: uuid.optional(),
  status: z.enum(invoiceStatusValues).optional(),
  from: isoDateOnly.optional(),
  to: isoDateOnly.optional(),
  q: z.string().min(1).optional(),
});

function findInvoice(db: Database, id: string) {
  return db.select().from(invoices).where(eq(invoices.id, id)).get();
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
  return { ...serializeInvoice(invoice), positions: positions.map(serializePosition) };
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

/** Validate and record a status transition; throws 409 on invalid transition. */
function applyStatusTransition(
  db: Database,
  invoice: ReturnType<typeof findInvoice> & object,
  newStatus: InvoiceStatus,
  note?: string | null,
): void {
  const allowed = ALLOWED_TRANSITIONS[invoice.status as InvoiceStatus] ?? [];
  if (!allowed.includes(newStatus)) {
    throw new HTTPException(409, {
      message: `Statuswechsel von '${invoice.status}' nach '${newStatus}' ist nicht erlaubt`,
    });
  }
  db.update(invoices).set({ status: newStatus }).where(eq(invoices.id, invoice.id)).run();
  db.insert(invoiceStatusEvents)
    .values(toStatusEventInsert(invoice.id, newStatus, note))
    .run();
}

export function createInvoicesRoute(db: Database) {
  return new Hono()
    .get('/', (c) => {
      const f = parseQuery(c, listQuerySchema);
      const conditions: (SQL | undefined)[] = [
        f.insured_person_id ? eq(invoices.insuredPersonId, f.insured_person_id) : undefined,
        f.status ? eq(invoices.status, f.status) : undefined,
        f.from ? gte(invoices.invoiceDate, f.from) : undefined,
        f.to ? lte(invoices.invoiceDate, f.to) : undefined,
        f.q
          ? or(likeContains(invoices.providerName, f.q), likeContains(invoices.invoiceNumber, f.q))
          : undefined,
      ];
      const rows = db
        .select()
        .from(invoices)
        .where(and(...conditions))
        .all();
      return c.json(rows.map(serializeInvoice));
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

      // Insert the initial status event outside the transaction (idempotent).
      db.insert(invoiceStatusEvents)
        .values(toStatusEventInsert(invoice.id, invoice.status as InvoiceStatus))
        .run();

      const body: InvoiceWithPositions = {
        ...serializeInvoice(invoice),
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
      const existing = requireRow(() => findInvoice(db, id), 'Rechnung nicht gefunden');

      // Editier-Sperre: bezahlt/eingereicht/erstattet are immutable.
      if (LOCKED_STATUSES.includes(existing.status as InvoiceStatus)) {
        throw new HTTPException(422, {
          message: `Rechnung im Status '${existing.status}' kann nicht mehr bearbeitet werden`,
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
    .post('/:id/status', async (c) => {
      const id = c.req.param('id');
      const invoice = requireRow(() => findInvoice(db, id), 'Rechnung nicht gefunden');
      const input = await parseJsonBody(c, invoiceStatusChangeSchema);
      applyStatusTransition(db, invoice, input.status, input.note);
      return c.json(
        serializeInvoice(requireRow(() => findInvoice(db, id), 'Rechnung nicht gefunden')),
      );
    })
    .post('/:id/submit', async (c) => {
      const id = c.req.param('id');
      const invoice = requireRow(() => findInvoice(db, id), 'Rechnung nicht gefunden');
      if (!SUBMITTABLE_FROM.includes(invoice.status as InvoiceStatus)) {
        throw new HTTPException(409, {
          message: `Rechnung im Status '${invoice.status}' kann nicht eingereicht werden (erwartet: bezahlt)`,
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
        tx.update(invoices).set({ status: 'eingereicht' }).where(eq(invoices.id, id)).run();
        tx.insert(invoiceStatusEvents).values(toStatusEventInsert(id, 'eingereicht')).run();
        return row;
      });

      return c.json(serializeSubmission(submission), 201);
    })
    .put('/:id/refund', async (c) => {
      const id = c.req.param('id');
      const invoice = requireRow(() => findInvoice(db, id), 'Rechnung nicht gefunden');
      if (invoice.status !== 'eingereicht') {
        throw new HTTPException(409, {
          message: `Erstattung nur für eingereichte Rechnungen möglich (Status: '${invoice.status}')`,
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
          const latest = tx
            .select()
            .from(submissions)
            .where(eq(submissions.invoiceId, id))
            .orderBy(desc(submissions.submittedAt))
            .limit(1)
            .get();
          if (latest) {
            tx.update(submissions)
              .set({ refundDate: input.refund_date })
              .where(eq(submissions.id, latest.id))
              .run();
          }
        }
        recalcInvoiceSums(tx as unknown as Database, id);
        tx.update(invoices).set({ status: 'erstattet' }).where(eq(invoices.id, id)).run();
        tx.insert(invoiceStatusEvents)
          .values(toStatusEventInsert(id, 'erstattet', input.note))
          .run();
      });

      return c.json(invoiceWithPositions(db, id));
    });
}

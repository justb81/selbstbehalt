// SPDX-License-Identifier: Apache-2.0
//
// `/api/invoices` CRUD plus the lifecycle endpoints (§7.1, issue #12). An
// invoice and its GOÄ positions are stored atomically; submit/refund drive the
// status machine and the `submissions` record. Only structured metadata is ever
// persisted here — invoice images stay on the client (Privacy by Design, §1.3).

import {
  invoiceCreatePayloadSchema,
  invoiceStatusValues,
  invoiceUpdateSchema,
  submissionInputSchema,
  submissionUpdateSchema,
  uuid,
  type InvoiceStatus,
  type InvoiceWithPositions,
} from '@selbstbehalt/shared';
import { and, desc, eq, gte, lte, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import type { Database } from '../db/client.js';
import { insuredPersons, invoicePositions, invoices, submissions } from '../db/schema.js';
import {
  serializeInvoice,
  serializePosition,
  serializeSubmission,
  toInvoiceInsert,
  toInvoiceUpdate,
  toPositionInsert,
  toSubmissionInsert,
  toSubmissionUpdate,
} from '../lib/serialize.js';
import { parseJsonBody, parseQuery } from '../lib/validation.js';

/** Statuses from which an invoice may be submitted to the insurer. */
const SUBMITTABLE_FROM: InvoiceStatus[] = ['neu', 'geprüft'];

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
  const invoice = findInvoice(db, id);
  if (!invoice) throw new HTTPException(404, { message: 'Rechnung nicht gefunden' });
  const positions = db
    .select()
    .from(invoicePositions)
    .where(eq(invoicePositions.invoiceId, id))
    .all();
  return { ...serializeInvoice(invoice), positions: positions.map(serializePosition) };
}

function assertInsuredPersonExists(db: Database, insuredPersonId: string): void {
  const row = db
    .select({ id: insuredPersons.id })
    .from(insuredPersons)
    .where(eq(insuredPersons.id, insuredPersonId))
    .get();
  if (!row) {
    throw new HTTPException(400, {
      message: `Versicherte Person ${insuredPersonId} existiert nicht`,
    });
  }
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
      assertInsuredPersonExists(db, input.insured_person_id);
      const { positions, ...invoiceInput } = input;

      // Invoice + its positions are written in one transaction so a partial
      // insert can never leave an invoice without its lines (acceptance: atomic).
      const created = db.transaction((tx) => {
        const invoice = tx.insert(invoices).values(toInvoiceInsert(invoiceInput)).returning().get();
        if (positions && positions.length > 0) {
          tx.insert(invoicePositions)
            .values(positions.map((p) => toPositionInsert(invoice.id, p)))
            .run();
        }
        return invoice;
      });

      return c.json(invoiceWithPositions(db, created.id), 201);
    })
    .get('/:id', (c) => c.json(invoiceWithPositions(db, c.req.param('id'))))
    .put('/:id', async (c) => {
      const id = c.req.param('id');
      if (!findInvoice(db, id))
        throw new HTTPException(404, { message: 'Rechnung nicht gefunden' });
      const input = await parseJsonBody(c, invoiceUpdateSchema);
      if (input.insured_person_id !== undefined)
        assertInsuredPersonExists(db, input.insured_person_id);

      const changes = toInvoiceUpdate(input);
      if (Object.keys(changes).length > 0) {
        db.update(invoices).set(changes).where(eq(invoices.id, id)).run();
      }
      return c.json(invoiceWithPositions(db, id));
    })
    .delete('/:id', (c) => {
      // Cascades to positions and the submission (FK ON DELETE CASCADE, §3.2).
      const deleted = db
        .delete(invoices)
        .where(eq(invoices.id, c.req.param('id')))
        .returning()
        .get();
      if (!deleted) throw new HTTPException(404, { message: 'Rechnung nicht gefunden' });
      return c.body(null, 204);
    })
    .post('/:id/submit', async (c) => {
      const id = c.req.param('id');
      const invoice = findInvoice(db, id);
      if (!invoice) throw new HTTPException(404, { message: 'Rechnung nicht gefunden' });
      if (!SUBMITTABLE_FROM.includes(invoice.status)) {
        throw new HTTPException(409, {
          message: `Rechnung im Status '${invoice.status}' kann nicht eingereicht werden`,
        });
      }

      const input = await parseJsonBody(c, submissionInputSchema);
      const submission = db.transaction((tx) => {
        const row = tx
          .insert(submissions)
          .values({
            ...toSubmissionInsert(id, input),
            // Default the submission timestamp to "now" when the client omits it.
            submittedAt: input.submitted_at ?? new Date().toISOString(),
          })
          .returning()
          .get();
        tx.update(invoices).set({ status: 'eingereicht' }).where(eq(invoices.id, id)).run();
        return row;
      });

      return c.json(serializeSubmission(submission), 201);
    })
    .put('/:id/refund', async (c) => {
      const id = c.req.param('id');
      const invoice = findInvoice(db, id);
      if (!invoice) throw new HTTPException(404, { message: 'Rechnung nicht gefunden' });
      if (invoice.status !== 'eingereicht') {
        throw new HTTPException(409, {
          message: `Erstattung nur für eingereichte Rechnungen möglich (Status: '${invoice.status}')`,
        });
      }

      // An invoice may accumulate several submissions (e.g. after a resubmission);
      // the refund applies to the most recent one. Order explicitly — SQLite row
      // order without ORDER BY is undefined.
      const submission = db
        .select()
        .from(submissions)
        .where(eq(submissions.invoiceId, id))
        .orderBy(desc(submissions.submittedAt))
        .limit(1)
        .get();
      if (!submission) {
        throw new HTTPException(409, { message: 'Keine Einreichung zu dieser Rechnung vorhanden' });
      }

      const input = await parseJsonBody(c, submissionUpdateSchema);
      // A non-empty rejection reason marks the claim rejected; otherwise refunded.
      const rejected =
        typeof input.rejection_reason === 'string' && input.rejection_reason.trim() !== '';
      const newStatus: InvoiceStatus = rejected ? 'abgelehnt' : 'erstattet';

      const updated = db.transaction((tx) => {
        const changes = toSubmissionUpdate(input);
        const row =
          Object.keys(changes).length > 0
            ? tx
                .update(submissions)
                .set(changes)
                .where(eq(submissions.id, submission.id))
                .returning()
                .get()
            : submission;
        tx.update(invoices).set({ status: newStatus }).where(eq(invoices.id, id)).run();
        return row;
      });

      return c.json(serializeSubmission(updated));
    });
}

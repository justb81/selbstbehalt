// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

import { isoDateTime, uuid } from '../common.js';
import { invoiceStatusEventValueSchema, statusTrackSchema } from '../enums.js';

/**
 * A single status-change event on an invoice (`invoice_status_events`) — the append-only
 * source of truth for the lifecycle. Every track transition (review, payment, submit,
 * refund, or a revert back to a ground state) produces an immutable event row; the
 * invoice's current per-track state is derived from these (§3.2, `deriveInvoiceStatus`).
 */
export const invoiceStatusEventSchema = z
  .object({
    id: uuid,
    invoice_id: uuid,
    track: statusTrackSchema,
    status: invoiceStatusEventValueSchema,
    changed_at: isoDateTime,
    note: z.string().nullish(),
  })
  .strict();

export type InvoiceStatusEvent = z.infer<typeof invoiceStatusEventSchema>;

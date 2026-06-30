// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

import { isoDateTime, uuid } from '../common.js';
import { invoiceStatusSchema } from '../enums.js';

/**
 * A single status-change event on an invoice (`invoice_status_events`).
 * Every transition of `invoices.status` — whether via the generic status endpoint,
 * submit, or refund — produces an immutable event row for the audit trail (§3.2).
 */
export const invoiceStatusEventSchema = z
  .object({
    id: uuid,
    invoice_id: uuid,
    status: invoiceStatusSchema,
    changed_at: isoDateTime,
    note: z.string().nullish(),
  })
  .strict();

export type InvoiceStatusEvent = z.infer<typeof invoiceStatusEventSchema>;

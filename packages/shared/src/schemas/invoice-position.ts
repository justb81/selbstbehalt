// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

import { money, uuid } from '../common.js';
import { goaeCategorySchema } from '../enums.js';

/**
 * A single billed line of an invoice (§3.2 `invoice_positions`). Note this
 * table carries no `created_at` — its only server-assigned field is `id`.
 */
export const invoicePositionCreateSchema = z.object({
  invoice_id: uuid,
  goae_number: z.string().min(1, 'GOÄ-Ziffer darf nicht leer sein'),
  goae_category: goaeCategorySchema.nullish(),
  description: z.string().nullish(),
  multiplier: z
    .number({ invalid_type_error: 'Steigerungsfaktor muss eine Zahl sein' })
    .finite()
    .positive('Steigerungsfaktor muss größer als 0 sein'),
  base_amount: money,
  charged_amount: money,
  is_valid: z.boolean().nullish(),
  flag_reason: z.string().nullish(),
});

export const invoicePositionSchema = invoicePositionCreateSchema.extend({ id: uuid });

export const invoicePositionUpdateSchema = invoicePositionCreateSchema.partial();

export type InvoicePositionCreate = z.infer<typeof invoicePositionCreateSchema>;
export type InvoicePosition = z.infer<typeof invoicePositionSchema>;
export type InvoicePositionUpdate = z.infer<typeof invoicePositionUpdateSchema>;

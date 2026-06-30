// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

import { isoDate, isoDateTime, money, uuid } from '../common.js';
import { submissionChannelSchema } from '../enums.js';

/**
 * Client-supplied fields of a submission (§3.2 `submissions`). `invoice_id` is
 * intentionally absent: the submission is always created under the
 * `/api/invoices/:id/submit` path, so the parent invoice comes from the route.
 *
 * `actual_refund` and `rejection_reason` have been removed: refund amounts are now
 * tracked per invoice position via `invoice_positions.refund_amount` (Issue #139).
 */
export const submissionInputSchema = z
  .object({
    submitted_at: isoDateTime.nullish(),
    submitted_via: submissionChannelSchema.nullish(),
    expected_refund: money.nullish(),
    refund_date: isoDate.nullish(),
  })
  .strict();

/** Full create payload, including the `invoice_id` FK the server persists. */
export const submissionCreateSchema = submissionInputSchema.extend({ invoice_id: uuid });

export const submissionSchema = submissionCreateSchema.extend({ id: uuid });

export const submissionUpdateSchema = submissionInputSchema.partial();

export type SubmissionInput = z.infer<typeof submissionInputSchema>;
export type SubmissionCreate = z.infer<typeof submissionCreateSchema>;
export type Submission = z.infer<typeof submissionSchema>;
export type SubmissionUpdate = z.infer<typeof submissionUpdateSchema>;

// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

import { isoDate, isoDateTime, money, uuid } from '../common.js';
import { submissionChannelSchema } from '../enums.js';

/**
 * Client-supplied fields of a submission (§3.2 `submissions`). `invoice_id` is
 * intentionally absent: the submission is always created/updated under the
 * `/api/invoices/:id/...` path, so the parent invoice comes from the route — a
 * body-level `invoice_id` would be redundant and could contradict the path.
 */
export const submissionInputSchema = z
  .object({
    submitted_at: isoDateTime.nullish(),
    submitted_via: submissionChannelSchema.nullish(),
    expected_refund: money.nullish(),
    actual_refund: money.nullish(),
    refund_date: isoDate.nullish(),
    rejection_reason: z.string().nullish(),
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

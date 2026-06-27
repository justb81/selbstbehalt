// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

import { isoDate, isoDateTime, money, uuid } from '../common.js';
import { submissionChannelSchema } from '../enums.js';

/** The (optional) submission record for an invoice (§3.2 `submissions`). */
export const submissionCreateSchema = z.object({
  invoice_id: uuid,
  submitted_at: isoDateTime.nullish(),
  submitted_via: submissionChannelSchema.nullish(),
  expected_refund: money.nullish(),
  actual_refund: money.nullish(),
  refund_date: isoDate.nullish(),
  rejection_reason: z.string().nullish(),
});

export const submissionSchema = submissionCreateSchema.extend({ id: uuid });

export const submissionUpdateSchema = submissionCreateSchema.partial();

export type SubmissionCreate = z.infer<typeof submissionCreateSchema>;
export type Submission = z.infer<typeof submissionSchema>;
export type SubmissionUpdate = z.infer<typeof submissionUpdateSchema>;

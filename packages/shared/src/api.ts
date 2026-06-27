// SPDX-License-Identifier: Apache-2.0
//
// Transport-level contracts shared by the backend (which produces them) and the
// frontend (which parses them). These are not persisted entities — they are the
// wire shapes of the REST envelope and the health probe. Keeping them here is
// the single source of truth so the two sides cannot drift apart.

import { z } from 'zod';

/**
 * The unified error envelope the backend returns for every non-2xx response
 * (see `backend/src/middleware/error.ts`).
 */
export const errorBodySchema = z.object({
  error: z.object({
    status: z.number(),
    message: z.string(),
  }),
});
export type ErrorBody = z.infer<typeof errorBodySchema>;

/**
 * Response shape of the unauthenticated `/api/health` liveness/readiness probe
 * (see `backend/src/routes/health.ts`).
 */
export const healthBodySchema = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.string(),
  db: z.enum(['up', 'down']),
});
export type HealthBody = z.infer<typeof healthBodySchema>;

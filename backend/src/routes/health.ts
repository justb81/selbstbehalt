// SPDX-License-Identifier: Apache-2.0
import { Hono } from 'hono';

import type { Database } from '../db/client.js';
import { pingDatabase } from '../db/health.js';

export interface HealthBody {
  status: 'ok' | 'degraded';
  service: string;
  db: 'up' | 'down';
}

const SERVICE = 'selbstbehalt-backend';

/**
 * Liveness/readiness probe. Returns 200 when the database answers, 503 when it
 * does not, so orchestrators can distinguish "process alive" from "ready".
 * Intentionally unauthenticated (mounted before the API-key middleware).
 */
export function createHealthRoute(db: Database) {
  return new Hono().get('/', (c) => {
    const dbUp = pingDatabase(db);
    const body: HealthBody = {
      status: dbUp ? 'ok' : 'degraded',
      service: SERVICE,
      db: dbUp ? 'up' : 'down',
    };
    return c.json(body, dbUp ? 200 : 503);
  });
}

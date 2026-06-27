// SPDX-License-Identifier: Apache-2.0
//
// Assembles the Hono application: middleware stack, routing, and error handling.
// Kept separate from `index.ts` (the server entry) so the app can be unit-tested
// in-process via `app.request(...)` without binding a port.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import type { Config } from './config.js';
import type { Database } from './db/client.js';
import { apiKeyAuth } from './middleware/auth.js';
import { onError, notFound } from './middleware/error.js';
import { createHealthRoute } from './routes/health.js';

export interface AppDeps {
  db: Database;
  config: Config;
}

/** Build the fully-wired Hono app. */
export function createApp({ db, config }: AppDeps) {
  const app = new Hono();

  app.use('*', logger());
  app.use(
    '*',
    cors({
      origin: config.corsOrigins === '*' ? '*' : config.corsOrigins,
    }),
  );

  // Health is unauthenticated for liveness probes — registered before the
  // API-key middleware so the key check never wraps it.
  app.route('/api/health', createHealthRoute(db));

  // Everything else under /api requires the API key when one is configured.
  app.use('/api/*', apiKeyAuth(config.apiKey));

  // Future endpoints (#11 contracts, #12 invoices, #13 stats, #14 backup)
  // are mounted here.

  app.notFound(notFound);
  app.onError(onError);

  return app;
}

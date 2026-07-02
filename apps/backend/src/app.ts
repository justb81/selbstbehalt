// SPDX-License-Identifier: Apache-2.0
//
// Assembles the Hono application: middleware stack, routing, and error handling.
// Kept separate from `index.ts` (the server entry) so the app can be unit-tested
// in-process via `app.request(...)` without binding a port.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';

import type { Config } from './config.js';
import type { Database } from './db/client.js';
import { apiKeyAuth } from './middleware/auth.js';
import { onError, notFound } from './middleware/error.js';
import { createBackupRoute } from './routes/backup.js';
import { createContractsRoute } from './routes/contracts.js';
import { createHealthRoute } from './routes/health.js';
import { createInsuredRoute } from './routes/insured.js';
import { createInvoicesRoute } from './routes/invoices.js';
import { createPersonsRoute } from './routes/persons.js';
import { createStatsRoute } from './routes/stats.js';

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
  // Security headers (§8, issue #31). The API is JSON-only, so the CSP locks
  // everything down rather than allowlisting resource types. Cross-Origin-
  // Resource-Policy is relaxed to 'cross-origin' (the default 'same-origin'
  // would silently block the documented separate-origin + CORS_ORIGINS +
  // X-API-Key deployment, §7.2, regardless of what CORS allows) — access
  // control stays with CORS_ORIGINS and the API-key/reverse-proxy auth below,
  // not with CORP. In the default single-origin setup the frontend's nginx
  // proxies /api/ verbatim and does not add a second, conflicting header set
  // (see apps/frontend/nginx.conf).
  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      crossOriginResourcePolicy: 'cross-origin',
      xFrameOptions: 'DENY',
    }),
  );

  // Health is unauthenticated for liveness probes — registered before the
  // API-key middleware so the key check never wraps it.
  app.route('/api/health', createHealthRoute(db));

  // Everything else under /api requires the API key when one is configured.
  app.use('/api/*', apiKeyAuth(config.apiKey));

  app.route('/api/persons', createPersonsRoute(db));
  app.route('/api/contracts', createContractsRoute(db));
  // Insured-person endpoints: /api/contracts/:id/insured and /api/insured/:id.
  app.route('/api', createInsuredRoute(db));
  app.route('/api/invoices', createInvoicesRoute(db));
  app.route('/api/stats', createStatsRoute(db));

  // Backup/restore lives at /api/export/db and /api/import/db (#14).
  app.route('/api', createBackupRoute({ db, config }));

  app.notFound(notFound);
  app.onError(onError);

  return app;
}

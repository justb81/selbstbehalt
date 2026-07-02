// SPDX-License-Identifier: Apache-2.0
//
// Server entry point. Loads config, opens + migrates the database, starts the
// Hono server on the configured port, and shuts down gracefully on SIGINT /
// SIGTERM (closing the HTTP server and the SQLite connection).

import { serve } from '@hono/node-server';

import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';

function main(): void {
  const config = loadConfig();
  const handle = createDb(config.databasePath);
  runMigrations(handle);

  const app = createApp({ db: handle.db, config });

  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`selbstbehalt backend listening on http://localhost:${info.port}`);
    if (!config.apiKey) {
      console.log('API-key auth disabled (no API_KEY set) — relying on reverse-proxy auth.');
    }
  });

  const shutdown = (signal: string): void => {
    console.log(`Received ${signal}, shutting down…`);
    server.close((err) => {
      if (err) console.error('Error during server shutdown:', err);
      handle.sqlite.close();
      process.exit(err ? 1 : 0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();

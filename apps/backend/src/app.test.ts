// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb, type DbHandle } from './db/client.js';

let handle: DbHandle;

beforeEach(() => {
  handle = createDb(':memory:');
});

afterEach(() => {
  if (handle.sqlite.open) handle.sqlite.close();
});

function app(env: NodeJS.ProcessEnv = {}) {
  return createApp({ db: handle.db, config: loadConfig(env) });
}

describe('createApp', () => {
  it('serves an unauthenticated health check reporting db status', async () => {
    const res = await app().request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'ok',
      service: 'selbstbehalt-backend',
      db: 'up',
    });
  });

  it('returns a unified JSON 404 for unknown routes', async () => {
    const res = await app().request('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { status: 404, message: 'Not Found' } });
  });

  it('leaves the health check reachable without an API key', async () => {
    const res = await app({ API_KEY: 'secret' }).request('/api/health');
    expect(res.status).toBe(200);
  });

  it('reports degraded health (503) when the database is closed', async () => {
    const built = app();
    handle.sqlite.close();
    const res = await built.request('/api/health');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: 'degraded', db: 'down' });
  });

  it('sets security headers on a normal response', async () => {
    const res = await app().request('/api/health');
    expect(res.headers.get('Content-Security-Policy')).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Strict-Transport-Security')).toContain('max-age=');
  });

  it('sets security headers on a 404 error response too', async () => {
    const res = await app().request('/api/does-not-exist');
    expect(res.headers.get('Content-Security-Policy')).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});

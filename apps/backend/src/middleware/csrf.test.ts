// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
//
// CSRF protection (#404): a cross-site page must not be able to reach any
// state-changing endpoint, in neither of the ambient-auth deployment modes.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createDb, type DbHandle } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';

let handle: DbHandle;

beforeEach(() => {
  handle = createDb(':memory:');
  runMigrations(handle);
});

afterEach(() => {
  if (handle.sqlite.open) handle.sqlite.close();
});

function app(env: NodeJS.ProcessEnv = {}) {
  return createApp({ db: handle.db, config: loadConfig(env) });
}

/** A person payload the create endpoint would accept if it ever ran. */
const person = JSON.stringify({ name: 'Max Mustermann' });

describe('cross-site write protection', () => {
  it('rejects an auto-submitted cross-site form post to /api/import/db', async () => {
    const form = new FormData();
    form.append('file', new File([new Uint8Array([1, 2, 3])], 'evil.sqlite'));

    const res = await app().request('http://api.local/api/import/db?confirm=true', {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
      body: form,
    });

    expect(res.status).toBe(403);
    // Answered in the app's unified error shape, not `hono/csrf`'s bare text.
    expect((await res.json()).error).toMatchObject({
      status: 403,
      message: expect.stringContaining('CSRF'),
    });
  });

  it('rejects a cross-site JSON write even with CORS_ORIGINS=*', async () => {
    const res = await app({ CORS_ORIGINS: '*' }).request('http://api.local/api/persons', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://evil.example',
        'sec-fetch-site': 'cross-site',
      },
      body: person,
    });

    expect(res.status).toBe(403);
    expect((await res.json()).error.message).toContain('CSRF');
  });

  it('rejects a cross-site write whose origin is not on the allow-list', async () => {
    const res = await app({ CORS_ORIGINS: 'https://app.example' }).request(
      'http://api.local/api/persons',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://evil.example',
          'sec-fetch-site': 'cross-site',
        },
        body: person,
      },
    );

    expect(res.status).toBe(403);
  });

  it('allows a same-origin write from the browser', async () => {
    const res = await app().request('http://api.local/api/persons', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://api.local',
        'sec-fetch-site': 'same-origin',
      },
      body: person,
    });

    expect(res.status).toBe(201);
  });

  it('allows a cross-site write from an explicitly configured origin (§7.2)', async () => {
    const res = await app({ CORS_ORIGINS: 'https://app.example' }).request(
      'http://api.local/api/persons',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://app.example',
          'sec-fetch-site': 'cross-site',
        },
        body: person,
      },
    );

    expect(res.status).toBe(201);
  });

  it('matches the browser origin through a TLS-terminating reverse proxy', async () => {
    // The proxy forwards plain HTTP, so only X-Forwarded-Proto makes the
    // request URL's origin comparable to the browser's `https://…` Origin.
    const res = await app().request('http://api.local/api/persons', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://api.local',
        'x-forwarded-proto': 'https',
      },
      body: person,
    });

    expect(res.status).toBe(201);
  });

  it('lets a non-browser client through (no Origin, no Sec-Fetch-Site)', async () => {
    const res = await app().request('http://api.local/api/persons', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: person,
    });

    expect(res.status).toBe(201);
  });

  it('rejects a bodyless cross-site DELETE', async () => {
    const res = await app().request(`http://api.local/api/persons/${crypto.randomUUID()}`, {
      method: 'DELETE',
      headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    });

    expect(res.status).toBe(403);
  });

  it('lets a bodyless DELETE from a non-browser client reach the route', async () => {
    // No Content-Type at all — which `hono/csrf` alone would read as a form
    // post and reject, so only the Sec-Fetch-Site guard may judge it.
    const res = await app().request(`http://api.local/api/persons/${crypto.randomUUID()}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(404);
  });

  it('leaves cross-site reads alone', async () => {
    const res = await app().request('http://api.local/api/persons', {
      headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    });

    expect(res.status).toBe(200);
  });
});

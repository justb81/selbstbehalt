// SPDX-License-Identifier: Apache-2.0
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { apiKeyAuth } from './auth.js';
import { onError } from './error.js';

function appWithKey(key: string | undefined) {
  const app = new Hono();
  app.onError(onError);
  app.use('*', apiKeyAuth(key));
  app.get('/protected', (c) => c.json({ ok: true }));
  return app;
}

describe('apiKeyAuth', () => {
  it('passes through when no key is configured', async () => {
    const res = await appWithKey(undefined).request('/protected');
    expect(res.status).toBe(200);
  });

  it('rejects requests with no header when a key is set', async () => {
    const res = await appWithKey('secret').request('/protected');
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { status: 401 } });
  });

  it('rejects a wrong key', async () => {
    const res = await appWithKey('secret').request('/protected', {
      headers: { 'x-api-key': 'nope' },
    });
    expect(res.status).toBe(401);
  });

  it('accepts the correct key', async () => {
    const res = await appWithKey('secret').request('/protected', {
      headers: { 'x-api-key': 'secret' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

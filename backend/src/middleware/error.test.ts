// SPDX-License-Identifier: Apache-2.0
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { notFound, onError } from './error.js';

beforeEach(() => {
  // The 500 path logs the underlying error; silence it in tests.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function appThatThrows(err: unknown) {
  const app = new Hono();
  app.onError(onError);
  app.notFound(notFound);
  app.get('/boom', () => {
    throw err;
  });
  return app;
}

describe('onError', () => {
  it('maps an HTTPException to its status and message', async () => {
    const res = await appThatThrows(new HTTPException(403, { message: 'Nope' })).request('/boom');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { status: 403, message: 'Nope' } });
  });

  it('maps an unexpected error to an opaque 500', async () => {
    const res = await appThatThrows(new Error('kaboom')).request('/boom');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { status: 500, message: 'Internal Server Error' } });
  });
});

describe('notFound', () => {
  it('returns the unified 404 body', async () => {
    const res = await appThatThrows(new Error('x')).request('/missing');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { status: 404, message: 'Not Found' } });
  });
});

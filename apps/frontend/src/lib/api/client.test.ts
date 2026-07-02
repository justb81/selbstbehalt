// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createApiClient } from './client';
import { ApiError } from './errors';

const schema = z.object({ id: z.string(), n: z.number() });

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('createApiClient', () => {
  it('performs a GET, sends the Accept header, and parses the body via the schema', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ id: 'a', n: 1 }));
    const { request } = createApiClient({ baseUrl: 'http://api.test', fetch });

    const data = await request('/api/thing', { schema });

    expect(data).toEqual({ id: 'a', n: 1 });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('http://api.test/api/thing');
    expect(init.method).toBe('GET');
    expect(init.headers.Accept).toBe('application/json');
    expect(init.headers['Content-Type']).toBeUndefined();
  });

  it('normalises a base URL with a trailing slash so the path joins cleanly', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ id: 'a', n: 1 }));
    const { request } = createApiClient({ baseUrl: 'http://api.test/', fetch });

    await request('/api/thing', { schema });

    expect(fetch.mock.calls[0]![0]).toBe('http://api.test/api/thing');
  });

  it('resolves a relative path against the page origin when the base URL is empty (same-origin)', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ id: 'a', n: 1 }));
    const { request } = createApiClient({ baseUrl: '', fetch });

    await request('/api/thing', { schema });

    expect(fetch.mock.calls[0]![0]).toBe(`${location.origin}/api/thing`);
  });

  it('appends query params and skips undefined/null values', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ id: 'a', n: 1 }));
    const { request } = createApiClient({ baseUrl: 'http://api.test', fetch });

    await request('/api/thing', { schema, query: { year: 2026, q: undefined, archived: false } });

    expect(fetch.mock.calls[0]![0]).toBe('http://api.test/api/thing?year=2026&archived=false');
  });

  it('serialises a JSON body and sets Content-Type for writes', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ id: 'a', n: 1 }));
    const { request } = createApiClient({ baseUrl: 'http://api.test', fetch });

    await request('/api/thing', { method: 'POST', body: { x: 1 }, schema });

    const init = fetch.mock.calls[0]![1];
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ x: 1 }));
  });

  it('adds the X-API-Key header when configured', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ id: 'a', n: 1 }));
    const { request } = createApiClient({ baseUrl: 'http://api.test', apiKey: 'secret', fetch });

    await request('/api/thing', { schema });

    expect(fetch.mock.calls[0]![1].headers['X-API-Key']).toBe('secret');
  });

  it('resolves a function baseUrl on every request', async () => {
    // Fresh Response per call — a Response body can only be read once.
    const fetch = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse({ id: 'a', n: 1 })));
    let base = 'http://one.test';
    const { request } = createApiClient({ baseUrl: () => base, fetch });

    await request('/p', { schema });
    base = 'http://two.test';
    await request('/p', { schema });

    expect(fetch.mock.calls[0]![0]).toBe('http://one.test/p');
    expect(fetch.mock.calls[1]![0]).toBe('http://two.test/p');
  });

  it('throws ApiError with the backend message on a non-2xx response', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: { status: 404, message: 'Nicht gefunden' } }, { status: 404 }),
      );
    const { request } = createApiClient({ baseUrl: 'http://api.test', fetch });

    await expect(request('/x', { schema })).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      message: 'Nicht gefunden',
    });
  });

  it('falls back to the status text when the backend error message is empty', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { error: { status: 404, message: '' } },
          { status: 404, statusText: 'Not Found' },
        ),
      );
    const { request } = createApiClient({ baseUrl: 'http://api.test', fetch });

    await expect(request('/x', { schema })).rejects.toMatchObject({
      status: 404,
      message: 'Not Found',
    });
  });

  it('falls back to the status text when the error body is not the expected shape', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response('nope', { status: 500, statusText: 'Server Error' }));
    const { request } = createApiClient({ baseUrl: 'http://api.test', fetch });

    await expect(request('/x', { schema })).rejects.toMatchObject({
      status: 500,
      message: 'Server Error',
    });
  });

  it('flags a validation error when the body does not match the schema', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ id: 'a', n: 'not-a-number' }));
    const { request } = createApiClient({ baseUrl: 'http://api.test', fetch });

    const err = await request('/x', { schema }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).isValidationError).toBe(true);
  });

  it('throws a validation ApiError when the body is not valid JSON', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('<<<', { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );
    const { request } = createApiClient({ baseUrl: 'http://api.test', fetch });

    const err = await request('/x', { schema }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).isValidationError).toBe(true);
  });

  it('wraps a network failure as ApiError with status 0', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('offline'));
    const { request } = createApiClient({ baseUrl: 'http://api.test', fetch });

    const err = await request('/x', { schema }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
  });

  it('returns undefined for a 204 even when a schema is given', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const { request } = createApiClient({ baseUrl: 'http://api.test', fetch });

    await expect(request('/x', { schema })).resolves.toBeUndefined();
  });

  it('returns undefined when no schema is provided (e.g. DELETE)', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const { request } = createApiClient({ baseUrl: 'http://api.test', fetch });

    await expect(request('/x', { method: 'DELETE' })).resolves.toBeUndefined();
  });
});

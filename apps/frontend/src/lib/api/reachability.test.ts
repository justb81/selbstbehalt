// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from './errors.js';
import { CACHED_AT_HEADER, STALE_HEADER } from '$lib/pwa/strategies.js';
import {
  noteApiResponse,
  resetServerStatus,
  serverStatus,
  wrapWithReachability,
} from './reachability.js';

const CACHED_AT = '2026-03-15T09:30:00.000Z';

function response(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status: status === 204 ? 204 : status, headers });
}

beforeEach(() => resetServerStatus());

describe('serverStatus', () => {
  it('claims nothing before the first request settles', () => {
    expect(get(serverStatus).reachable).toBeNull();
  });
});

describe('noteApiResponse', () => {
  it('treats any real answer as reachable', () => {
    noteApiResponse(response(200));
    expect(get(serverStatus)).toMatchObject({ reachable: true, stale: false, cachedAt: null });
  });

  // A 404 or a 500 from a route handler proves the backend is up and answering.
  it.each([404, 409, 500])('treats %i as reachable', (status) => {
    noteApiResponse(response(status));
    expect(get(serverStatus).reachable).toBe(true);
  });

  // A reverse proxy answering 502/503/504 is reporting the backend behind it as down.
  it.each([502, 503, 504])('treats the gateway status %i as unreachable', (status) => {
    noteApiResponse(response(status));
    expect(get(serverStatus)).toMatchObject({ reachable: false, stale: false });
  });

  // The crux of #381: a service-worker cache fallback is a plain 200, so judged
  // on the status alone an unreachable server would look reachable.
  it('treats a cache fallback as unreachable and dates it', () => {
    noteApiResponse(response(200, { [STALE_HEADER]: '1', [CACHED_AT_HEADER]: CACHED_AT }));
    expect(get(serverStatus)).toMatchObject({
      reachable: false,
      stale: true,
      cachedAt: CACHED_AT,
    });
  });

  it('clears the stale flag once a fresh answer arrives', () => {
    noteApiResponse(response(200, { [STALE_HEADER]: '1', [CACHED_AT_HEADER]: CACHED_AT }));
    noteApiResponse(response(200));
    expect(get(serverStatus)).toMatchObject({ reachable: true, stale: false, cachedAt: null });
  });
});

describe('wrapWithReachability', () => {
  it('passes a result through untouched', async () => {
    const request = wrapWithReachability(vi.fn().mockResolvedValue({ id: 'x' }));
    await expect(request('/api/x')).resolves.toEqual({ id: 'x' });
  });

  it('marks a network failure as unreachable and rethrows it unchanged', async () => {
    const error = new ApiError('Verbindung zum Server fehlgeschlagen: failed', 0);
    const request = wrapWithReachability(vi.fn().mockRejectedValue(error));

    await expect(request('/api/x')).rejects.toBe(error);
    expect(get(serverStatus).reachable).toBe(false);
  });

  // An HTTP error already passed through noteApiResponse, which saw the headers
  // this layer cannot; classifying it again would double-count `recoveries`.
  it('leaves the state to noteApiResponse for a request that got a response', async () => {
    const request = wrapWithReachability(vi.fn().mockRejectedValue(new ApiError('weg', 404)));
    await expect(request('/api/x')).rejects.toThrow('weg');
    expect(get(serverStatus).reachable).toBeNull();
  });

  it('ignores a non-ApiError throw', async () => {
    const request = wrapWithReachability(vi.fn().mockRejectedValue(new TypeError('boom')));
    await expect(request('/api/x')).rejects.toThrow('boom');
    expect(get(serverStatus).reachable).toBeNull();
  });
});

describe('recoveries', () => {
  it('counts only unreachable → reachable transitions', () => {
    noteApiResponse(response(200));
    expect(get(serverStatus).recoveries).toBe(0); // null → true is not a recovery

    noteApiResponse(response(200));
    expect(get(serverStatus).recoveries).toBe(0);

    noteApiResponse(response(503));
    noteApiResponse(response(200));
    expect(get(serverStatus).recoveries).toBe(1);

    noteApiResponse(response(200));
    expect(get(serverStatus).recoveries).toBe(1);
  });
});

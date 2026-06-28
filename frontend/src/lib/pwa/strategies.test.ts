// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';

import {
  cacheFirst,
  classifyRequest,
  hashManifest,
  networkFirst,
  type CacheLike,
  type StrategyDeps,
} from './strategies.js';

const SELF = 'https://app.example';
const ctx = { selfOrigin: SELF, modelPathPrefix: '/models/', apiPathPrefix: '/api/' };

/** A minimal in-memory Cache keyed by request URL. */
function fakeCache(): CacheLike & { store: Map<string, Response> } {
  const store = new Map<string, Response>();
  const key = (r: Request | string) => (typeof r === 'string' ? r : r.url);
  return {
    store,
    async match(r) {
      return store.get(key(r));
    },
    async put(r, res) {
      store.set(key(r), res);
    },
  };
}

function deps(cache: CacheLike, fetchImpl: StrategyDeps['fetch']): StrategyDeps {
  return { cacheName: 'test', openCache: async () => cache, fetch: fetchImpl };
}

describe('classifyRequest', () => {
  it('routes same-origin shell and bundled data as shell', () => {
    expect(classifyRequest(`${SELF}/`, 'GET', ctx)).toBe('shell');
    expect(classifyRequest(`${SELF}/_app/immutable/chunk.js`, 'GET', ctx)).toBe('shell');
    expect(classifyRequest(`${SELF}/data/goae.json`, 'GET', ctx)).toBe('shell');
  });

  it('routes same-origin OCR model assets as model', () => {
    expect(classifyRequest(`${SELF}/models/det.onnx`, 'GET', ctx)).toBe('model');
  });

  it('routes the same-origin /api/ path as api', () => {
    expect(classifyRequest(`${SELF}/api/invoices`, 'GET', ctx)).toBe('api');
  });

  it('classifies the configured backend origin as api, other cross-origin untouched', () => {
    const withBackend = { ...ctx, apiOrigin: 'https://backend.example:8080' };
    expect(classifyRequest('https://backend.example:8080/invoices', 'GET', withBackend)).toBe(
      'api',
    );
    // A different cross-origin host is left alone (not blanket-cached as API).
    expect(classifyRequest('https://cdn.example/avatar.png', 'GET', withBackend)).toBeNull();
    // With no apiOrigin configured, every cross-origin GET is untouched.
    expect(classifyRequest('https://backend.example:8080/invoices', 'GET', ctx)).toBeNull();
  });

  it('ignores writes and non-http schemes', () => {
    expect(classifyRequest(`${SELF}/api/invoices`, 'POST', ctx)).toBeNull();
    expect(classifyRequest('chrome-extension://abc/x.js', 'GET', ctx)).toBeNull();
    expect(classifyRequest('not a url', 'GET', ctx)).toBeNull();
  });
});

describe('cacheFirst', () => {
  it('serves a cached response without hitting the network', async () => {
    const cache = fakeCache();
    cache.store.set(`${SELF}/x.js`, new Response('cached'));
    const fetchImpl = vi.fn();
    const res = await cacheFirst(new Request(`${SELF}/x.js`), deps(cache, fetchImpl));
    expect(await res.text()).toBe('cached');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fetches and caches on a miss', async () => {
    const cache = fakeCache();
    const fetchImpl = vi.fn(async () => new Response('fresh', { status: 200 }));
    const req = new Request(`${SELF}/y.js`);
    const res = await cacheFirst(req, deps(cache, fetchImpl));
    expect(await res.text()).toBe('fresh');
    expect(await (await cache.match(req))?.text()).toBe('fresh');
  });

  it('does not cache a failed response', async () => {
    const cache = fakeCache();
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 }));
    const req = new Request(`${SELF}/z.js`);
    await cacheFirst(req, deps(cache, fetchImpl));
    expect(await cache.match(req)).toBeUndefined();
  });

  it('caches opaque responses only when cacheOpaque is set (OCR model host)', async () => {
    const cache = fakeCache();
    // A real opaque response (status 0, type 'opaque') can't be constructed in
    // jsdom, so fake those fields on an otherwise-normal Response.
    const opaque = new Response('model-bytes', { status: 200 });
    Object.defineProperty(opaque, 'type', { value: 'opaque' });
    Object.defineProperty(opaque, 'ok', { value: false });
    const req = new Request(`${SELF}/models/m.onnx`);
    await cacheFirst(
      req,
      deps(cache, async () => opaque),
      { cacheOpaque: true },
    );
    expect(await cache.match(req)).toBeDefined();
  });
});

describe('networkFirst', () => {
  it('returns and caches a fresh response when online', async () => {
    const cache = fakeCache();
    const req = new Request(`${SELF}/api/x`);
    const res = await networkFirst(
      req,
      deps(cache, async () => new Response('live')),
    );
    expect(await res.text()).toBe('live');
    expect(await cache.match(req)).toBeDefined();
  });

  it('falls back to cache when the network fails', async () => {
    const cache = fakeCache();
    const req = new Request(`${SELF}/api/x`);
    cache.store.set(req.url, new Response('stale'));
    const res = await networkFirst(
      req,
      deps(cache, async () => {
        throw new TypeError('offline');
      }),
    );
    expect(await res.text()).toBe('stale');
  });

  it('rethrows when offline and nothing is cached', async () => {
    const cache = fakeCache();
    await expect(
      networkFirst(
        new Request(`${SELF}/api/x`),
        deps(cache, async () => {
          throw new TypeError('offline');
        }),
      ),
    ).rejects.toThrow('offline');
  });
});

describe('hashManifest', () => {
  it('is stable for the same manifest and changes when an entry changes', () => {
    const a = [{ url: '/a.js', revision: '1' }];
    const b = [{ url: '/a.js', revision: '2' }];
    expect(hashManifest(a)).toBe(hashManifest(a));
    expect(hashManifest(a)).not.toBe(hashManifest(b));
    expect(hashManifest(a)).toMatch(/^[0-9a-f]{8}$/);
  });
});

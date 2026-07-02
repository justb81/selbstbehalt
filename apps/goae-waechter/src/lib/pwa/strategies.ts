// SPDX-License-Identifier: Apache-2.0
/**
 * Pure caching primitives for the service worker (docs/design.md §6.3), reused
 * from apps/frontend's implementation of the same strategies. GOÄ-Wächter has no
 * backend (issue #170), so unlike apps/frontend there is no Network-First REST
 * strategy here — only Cache First, for the app shell and, into a dedicated
 * never-evicted cache, the on-device OCR models ("Cache After First Load").
 *
 * Keeping the request classification and the cache strategy free of any
 * service-worker globals lets them be unit-tested with fake caches and `fetch`,
 * while `src/service-worker.ts` stays a thin wiring layer.
 */

/** How a request is routed: app shell, or an on-device OCR model. */
export type RequestClass = 'shell' | 'model';

export interface ClassifyContext {
  /** The service worker's own origin (`self.location.origin`). */
  selfOrigin: string;
  /** Same-origin path prefix the OCR models are served from. */
  modelPathPrefix: string;
}

/**
 * Decides how a request should be served, or `null` to leave it untouched
 * (passed straight to the network by the SW).
 *
 * Only same-origin GET is handled: there is no backend to talk to, and the
 * app never fetches from a third-party host (CLAUDE.md privacy constraint).
 */
export function classifyRequest(
  url: string,
  method: string,
  ctx: ClassifyContext,
): RequestClass | null {
  if (method.toUpperCase() !== 'GET') return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // Ignore non-http(s) schemes (chrome-extension:, data:, blob:, …).
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.origin !== ctx.selfOrigin) return null;

  // Same-origin, on-device OCR models: large and immutable, cached for good.
  if (parsed.pathname.startsWith(ctx.modelPathPrefix)) return 'model';

  // Everything else same-origin is the app shell + bundled GOÄ/GOZ/GOT tables.
  return 'shell';
}

/** The slice of the Cache API the strategy needs (so tests can fake it). */
export interface CacheLike {
  match(request: Request | string): Promise<Response | undefined>;
  put(request: Request | string, response: Response): Promise<void>;
}

export interface StrategyDeps {
  cacheName: string;
  openCache: (name: string) => Promise<CacheLike>;
  fetch: (request: Request) => Promise<Response>;
}

export interface CacheFirstOptions {
  /**
   * Also store cross-origin opaque responses. Used for the OCR model host so the
   * ~50–100 MB download survives even when served without CORS.
   */
  cacheOpaque?: boolean;
}

/**
 * Cache First: serve the cached copy if present, otherwise fetch, store a
 * successful response, and return it. A failed fetch propagates (there is no
 * cached fallback to give).
 */
export async function cacheFirst(
  request: Request,
  deps: StrategyDeps,
  options: CacheFirstOptions = {},
): Promise<Response> {
  const cache = await deps.openCache(deps.cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await deps.fetch(request);
  if (isCacheable(response, options)) {
    await cache.put(request, response.clone());
  }
  return response;
}

/**
 * Whether a response may be handed to `Cache.put()`. Mobile browsers (notably
 * WebKit) sometimes issue a `Range` request for large same-origin scripts,
 * getting back a 206 Partial Content response. `response.ok` is true for 206
 * too, but the Cache API spec throws a TypeError on `put()` for a partial
 * response; left unguarded, that throw rejects the strategy's promise and the
 * browser reports the original fetch as failed. Skip caching a 206 and let it
 * be re-fetched (and hopefully cached in full) next time.
 */
function isCacheable(response: Response, options: CacheFirstOptions): boolean {
  if (response.status === 206) return false;
  return response.ok || (options.cacheOpaque === true && response.type === 'opaque');
}

/** One entry of the Workbox precache manifest injected at build time. */
export interface PrecacheEntry {
  url: string;
  revision: string | null;
}

/**
 * FNV-1a hash over the precache (`url@revision` pairs) → a short, stable token.
 * Used to name the shell cache so it is busted exactly when a precached asset
 * changes, and not on every deploy.
 */
export function hashManifest(entries: readonly PrecacheEntry[]): string {
  let hash = 0x811c9dc5;
  const input = entries.map((entry) => `${entry.url}@${entry.revision ?? ''}`).join('\n');
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// SPDX-License-Identifier: Apache-2.0
/**
 * Pure caching primitives for the service worker (docs/design.md §6.3, issue
 * #27). Keeping the request classification and the cache strategies here — free
 * of any service-worker globals — lets them be unit-tested with fake caches and
 * `fetch`, while `src/service-worker.ts` stays a thin wiring layer.
 *
 * The three §6.3 strategies map to:
 *   - {@link cacheFirst} — app shell + bundled GOÄ tables (and, into a dedicated
 *     never-evicted cache, the on-device OCR models = "Cache After First Load").
 *   - {@link networkFirst} — REST API reads (fresh when online, last-known when
 *     offline).
 */

/** How a request is routed: app shell, REST API, or an on-device OCR model. */
export type RequestClass = 'shell' | 'api' | 'model';

export interface ClassifyContext {
  /** The service worker's own origin (`self.location.origin`). */
  selfOrigin: string;
  /** Same-origin path prefix the OCR models are served from (issue #27). */
  modelPathPrefix: string;
  /** Path prefix the REST API is mounted at when reverse-proxied same-origin. */
  apiPathPrefix: string;
  /**
   * Explicit backend origin, when the REST API lives on its own origin
   * (docs/design.md §7.3). Requests to it are classified as `api`; any *other*
   * cross-origin request is left untouched. Omit when the backend is reached
   * same-origin via {@link ClassifyContext.apiPathPrefix}.
   */
  apiOrigin?: string;
}

/**
 * Decides how a request should be served, or `null` to leave it untouched
 * (passed straight to the network by the SW).
 *
 * Only GET is handled: writes flow through the app-layer offline queue
 * (`$lib/offline`), which owns replay order, so the SW never caches or
 * intercepts them.
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

  // Cross-origin: only the explicitly-configured backend is ours; leave every
  // other host (avatars, map tiles, future embeds) untouched rather than
  // blanket-caching it as "API".
  if (parsed.origin !== ctx.selfOrigin) {
    return ctx.apiOrigin && parsed.origin === ctx.apiOrigin ? 'api' : null;
  }

  // Same-origin REST reads (e.g. a reverse-proxied `/api/`, docs/design.md §7.2).
  if (parsed.pathname.startsWith(ctx.apiPathPrefix)) return 'api';

  // Same-origin, on-device OCR models: large and immutable, cached for good.
  if (parsed.pathname.startsWith(ctx.modelPathPrefix)) return 'model';

  // Everything else same-origin is the app shell + bundled GOÄ/GOZ tables.
  return 'shell';
}

/** The slice of the Cache API the strategies need (so tests can fake it). */
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
   * ~50–100 MB download survives even when served without CORS (issue #27).
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
 * WebKit) sometimes issue a `Range` request for large same-origin scripts —
 * e.g. the pdf.js worker chunk — getting back a 206 Partial Content response.
 * `response.ok` is true for 206 too, but the Cache API spec throws a TypeError
 * on `put()` for a partial response; left unguarded, that throw rejects the
 * strategy's promise and the browser reports the original fetch/dynamic
 * import as failed (issue #159). Skip caching a 206 and let it be re-fetched
 * (and hopefully cached in full) next time.
 */
function isCacheable(response: Response, options: CacheFirstOptions): boolean {
  if (response.status === 206) return false;
  return response.ok || (options.cacheOpaque === true && response.type === 'opaque');
}

/**
 * Network First: try the network and cache a successful response; on a network
 * failure fall back to the cached copy, or rethrow if there is none.
 */
export async function networkFirst(request: Request, deps: StrategyDeps): Promise<Response> {
  const cache = await deps.openCache(deps.cacheName);
  try {
    const response = await deps.fetch(request);
    if (response.ok && response.status !== 206) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
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

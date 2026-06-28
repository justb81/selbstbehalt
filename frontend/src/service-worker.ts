/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
// SPDX-License-Identifier: Apache-2.0
/**
 * Service worker implementing the offline-first caching contract from
 * docs/design.md §6.3 (issue #27):
 *
 *   - App shell + bundled GOÄ/GOZ tables → Cache First
 *   - REST API reads                     → Network First (offline read cache)
 *   - On-device OCR models               → Cache After First Load (immutable)
 *
 * Writes are intentionally NOT handled here: they go through the app-layer
 * offline queue (`$lib/offline`), which owns replay order and Background Sync.
 * This worker only forwards the `replay-writes` sync event to open clients so
 * the queue can flush when connectivity returns.
 *
 * Built by @vite-pwa/sveltekit in `injectManifest` mode: `self.__WB_MANIFEST` is
 * the only thing injected — no Workbox runtime is bundled, so the SW fetches
 * nothing from a CDN (CLAUDE.md privacy constraint).
 */
import {
  cacheFirst,
  classifyRequest,
  hashManifest,
  networkFirst,
  type PrecacheEntry,
  type StrategyDeps,
} from './lib/pwa/strategies.js';

const sw = self as unknown as ServiceWorkerGlobalScope;

/** Background Sync event (not in the TS lib) — `tag` plus `ExtendableEvent`. */
interface SyncEventLike extends ExtendableEvent {
  readonly tag: string;
}

// Injected by @vite-pwa/sveltekit (injectManifest): the precached app shell.
const PRECACHE = (self as unknown as { __WB_MANIFEST: PrecacheEntry[] }).__WB_MANIFEST;
const VERSION = hashManifest(PRECACHE);

const SHELL_CACHE = `shell-${VERSION}`;
const API_CACHE = 'api-reads';
const MODEL_CACHE = 'ocr-models';
/** The SPA entry document; served (Cache First) for every navigation offline. */
const SHELL_DOCUMENT = '/';

const MODEL_PATH_PREFIX = '/models/';
const API_PATH_PREFIX = '/api/';
const REPLAY_TAG = 'replay-writes';

sw.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // The SPA fallback document is served at the scope root, not as
      // `index.html` (which 404s on an SPA host and would fail the atomic
      // addAll); precache it under SHELL_DOCUMENT instead. Everything else is a
      // content-hashed asset that is always present.
      const assetUrls = PRECACHE.map((entry) => entry.url).filter(
        (url) => url !== 'index.html' && url !== '/index.html',
      );
      await cache.addAll([...new Set([SHELL_DOCUMENT, ...assetUrls])]);
      // Deliberately no skipWaiting(): registerType 'prompt' waits for the user
      // to accept the reload hint (PwaUpdateToast → SKIP_WAITING message).
    })(),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop superseded shell caches; keep the API-read and OCR-model caches,
      // which are versionless on purpose (last-known data / immutable models).
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('shell-') && key !== SHELL_CACHE)
          .map((key) => caches.delete(key)),
      );
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener('fetch', (event) => {
  const { request } = event;

  // Navigations: serve the cached app shell so the installed PWA boots instantly
  // offline; the client router + Network-First API take over from there.
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  const cls = classifyRequest(request.url, request.method, {
    selfOrigin: sw.location.origin,
    modelPathPrefix: MODEL_PATH_PREFIX,
    apiPathPrefix: API_PATH_PREFIX,
  });
  if (!cls) return; // non-GET / unsupported scheme → straight to the network

  const cacheName = cls === 'api' ? API_CACHE : cls === 'model' ? MODEL_CACHE : SHELL_CACHE;
  const deps: StrategyDeps = {
    cacheName,
    openCache: (name) => caches.open(name),
    fetch: (req) => fetch(req),
  };

  if (cls === 'api') {
    event.respondWith(networkFirst(request, deps));
  } else if (cls === 'model') {
    event.respondWith(cacheFirst(request, deps, { cacheOpaque: true }));
  } else {
    event.respondWith(cacheFirst(request, deps));
  }
});

async function handleNavigation(request: Request): Promise<Response> {
  const cache = await caches.open(SHELL_CACHE);
  const cached = (await cache.match(SHELL_DOCUMENT)) ?? (await cache.match(request));
  if (cached) return cached;
  try {
    return await fetch(request);
  } catch {
    return new Response('Offline und keine zwischengespeicherte App-Shell verfügbar.', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

// Update flow: PwaUpdateToast posts SKIP_WAITING when the user accepts the
// reload, letting the waiting worker take over.
sw.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') {
    void sw.skipWaiting();
  }
});

// Background Sync: when connectivity returns, nudge any open client to replay
// its offline write-queue (the queue itself lives in the page, $lib/offline).
sw.addEventListener('sync', (event) => {
  const sync = event as SyncEventLike;
  if (sync.tag !== REPLAY_TAG) return;
  sync.waitUntil(notifyClientsToReplay());
});

async function notifyClientsToReplay(): Promise<void> {
  const clients = await sw.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const client of clients) client.postMessage({ type: 'replay-queue' });
}

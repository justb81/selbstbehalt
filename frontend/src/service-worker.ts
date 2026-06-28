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
 * offline queue (`$lib/offline`), which owns replay order. Replay is driven from
 * the page (the `online` event + an on-load flush), so it is not duplicated in
 * the worker.
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
      // Behind a reverse-proxy Basic Auth (e.g. Traefik/Coolify), the SW
      // install-event fetch runs before the browser has had a chance to replay
      // cached credentials in a worker context (Firefox in particular). A 401
      // here would throw and abort SW installation entirely. Catch and swallow:
      // the assets are fetched on demand via cacheFirst on first page access,
      // by which point the user's Basic Auth session is active in the tab.
      try {
        await cache.addAll([...new Set([SHELL_DOCUMENT, ...assetUrls])]);
      } catch {
        // Precache not critical — assets are cached on first use instead.
      }
      // Deliberately no skipWaiting(): registerType 'prompt' waits for the user
      // to accept the reload hint (PwaStatus → SKIP_WAITING message).
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
  // For shell assets, force credentials:'include' on SW network fallback fetches
  // so that a Basic Auth session set in the tab is forwarded by Firefox SW
  // contexts (where the default 'same-origin' mode sometimes omits them).
  const deps: StrategyDeps = {
    cacheName,
    openCache: (name) => caches.open(name),
    fetch:
      cls === 'shell'
        ? (req) => fetch(new Request(req, { credentials: 'include' }))
        : (req) => fetch(req),
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

// Update flow: PwaStatus posts SKIP_WAITING when the user accepts the reload,
// letting the waiting worker take over.
sw.addEventListener('message', (event) => {
  // Only honour messages from our own origin (the app's own pages); ignore any
  // cross-origin sender. ExtendableMessageEvent.origin is the sender's origin.
  if (event.origin && event.origin !== sw.location.origin) return;
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') {
    void sw.skipWaiting();
  }
});

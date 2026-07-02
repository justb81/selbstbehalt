/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
// SPDX-License-Identifier: Apache-2.0
/**
 * Service worker implementing the offline-first caching contract from
 * docs/design.md §6.3, reusing apps/frontend's strategies for GOÄ-Wächter
 * (issue #170), a standalone demo with no backend and no offline write-queue:
 *
 *   - App shell + bundled GOÄ/GOZ/GOT tables → Cache First
 *   - On-device OCR models               → Cache After First Load (immutable)
 *
 * Built by @vite-pwa/sveltekit in `injectManifest` mode: `self.__WB_MANIFEST` is
 * the only thing injected — no Workbox runtime is bundled, so the SW fetches
 * nothing from a CDN (CLAUDE.md privacy constraint).
 */
import {
  cacheFirst,
  classifyRequest,
  hashManifest,
  type PrecacheEntry,
  type StrategyDeps,
} from './lib/pwa/strategies.js';

const sw = self as unknown as ServiceWorkerGlobalScope;

// Injected by @vite-pwa/sveltekit (injectManifest): the precached app shell.
const PRECACHE = (self as unknown as { __WB_MANIFEST: PrecacheEntry[] }).__WB_MANIFEST;
const VERSION = hashManifest(PRECACHE);

const SHELL_CACHE = `shell-${VERSION}`;
const MODEL_CACHE = 'ocr-models';

/**
 * The site's base directory. The worker is served from it — `/` at the domain
 * root (apps/frontend, a custom domain) or `/<repo>/` when GitHub Pages serves
 * the demo under a project subpath (issue #171) — so resolving against the
 * worker's own URL keeps the shell + model paths correct wherever it is hosted.
 */
const BASE_PATH = new URL('./', sw.location.href).pathname;
/** The SPA entry document; served (Cache First) for every navigation offline. */
const SHELL_DOCUMENT = BASE_PATH;

const MODEL_PATH_PREFIX = `${BASE_PATH}models/`;

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
      // Drop superseded shell caches; keep the OCR-model cache, which is
      // versionless on purpose (the models are immutable).
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
  // offline; the client router takes over from there.
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  const cls = classifyRequest(request.url, request.method, {
    selfOrigin: sw.location.origin,
    modelPathPrefix: MODEL_PATH_PREFIX,
  });
  if (!cls) return; // non-GET / cross-origin / unsupported scheme → straight to the network

  const cacheName = cls === 'model' ? MODEL_CACHE : SHELL_CACHE;
  const deps: StrategyDeps = {
    cacheName,
    openCache: (name) => caches.open(name),
    fetch: (req) => fetch(req),
  };

  if (cls === 'model') {
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

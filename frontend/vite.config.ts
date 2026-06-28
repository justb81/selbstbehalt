// SPDX-License-Identifier: Apache-2.0
import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';

export default defineConfig({
  // Mirror the production nginx setup (frontend/nginx.conf) in local dev: proxy
  // /api to the backend so the app talks to a single same-origin endpoint. The
  // API client therefore needs no PUBLIC_API_URL during `vite dev` — it just
  // calls `/api/...` on the dev server. Override the target with API_PROXY_TARGET
  // if the backend runs elsewhere.
  server: {
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET || 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    sveltekit(),
    // PWA layer (docs/design.md §6.3, issue #27). `injectManifest` lets us ship a
    // hand-written service worker (src/service-worker.ts) that implements the
    // three caching strategies from §6.3 — Workbox is not pulled into the SW
    // runtime, only the precache manifest (`self.__WB_MANIFEST`) is injected, so
    // nothing is fetched from a CDN at runtime (CLAUDE.md privacy constraint).
    SvelteKitPWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'service-worker.ts',
      // `prompt`: a new worker waits until the user accepts the reload hint
      // (handled by PwaStatus) instead of silently swapping the app.
      registerType: 'prompt',
      // We register the worker ourselves via $lib/pwa/register so the update
      // flow is driven from a Svelte store.
      injectRegister: null,
      manifest: {
        name: 'PKV Manager',
        short_name: 'PKV',
        description: 'Private Krankenversicherung selbst verwalten',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#2563eb',
        lang: 'de-DE',
        categories: ['health', 'finance'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      injectManifest: {
        // App shell + bundled data (the GOÄ/GOZ/GOT tables are imported into the
        // JS bundle). The OCR models (~50–100 MB, issue #27) are deliberately
        // excluded from the precache and cached on first use instead.
        globPatterns: ['**/*.{js,mjs,css,html,svg,ico,png,webp,woff,woff2,json}'],
        globIgnores: ['**/models/**'],
        // The largest precached asset is the GOÄ table chunk; raise the limit so
        // it is not silently dropped from the precache.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
      // adapter-static emits an SPA fallback (index.html); tell the plugin so it
      // precaches that entry document and navigations resolve offline.
      kit: {
        adapterFallback: 'index.html',
        spa: true,
      },
      devOptions: {
        // Keep the SW out of `vite dev` so HMR is not shadowed by the cache; it
        // is exercised by `vite preview`/production builds and the E2E check.
        enabled: false,
        type: 'module',
      },
    }),
  ],
});

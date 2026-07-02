// SPDX-License-Identifier: Apache-2.0
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';

// Must mirror svelte.config.js's `paths.base`: on GitHub Pages the app is served
// under a subpath (/<repo>/), so the web-app-manifest URLs (start_url, scope,
// icons) are prefixed with the same BASE_PATH (issue #171). Unset (custom domain
// at the root) → base "" → the manifest points at "/" as before.
const rawBase = process.env.BASE_PATH ?? '';
const base = rawBase.endsWith('/') ? rawBase.slice(0, -1) : rawBase;

export default defineConfig({
  // GOÄ-Wächter is a standalone demo (issue #170): no backend, no `/api` proxy —
  // unlike apps/frontend it never talks to a server at all.
  plugins: [
    tailwindcss(),
    sveltekit(),
    // PWA layer (docs/design.md §6.3), reusing the same `injectManifest` setup as
    // apps/frontend: a hand-written service worker (src/service-worker.ts) gets
    // the precache manifest injected, no Workbox runtime is bundled, so nothing
    // is fetched from a CDN at runtime (CLAUDE.md privacy constraint).
    SvelteKitPWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'service-worker.ts',
      registerType: 'prompt',
      injectRegister: null,
      manifest: {
        name: 'GOÄ-Wächter',
        short_name: 'GOÄ-Wächter',
        description:
          'Ihre Arztrechnung geprüft, bevor Sie zahlen – GOÄ-Prüfung in Sekunden, direkt im Browser, ganz ohne Cloud-Upload.',
        start_url: `${base}/`,
        scope: `${base}/`,
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#2563eb',
        lang: 'de-DE',
        categories: ['health', 'utilities'],
        icons: [
          { src: `${base}/icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
          { src: `${base}/icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
          {
            src: `${base}/icons/icon-512-maskable.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      injectManifest: {
        // App shell + bundled GOÄ/GOZ/GOT data. The OCR models (~50–100 MB) are
        // deliberately excluded from the precache and cached on first use instead.
        globPatterns: ['**/*.{js,mjs,css,html,svg,ico,png,webp,woff,woff2,json,txt}'],
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

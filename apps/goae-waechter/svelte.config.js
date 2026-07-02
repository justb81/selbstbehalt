// SPDX-License-Identifier: Apache-2.0
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    // GOÄ-Wächter is a standalone, backend-free static PWA (issue #170): no
    // server, no API — adapter-static emits a plain SPA shell any static host
    // (GitHub Pages, issue #171) can serve.
    adapter: adapter({ fallback: 'index.html' }),
    // The PWA service worker (src/service-worker.ts) is built and registered by
    // @vite-pwa/sveltekit (see vite.config.ts), so SvelteKit's own auto-build /
    // auto-registration of that file is turned off to avoid a double register.
    serviceWorker: { register: false },
  },
};

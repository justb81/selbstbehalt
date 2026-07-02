// SPDX-License-Identifier: Apache-2.0
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    // selbstbehalt is a fully client-rendered PWA: the backend is a separate
    // REST service and invoice OCR runs in the browser, so there is no
    // server-render step (see docs/design.md §1.3, §2.1). adapter-static emits
    // a static shell with an SPA fallback that any plain file server can host.
    adapter: adapter({ fallback: 'index.html' }),
    // The PWA service worker (src/service-worker.ts) is built and registered by
    // @vite-pwa/sveltekit (see vite.config.ts), so SvelteKit's own auto-build /
    // auto-registration of that file is turned off to avoid a double register.
    serviceWorker: { register: false },
  },
};

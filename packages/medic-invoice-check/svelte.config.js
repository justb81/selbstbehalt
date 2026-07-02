// SPDX-License-Identifier: Apache-2.0
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// This package is not a SvelteKit app — it ships plain Svelte components
// consumed as source by apps/frontend and the GOÄ-Wächter demo. vitePreprocess
// hands `<script lang="ts">` blocks to the TypeScript compiler; svelte-check
// and the vitest svelte plugin both read this config.
/** @type {import('@sveltejs/vite-plugin-svelte').Config} */
export default {
  preprocess: vitePreprocess(),
};

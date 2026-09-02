// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Not a SvelteKit app — this package ships the shadcn-svelte primitives as plain
// Svelte source, compiled by whichever app imports them. vitePreprocess hands
// `<script lang="ts">` blocks to the TypeScript compiler for svelte-check.
/** @type {import('@sveltejs/vite-plugin-svelte').Config} */
export default {
  preprocess: vitePreprocess(),
};

// SPDX-License-Identifier: Apache-2.0
// Flat ESLint config shared across the whole monorepo (frontend + backend).
// Keeping a single root config is the DRY source of truth required by issue #3.
import js from '@eslint/js';
import globals from 'globals';
import svelte from 'eslint-plugin-svelte';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import svelteConfig from './apps/frontend/svelte.config.js';

export default tseslint.config(
  // Globally ignored paths — generated output, dependencies, lockfile, source data.
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/.svelte-kit/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'pnpm-lock.yaml',
      'data/**',
      // On-device OCR assets fetched/copied at build time (git-ignored vendor
      // binaries + their emscripten glue), not project source.
      'apps/frontend/static/models/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // TypeScript / JS sources.
  {
    files: ['**/*.{ts,mts,cts,js,mjs,cjs}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },

  // Svelte components (frontend). The plugin pulls in the Svelte parser and
  // hands `<script lang="ts">` blocks to the TypeScript parser.
  ...svelte.configs.recommended,
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        projectService: true,
        extraFileExtensions: ['.svelte'],
        parser: tseslint.parser,
        svelteConfig,
      },
    },
  },

  // shadcn-svelte generated UI components use plain <a href> links rather than
  // SvelteKit's goto(); suppress the navigation rule for that directory only.
  {
    files: ['apps/frontend/src/lib/components/ui/**/*.svelte'],
    rules: {
      'svelte/no-navigation-without-resolve': 'off',
    },
  },

  // Must come last: turns off stylistic rules that conflict with Prettier.
  prettier,
);

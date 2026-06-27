// SPDX-License-Identifier: Apache-2.0
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The SvelteKit plugin gives tests the same `$lib`, `$app/*` and `$env/*`
  // module resolution as the app, so components and the API client can be
  // imported exactly as they are at runtime.
  plugins: [sveltekit(), svelteTesting()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest-setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,svelte.ts}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,svelte}'],
      // Generated declarations and per-route load config (a one-line constant)
      // carry no meaningful unit coverage.
      exclude: ['src/**/*.d.ts', 'src/routes/**/+layout.ts'],
      thresholds: {
        statements: 80,
        functions: 80,
        lines: 80,
        // Branch coverage on compiled Svelte components is inherently noisy
        // (reactive template effects count as uncovered branches), so the
        // global branch floor is modest. Pure-TS domain code is gated strictly
        // below.
        branches: 50,
        // The domain-critical helpers (GOÄ parser, Günstigerprüfung; see
        // docs/design.md §5) live under lib/utils and must stay well covered.
        'src/lib/utils/**': {
          statements: 90,
          branches: 90,
          functions: 90,
          lines: 90,
        },
      },
    },
  },
});

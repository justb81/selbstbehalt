// SPDX-License-Identifier: Apache-2.0
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest-setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,svelte.ts}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,svelte}'],
      // Bootstrap/entry code has no meaningful unit coverage.
      exclude: ['src/main.ts', 'src/**/*.d.ts'],
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

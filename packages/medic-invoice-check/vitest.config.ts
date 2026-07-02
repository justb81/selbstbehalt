// SPDX-License-Identifier: Apache-2.0
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

// Standalone Svelte component testing (no SvelteKit): the vite-plugin-svelte
// `svelte()` plugin compiles components, and svelteTesting() wires up the
// browser resolve conditions + auto-cleanup that @testing-library/svelte needs.
export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest-setup.ts'],
    include: ['src/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,svelte}'],
      exclude: [
        'src/**/*.d.ts',
        'src/lib/index.ts',
        // shadcn-svelte generated components are vendored UI primitives; they
        // are not authored here and do not need unit-test coverage.
        'src/lib/components/ui/**',
        // Test-only harness for InvoiceReview.
        'src/lib/components/InvoiceReviewTestHarness.svelte',
      ],
      thresholds: {
        statements: 80,
        functions: 70,
        lines: 80,
        // Branch coverage is modest globally: compiled Svelte components and the
        // OCR worker/engine seam carry branches that only fire in a real
        // browser/WebGPU context (mirrors apps/frontend's low global branch floor).
        branches: 60,
        // The domain-critical GOÄ/GOZ/GOT parser is pure and deterministic and
        // must stay well covered — this mirrors the gate apps/frontend enforced
        // on lib/utils before the extraction (docs/design.md §4).
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

// SPDX-License-Identifier: Apache-2.0
import { fileURLToPath } from 'node:url';

import { sveltekit } from '@sveltejs/kit/vite';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The SvelteKit plugin gives tests the same `$lib`, `$app/*` and `$env/*`
  // module resolution as the app, so components can be imported exactly as they
  // are at runtime.
  plugins: [sveltekit(), svelteTesting()],
  resolve: {
    alias: {
      // The PWA register hook is a virtual module that only exists when
      // @vite-pwa/sveltekit runs (build/dev); point it at an inert stub so
      // components that register the service worker stay unit-testable.
      'virtual:pwa-register/svelte': fileURLToPath(
        new URL('./src/lib/pwa/register-stub.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest-setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,svelte.ts}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,svelte}'],
      // Generated declarations and route page components (a thin integration
      // point, mostly wiring @selbstbehalt/medic-invoice-check together) carry
      // no meaningful unit coverage on their own; shadcn-svelte generated UI
      // primitives are vendored, not authored here. service-worker.ts is a thin
      // wiring layer over the well-tested lib/pwa/strategies.ts (see its own
      // header comment) and only runs in a real SW context — exercised by the
      // Playwright PWA checks (e2e/pwa.spec.ts), not unit tests.
      exclude: [
        'src/**/*.d.ts',
        'src/routes/**/+layout.ts',
        'src/routes/**/*.svelte',
        'src/lib/components/ui/**',
        'src/service-worker.ts',
      ],
      thresholds: {
        statements: 80,
        functions: 80,
        lines: 80,
        branches: 70,
      },
    },
  },
});

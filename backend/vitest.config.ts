import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      // Bootstrap/entry code and CLI dev scripts have no meaningful unit
      // coverage (their core logic is exercised via the integration test).
      // schema.ts is a declarative Drizzle table definition — its correctness
      // (tables, FKs, defaults, JSON columns) is asserted by the integration
      // test, not by line coverage of its column-builder closures.
      exclude: [
        'src/index.ts',
        'src/db/migrate.ts',
        'src/db/seed.ts',
        'src/db/schema.ts',
        'src/**/*.d.ts',
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});

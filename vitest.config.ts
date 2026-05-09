import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/**/*.{test,spec}.ts'],
    // `test/integration/` runs against real Postgres via testcontainers (Docker
    // required) and is opt-in via `pnpm test:integration`. `test/e2e/` does the
    // same for full controller→DB flows.
    exclude: ['test/integration/**', 'test/e2e/**', 'node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      // Exclude pure-types files (no runtime code) and barrel files. Both
      // produce empty/no-op output that the coverage tool reports as 0%.
      exclude: [
        'src/**/index.ts',
        'src/**/*.d.ts',
        'src/core/tenant-context.ts', // interface-only
        'src/core/relationships/definition.ts', // interface-only
        'src/core/permissions/types.ts', // interface-only
        'src/nestjs/options.ts', // interface-only
        'src/nestjs/tokens.ts', // const-only (Symbol declarations)
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
    testTimeout: 10_000,
  },
});

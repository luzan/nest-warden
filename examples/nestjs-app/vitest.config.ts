import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts', 'test/unit/**/*.{test,spec}.ts'],
    exclude: ['node_modules', 'dist', 'test/e2e/**'],
  },
});

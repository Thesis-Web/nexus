import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/core/src/**/*.test.ts'],
    exclude: ['**/dist/**', '**/node_modules/**'],
    reporter: 'verbose',
    coverage: {
      provider: 'v8',
      include: ['packages/core/src/gates/**'],
      thresholds: {
        lines: 95,
      },
    },
  },
});

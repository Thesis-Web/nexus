import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/core/src/**/*.integration.test.ts'],
    exclude: ['**/dist/**', '**/node_modules/**'],
    reporter: 'verbose',
    testTimeout: 30000,
    // Integration tests run serially — ledger chain integrity requires ordered execution
    sequence: {
      shuffle: false,
    },
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});

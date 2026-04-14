import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/core/src/**/*.threat.test.ts'],
    exclude: ['**/dist/**', '**/node_modules/**'],
    reporter: 'verbose',
    testTimeout: 15000,
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});

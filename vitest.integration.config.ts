import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/core/src/**/*.integration.test.ts',
      'packages/vanguard/src/**/*.integration.test.ts',
    ],
    globals: false,
    testTimeout: 60000,
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/core/src/**/*.threat.test.ts', 'packages/vanguard/src/**/*.threat.test.ts'],
    globals: false,
    testTimeout: 30000,
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/contracts/src/**/*.test.ts',
      'packages/core/src/**/*.test.ts',
      'packages/vanguard/src/**/*.test.ts',
      'packages/identity-ref/src/**/*.test.ts',
      'packages/adapters/*/src/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    exclude: ['**/*.integration.test.ts', '**/*.threat.test.ts'],
    globals: false,
    testTimeout: 30000,
  },
});

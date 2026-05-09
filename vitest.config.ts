import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/contracts/src/**/*.test.ts',
      'packages/core/src/**/*.test.ts',
      'packages/vanguard/src/**/*.test.ts',
      'packages/identity-ref/src/**/*.test.ts',
      'packages/orch-ref/src/**/*.test.ts',
      'packages/adapters/*/src/**/*.test.ts',
      // CLAUDE-CODE-AUDIT-TIGHTEN-PHASE-AB §3 — workspace-ref client
      // tests. Pure reducer/hook tests stay on node env; React
      // component tests opt into jsdom via per-file
      // `// @vitest-environment jsdom` directive.
      'packages/workspace-ref/src/**/*.test.{ts,tsx}',
      'tests/**/*.test.ts',
    ],
    exclude: ['**/*.integration.test.ts', '**/*.threat.test.ts'],
    globals: false,
    testTimeout: 30000,
  },
});

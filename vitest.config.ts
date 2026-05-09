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
      // CLAUDE-CODE-ACTION-NORMALIZER-PHASE-C §6 — composition-boundary
      // helpers (e.g. extract-tool-calls) live under scripts/ and need
      // their own tests. Picked up here, not in the package globs.
      'scripts/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    exclude: ['**/*.integration.test.ts', '**/*.threat.test.ts'],
    globals: false,
    testTimeout: 30000,
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/core/src/**/*.integration.test.ts',
      'packages/vanguard/src/**/*.integration.test.ts',
      // AMEND-nexus-planner-db-lexicon-v0-2-1.md §9.2 — planner integration tests
      'packages/planners/*/src/**/*.integration.test.ts',
      // Connector packages are flat (no src/), so use the package-direct glob.
      'packages/connectors/*/*.integration.test.ts',
      // Cross-cutting pipeline tests that exercise multiple packages — live
      // here so they don't pollute any single package's ownership.
      'tests/integration/**/*.integration.test.ts',
    ],
    globals: false,
    testTimeout: 60000,
    fileParallelism: false,
    poolOptions: {
      threads: {
        singleThread: true,
      },
      forks: {
        singleFork: true,
      },
    },
  },
});

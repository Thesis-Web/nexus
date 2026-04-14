/**
 * vitest.config.ts — unit test configuration
 * Spec: nexus-engineering-spec-v0-4-6.md §27.1, §31.2
 *
 * CONTRA-AUDIT-004 + INFRA-001 fix (2026-04-14):
 *   - @vitest/coverage-v8 wired with min 95% line coverage on gates/
 *   - Scoped to packages/core/src/gates/ per §31.2 law
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/core/src/gates/**/*.test.ts', 'packages/core/src/**/*.test.ts'],
    exclude: [
      'packages/**/*.integration.test.ts',
      'packages/**/*.replay.test.ts',
      'packages/**/*.threat.test.ts',
      '**/node_modules/**',
      '**/dist/**',
    ],
    environment: 'node',
    coverage: {
      // §31.2: min 95% line coverage on packages/core/src/gates/
      provider: 'v8',
      include: ['packages/core/src/gates/**'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/*.d.ts'],
      thresholds: {
        lines: 95,
        functions: 90,
        branches: 90,
        statements: 95,
      },
      reporter: ['text', 'lcov'],
    },
  },
});

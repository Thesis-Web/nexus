import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));

// Workspace package aliases — scripts/ tests import @nexus/* by name and
// need vitest's resolver to find them. Type-only imports (the older
// scripts pattern) didn't trip this because TS strips them; value imports
// do. Aliases mirror tsconfig.base.json paths so the runtime behavior
// matches the typecheck.
const NEXUS_ALIASES = {
  '@nexus/contracts': path.join(root, 'packages/contracts/src/index.ts'),
  '@nexus/core': path.join(root, 'packages/core/src/index.ts'),
  '@nexus/vanguard': path.join(root, 'packages/vanguard/src/index.ts'),
  '@nexus/identity-ref': path.join(root, 'packages/identity-ref/src/index.ts'),
  '@nexus/orch-ref': path.join(root, 'packages/orch-ref/src/index.ts'),
  '@nexus/runtime-utils': path.join(root, 'packages/runtime-utils/src/index.ts'),
  '@nexus/workspace-ref': path.join(root, 'packages/workspace-ref/src/index.ts'),
  '@nexus/cli': path.join(root, 'packages/interfaces/cli/src/index.ts'),
  '@nexus/api': path.join(root, 'packages/interfaces/api/src/server.ts'),
  '@nexus/adapter-mcp': path.join(root, 'packages/adapters/mcp/src/index.ts'),
  '@nexus/connector-stub': path.join(root, 'packages/connectors/stub/stub.connector.ts'),
  '@nexus/connector-postgres': path.join(
    root,
    'packages/connectors/postgres/postgres.connector.ts'
  ),
};

export default defineConfig({
  resolve: { alias: NEXUS_ALIASES },
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
      // Connector packages are laid out flat (packages/connectors/<name>/
      // <name>.connector.ts), not under src/, so the standard src/**/
      // globs above don't catch them. Pick them up explicitly so unit
      // tests for connectors run with the rest of the suite.
      'packages/connectors/*/*.test.ts',
    ],
    exclude: ['**/*.integration.test.ts', '**/*.threat.test.ts'],
    globals: false,
    testTimeout: 30000,
  },
});

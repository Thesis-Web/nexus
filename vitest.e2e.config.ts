/**
 * vitest.e2e.config.ts — E2E v0.4.0 §4 — the acceptance wall config.
 *
 * Discovers tests/e2e/*.e2e.test.ts. Each test boots a real composition
 * root via tests/e2e/harness.ts; suites run sequentially (single thread)
 * because each one binds a server port + spawns a child process and
 * concurrency would race for fixtures.
 *
 * Reporter wiring (2026-05-21 owner directive):
 *   The wall must surface truth — `it.skip` / `it.todo` are banned in
 *   tests/e2e/**, every test runs, and the AcceptanceWallReporter writes
 *   the structured failure ledger to runs/acceptance-wall-2026-05-21/
 *   FAILURE-LEDGER.{md,jsonl} on every run. We keep the verbose default
 *   reporter alongside so the terminal still shows per-test progress.
 */
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import AcceptanceWallReporter from './tests/e2e/_acceptance/reporter.js';

const root = path.dirname(fileURLToPath(import.meta.url));

// E2E tests assert against canonical constants from @nexus/contracts
// (FINAL_OUTCOME.EXECUTED, etc.) so the wall doesn't drift on string
// literals. The aliases mirror vitest.config.ts so resolution is
// identical to the unit-test config.
const NEXUS_ALIASES = {
  '@nexus/contracts': path.join(root, 'packages/contracts/src/index.ts'),
  '@nexus/core': path.join(root, 'packages/core/src/index.ts'),
  '@nexus/runtime-utils': path.join(root, 'packages/runtime-utils/src/index.ts'),
};

export default defineConfig({
  resolve: { alias: NEXUS_ALIASES },
  test: {
    include: ['tests/e2e/**/*.e2e.test.ts'],
    exclude: ['tests/e2e/_acceptance/**'],
    globals: false,
    reporters: ['verbose', new AcceptanceWallReporter()],
    // Each suite boots a real server + may invoke a real Ollama for
    // tens of seconds. Generous timeout, no parallelism.
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    poolOptions: {
      threads: { singleThread: true },
      forks: { singleFork: true },
    },
  },
});

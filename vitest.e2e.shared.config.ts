/**
 * vitest.e2e.shared.config.ts — Phase 7 shared-mode wall config.
 *
 * Production-shape default: one Nexus server, many users/personas/runs
 * concurrently. Sibling to vitest.e2e.config.ts which boots a per-file
 * subprocess (forensic-debug fallback — see tests/e2e/harness.ts header
 * for the two-mode design).
 *
 * Differences vs. vitest.e2e.config.ts:
 *  - globalSetup boots ONE shared server before any test file runs.
 *  - fileParallelism enabled — test files run concurrently against the
 *    same server (the runtime isolates by runId / actorId).
 *  - The new tests/e2e/14-shared-harness-concurrency.e2e.test.ts is
 *    included; it's excluded from the isolated config (only meaningful
 *    on a shared server).
 *  - AcceptanceWallReporter writes to a different output path so the
 *    shared run does not overwrite the isolated wall ledger.
 */
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import AcceptanceWallReporter from './tests/e2e/_acceptance/reporter.js';

const root = path.dirname(fileURLToPath(import.meta.url));

const NEXUS_ALIASES = {
  '@nexus/contracts': path.join(root, 'packages/contracts/src/index.ts'),
  '@nexus/core': path.join(root, 'packages/core/src/index.ts'),
  '@nexus/runtime-utils': path.join(root, 'packages/runtime-utils/src/index.ts'),
};

export default defineConfig({
  resolve: { alias: NEXUS_ALIASES },
  test: {
    include: ['tests/e2e/**/*.e2e.test.ts'],
    exclude: ['tests/e2e/_acceptance/**', 'tests/e2e/_shared/**'],
    globals: false,
    reporters: ['verbose', new AcceptanceWallReporter()],
    // Each suite still hits a real Ollama for chat/frontier legs;
    // per-test timeout stays generous so a slow inference doesn't
    // false-fail.
    testTimeout: 180_000,
    hookTimeout: 180_000,
    // Single shared server boots once; concurrent test files exercise
    // it the way real users would. The runtime partitions concurrent
    // work by runId / actorId / per-(runId, actorId) mailbox.
    globalSetup: ['./tests/e2e/_shared/global-setup.ts'],
    fileParallelism: true,
    pool: 'threads',
    poolOptions: {
      threads: {
        // Keep parallelism modest — concurrent ollama calls saturate
        // local model resources. 4 is a balanced default; override with
        // VITEST_MAX_THREADS env var if your host can sustain more.
        maxThreads: Number(process.env['VITEST_MAX_THREADS'] ?? 4),
        minThreads: 1,
      },
    },
  },
});

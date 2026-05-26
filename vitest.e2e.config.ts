/**
 * vitest.e2e.config.ts — E2E v0.4.0 §4 — the ISOLATED-mode wall config.
 *
 * Forensic-debug fallback mode (per tests/e2e/harness.ts header):
 *   one test file = one isolated `pnpm nexus serve` subprocess against
 *   a fresh tmpdir. Useful when investigating a single suite without
 *   any other test's state on disk. Each file's bootHarness() spawns
 *   its own server because `NEXUS_E2E_BASE_URL` is NOT set by this
 *   config — the harness auto-detects and switches to isolated mode.
 *
 * Production-shape default lives at `vitest.e2e.shared.config.ts` —
 * single Nexus server, concurrent users/runs, runtime-enforced
 * isolation (HL#8 / E2E-116). Use `pnpm test:e2e:shared` for that.
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
    // Phase 7: tests/e2e/14-shared-harness-concurrency.e2e.test.ts is
    // meaningful only against a shared server (vitest.e2e.shared.config
    // .ts) — in isolated mode every "concurrent" run would still be
    // against this file's own subprocess, which doesn't prove the
    // cross-test isolation invariant the test asserts.
    exclude: [
      'tests/e2e/_acceptance/**',
      'tests/e2e/_shared/**',
      'tests/e2e/14-shared-harness-concurrency.e2e.test.ts',
    ],
    globals: false,
    reporters: ['verbose', new AcceptanceWallReporter()],
    // Each suite boots its own server + may invoke a real Ollama for
    // tens of seconds. Generous timeout, no parallelism (the per-file
    // spawn is the very thing that makes parallelism wasteful here —
    // each spawn already serializes ~60s of warmup).
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    poolOptions: {
      threads: { singleThread: true },
      forks: { singleFork: true },
    },
  },
});

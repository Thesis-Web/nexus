/**
 * vitest.e2e.config.ts — E2E v0.4.0 §4 — the wall config.
 *
 * Discovers tests/e2e/*.e2e.test.ts. Each test boots a real composition
 * root via tests/e2e/harness.ts; suites run sequentially (single thread)
 * because each one binds a server port + spawns a child process and
 * concurrency would race for fixtures.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.e2e.test.ts'],
    globals: false,
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

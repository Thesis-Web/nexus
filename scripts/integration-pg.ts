#!/usr/bin/env tsx
/**
 * pnpm test:integration:pg
 *
 * One-command end-to-end harness for the postgres-connector integration
 * suite. Brings the dev docker-compose Postgres pair up, waits for both
 * to report ready, runs the postgres integration tests with
 * NEXUS_INTEGRATION_PG=1, and tears the containers down on exit.
 *
 * Exits non-zero on any step failure. Designed to be safe to run
 * locally (CI invocation lives at ci:gate Step 80).
 *
 * Idempotent: if the containers are already up, we use them as-is and
 * leave them up after the run. If we brought them up, we tear them down.
 *
 * Required: docker (with the compose plugin) on PATH.
 */
import { spawn, spawnSync, type SpawnOptions } from 'node:child_process';

const COMPOSE = ['compose', '-f', 'infra/docker-compose.dev.yaml'];
const SF_CONTAINER = 'nexus-sales-finance';
const WH_CONTAINER = 'nexus-warehouse';
const READY_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 1_000;

function run(cmd: string, args: readonly string[], opts: SpawnOptions = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', ...opts });
    child.once('error', reject);
    child.once('close', code => resolve(code ?? 0));
  });
}

function exec(
  cmd: string,
  args: readonly string[]
): { code: number; stdout: string; stderr: string } {
  const r = spawnSync(cmd, args, { encoding: 'utf-8' });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function isContainerRunning(name: string): boolean {
  const r = exec('docker', ['inspect', '-f', '{{.State.Running}}', name]);
  return r.code === 0 && r.stdout.trim() === 'true';
}

function isContainerHealthy(name: string): boolean {
  const r = exec('docker', ['inspect', '-f', '{{.State.Health.Status}}', name]);
  return r.code === 0 && r.stdout.trim() === 'healthy';
}

async function waitUntilHealthy(name: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isContainerHealthy(name)) return;
    await new Promise(r => setTimeout(r, READY_POLL_MS));
  }
  throw new Error(`${name} did not become healthy within ${timeoutMs}ms`);
}

async function main(): Promise<void> {
  // Pre-flight: docker present?
  const dv = exec('docker', ['version', '--format', '{{.Server.Version}}']);
  if (dv.code !== 0) {
    console.error('[integration-pg] docker not reachable. Install docker and start the daemon.');
    process.exit(2);
  }
  console.log(`[integration-pg] docker server: ${dv.stdout.trim()}`);

  // Were the containers already running before we started?
  const ownsContainers = !(isContainerRunning(SF_CONTAINER) && isContainerRunning(WH_CONTAINER));
  if (ownsContainers) {
    console.log('[integration-pg] starting docker compose stack…');
    const upCode = await run('docker', [...COMPOSE, 'up', '-d']);
    if (upCode !== 0) {
      console.error('[integration-pg] docker compose up failed');
      process.exit(upCode);
    }
  } else {
    console.log('[integration-pg] containers already running — reusing');
  }

  // Wait for healthchecks
  console.log('[integration-pg] waiting for sales-finance + warehouse to report healthy…');
  try {
    await Promise.all([
      waitUntilHealthy(SF_CONTAINER, READY_TIMEOUT_MS),
      waitUntilHealthy(WH_CONTAINER, READY_TIMEOUT_MS),
    ]);
  } catch (err) {
    console.error(`[integration-pg] ${(err as Error).message}`);
    if (ownsContainers) await run('docker', [...COMPOSE, 'down']);
    process.exit(3);
  }
  console.log('[integration-pg] both DBs healthy');

  // Run the integration suite
  const env = { ...process.env, NEXUS_INTEGRATION_PG: '1' };
  console.log('[integration-pg] running: pnpm test:integration');
  const testCode = await run(
    'pnpm',
    ['exec', 'vitest', 'run', '--config', 'vitest.integration.config.ts'],
    { env }
  );

  // Teardown only if we brought the containers up
  if (ownsContainers) {
    console.log('[integration-pg] tearing down docker compose stack…');
    await run('docker', [...COMPOSE, 'down']);
  } else {
    console.log('[integration-pg] leaving containers up (they were already running)');
  }

  process.exit(testCode);
}

main().catch(err => {
  console.error('[integration-pg] fatal:', err);
  process.exit(1);
});

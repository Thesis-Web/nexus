#!/usr/bin/env tsx
/**
 * pnpm nexus:run
 *
 * Single-command Nexus dev/demo startup with deterministic process hygiene.
 *
 * Pattern mirrors scripts/integration-pg.ts (docker preflight, idempotent
 * compose-up, health-poll loop, child_process for substrates) but targets
 * the management API server rather than the integration test runner.
 *
 * Sequence:
 *   1. Kill any orphan nexus-main/vitest/probe/tsx-scripts processes left by
 *      prior sessions (the historical 484-orphan OOM situation must not recur).
 *   2. Bring up the dev docker compose stack (postgres pair) if docker is
 *      available. If docker is absent, log and continue — the server still
 *      starts; any DB-backed connector fails closed at registration.
 *   3. Spawn `nexus-main serve` detached, redirect stdout/stderr to
 *      runs/.nexus-server.log, write child PID to runs/.nexus-pid.
 *   4. Poll http://127.0.0.1:<port>/health until 200 OK or deadline.
 *
 * NOT a test harness. Tests own their own lifecycle (tests/e2e/harness.ts).
 *
 * Exit codes:
 *   0  ready
 *   3  postgres compose-up failed
 *   4  postgres did not report healthy in time
 *   5  nexus-main serve did not respond on /health in time
 *   6  unexpected error
 */
import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { mkdirSync, writeFileSync, openSync, existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

const COMPOSE = ['compose', '-f', 'infra/docker-compose.dev.yaml'];
const SF_CONTAINER = 'nexus-sales-finance';
const WH_CONTAINER = 'nexus-warehouse';
const PG_READY_TIMEOUT_MS = 60_000;
const HEALTH_TIMEOUT_MS = 45_000;
const POLL_INTERVAL_MS = 1_000;

const RUNS_DIR = path.resolve(process.cwd(), 'runs');
const PID_FILE = path.join(RUNS_DIR, '.nexus-pid');
const LOG_FILE = path.join(RUNS_DIR, '.nexus-server.log');
const PORT = parseInt(process.env['NEXUS_PORT'] ?? '7701', 10);
const HOST = '127.0.0.1';

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

function exec(
  cmd: string,
  args: readonly string[]
): { code: number; stdout: string; stderr: string } {
  const r = spawnSync(cmd, args, { encoding: 'utf-8' });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function dockerAvailable(): boolean {
  return exec('docker', ['version', '--format', '{{.Server.Version}}']).code === 0;
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
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`${name} did not become healthy within ${timeoutMs}ms`);
}

function runInherit(
  cmd: string,
  args: readonly string[],
  opts: SpawnOptions = {}
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', ...opts });
    child.once('error', reject);
    child.once('close', code => resolve(code ?? 0));
  });
}

/**
 * Kill orphans from prior sessions WITHOUT `pkill -f`. `pkill -f` matches its
 * own parent's argv (the pattern appears in the bash -c string) and race-kills
 * the cleanup itself. We walk `ps` output instead, exclude this process and
 * its parent, and signal survivors.
 */
async function killOrphansAsync(): Promise<{ found: number; killed: number }> {
  const myPid = process.pid;
  const myPpid = process.ppid;
  const patterns = ['nexus-main.ts serve', 'vitest', 'probe-', 'tsx scripts/'];

  const candidates = new Set<number>();
  const ps = exec('ps', ['-axo', 'pid=,args=']);
  if (ps.code !== 0) return { found: 0, killed: 0 };
  for (const line of ps.stdout.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(.*)$/);
    if (!m) continue;
    const pid = parseInt(m[1]!, 10);
    const args = m[2]!;
    if (pid === myPid || pid === myPpid) continue;
    if (args.includes('nexus-run.ts') || args.includes('nexus-stop.ts')) continue;
    for (const pat of patterns) {
      if (args.includes(pat)) {
        candidates.add(pid);
        break;
      }
    }
  }

  const found = candidates.size;
  if (found === 0) return { found: 0, killed: 0 };

  console.log(`[nexus:run] killing ${found} orphan process(es): ${[...candidates].join(', ')}`);
  for (const pid of candidates) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }

  const start = Date.now();
  while (Date.now() - start < 3_000) {
    let aliveCount = 0;
    for (const pid of candidates) {
      try {
        process.kill(pid, 0);
        aliveCount++;
      } catch {
        /* dead */
      }
    }
    if (aliveCount === 0) break;
    await sleep(200);
  }
  let killed = 0;
  for (const pid of candidates) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already dead */
    }
    killed++;
  }
  return { found, killed };
}

async function waitForHealth(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const url = `http://${HOST}:${port}/health`;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

function existingServerPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  try {
    const raw = readFileSync(PID_FILE, 'utf-8').trim();
    const pid = parseInt(raw, 10);
    if (!Number.isFinite(pid) || pid <= 0) return null;
    try {
      process.kill(pid, 0);
      return pid;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  mkdirSync(RUNS_DIR, { recursive: true });

  const cleanup = await killOrphansAsync();
  console.log(`[nexus:run] orphan cleanup: ${cleanup.found} found, ${cleanup.killed} killed`);

  const prior = existingServerPid();
  if (prior !== null) {
    console.log(`[nexus:run] prior server still running at pid=${prior}; sending SIGTERM`);
    try {
      process.kill(prior, 'SIGTERM');
      await sleep(3_000);
      try {
        process.kill(prior, 0);
        process.kill(prior, 'SIGKILL');
      } catch {
        /* dead */
      }
    } catch {
      /* already gone */
    }
  }

  if (dockerAvailable()) {
    console.log('[nexus:run] docker available — bringing up dev compose stack');
    const ownsContainers = !(isContainerRunning(SF_CONTAINER) && isContainerRunning(WH_CONTAINER));
    if (ownsContainers) {
      const up = await runInherit('docker', [...COMPOSE, 'up', '-d']);
      if (up !== 0) {
        console.error('[nexus:run] docker compose up failed');
        process.exit(3);
      }
    } else {
      console.log('[nexus:run] postgres containers already running — reusing');
    }
    console.log('[nexus:run] waiting for postgres healthchecks…');
    try {
      await Promise.all([
        waitUntilHealthy(SF_CONTAINER, PG_READY_TIMEOUT_MS),
        waitUntilHealthy(WH_CONTAINER, PG_READY_TIMEOUT_MS),
      ]);
    } catch (err) {
      console.error(`[nexus:run] ${(err as Error).message}`);
      process.exit(4);
    }
    console.log('[nexus:run] postgres pair healthy');
  } else {
    console.warn(
      '[nexus:run] docker unavailable — skipping dev compose stack. DB-backed connectors will fail closed at registration.'
    );
  }

  const logFd = openSync(LOG_FILE, 'a');
  const child: ChildProcess = spawn(
    'pnpm',
    ['exec', 'tsx', 'scripts/nexus-main.ts', 'serve', '--port', String(PORT)],
    {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env },
    }
  );
  if (typeof child.pid !== 'number') {
    console.error('[nexus:run] failed to spawn nexus-main serve');
    process.exit(6);
  }
  child.unref();
  writeFileSync(PID_FILE, String(child.pid), { mode: 0o600 });
  console.log(`[nexus:run] spawned nexus-main serve pid=${child.pid}; logs → ${LOG_FILE}`);

  const ok = await waitForHealth(PORT, HEALTH_TIMEOUT_MS);
  if (!ok) {
    console.error(
      `[nexus:run] /health did not respond within ${HEALTH_TIMEOUT_MS}ms — see ${LOG_FILE}`
    );
    process.exit(5);
  }

  console.log(`[nexus:run] READY — http://${HOST}:${PORT}/health pid=${child.pid}`);
}

main().catch(err => {
  console.error('[nexus:run] fatal:', err);
  process.exit(6);
});

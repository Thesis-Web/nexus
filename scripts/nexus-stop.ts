#!/usr/bin/env tsx
/**
 * pnpm nexus:stop
 *
 * Deterministic teardown for `pnpm nexus:run`. Counterpart to scripts/nexus-run.ts.
 *
 * Sequence:
 *   1. Read runs/.nexus-pid (if present), SIGTERM the child, wait 5s,
 *      SIGKILL any survivor.
 *   2. If docker is available, `docker compose stop` the dev stack.
 *      (Stop, not down — preserves volumes for fast next-startup.)
 *   3. Hunt and kill any remaining orphan nexus-main/vitest/probe/tsx-scripts
 *      processes — defensive sweep for anything spawned outside nexus:run.
 *   4. Remove runs/.nexus-pid.
 *
 * Always exits 0 unless something truly unrecoverable happens. Missing pid
 * file is normal (server was never started). Failed kills on dead pids are
 * normal too.
 *
 * Exit codes:
 *   0  clean shutdown (also covers "nothing was running")
 *   6  unexpected error
 */
import { spawn, spawnSync, type SpawnOptions } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import * as path from 'node:path';

const COMPOSE = ['compose', '-f', 'infra/docker-compose.dev.yaml'];
const RUNS_DIR = path.resolve(process.cwd(), 'runs');
const PID_FILE = path.join(RUNS_DIR, '.nexus-pid');
const GRACE_MS = 5_000;

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

function exec(cmd: string, args: readonly string[]): { code: number; stdout: string } {
  const r = spawnSync(cmd, args, { encoding: 'utf-8' });
  return { code: r.status ?? 1, stdout: r.stdout ?? '' };
}

function dockerAvailable(): boolean {
  return exec('docker', ['version', '--format', '{{.Server.Version}}']).code === 0;
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

async function stopServerByPidFile(): Promise<void> {
  if (!existsSync(PID_FILE)) {
    console.log('[nexus:stop] no pid file — server was not started by nexus:run');
    return;
  }
  let pid = 0;
  try {
    const raw = readFileSync(PID_FILE, 'utf-8').trim();
    pid = parseInt(raw, 10);
  } catch (err) {
    console.warn(`[nexus:stop] unreadable pid file: ${(err as Error).message}`);
  }
  if (!Number.isFinite(pid) || pid <= 0) {
    console.log('[nexus:stop] pid file invalid; skipping pid kill');
    return;
  }

  // probe alive
  let alive = false;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch {
    /* dead */
  }
  if (!alive) {
    console.log(`[nexus:stop] pid=${pid} already gone`);
    return;
  }

  console.log(`[nexus:stop] SIGTERM pid=${pid}`);
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    /* race */
  }
  const deadline = Date.now() + GRACE_MS;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      console.log(`[nexus:stop] pid=${pid} exited gracefully`);
      return;
    }
    await sleep(200);
  }
  console.log(`[nexus:stop] SIGKILL pid=${pid} (graceful window elapsed)`);
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* dead */
  }
}

/**
 * Defensive orphan sweep. Same /ps-walk pattern as nexus-run; never uses
 * pkill -f (which self-matches and race-kills the cleanup).
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

  console.log(`[nexus:stop] orphan sweep: ${found} found — ${[...candidates].join(', ')}`);
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

async function main(): Promise<void> {
  await stopServerByPidFile();

  if (dockerAvailable()) {
    console.log('[nexus:stop] docker available — stopping dev compose stack');
    await runInherit('docker', [...COMPOSE, 'stop']);
  } else {
    console.log('[nexus:stop] docker unavailable — nothing to stop');
  }

  const sweep = await killOrphansAsync();
  console.log(`[nexus:stop] orphan sweep: ${sweep.found} found, ${sweep.killed} signalled`);

  if (existsSync(PID_FILE)) {
    try {
      unlinkSync(PID_FILE);
    } catch (err) {
      console.warn(`[nexus:stop] could not remove pid file: ${(err as Error).message}`);
    }
  }

  console.log('[nexus:stop] clean');
}

main().catch(err => {
  console.error('[nexus:stop] fatal:', err);
  process.exit(6);
});

/**
 * tests/e2e/_shared/global-setup.ts — vitest globalSetup for the
 * shared single-server E2E harness (Phase 7 vertical slice).
 *
 * Boots ONE long-lived `pnpm nexus serve` subprocess before the wall
 * runs and tears it down after. The server hosts every persona, every
 * concurrent run, every NXS dispatch and NVG inference for the entire
 * wall — matching production deployment shape.
 *
 * Why this exists: the legacy isolated-mode harness spawns one server
 * per test file (~14 boots × 60s ollama warmup = ~14 minutes of pure
 * scaffolding cost per wall run). That pattern is correct for forensic
 * single-suite debugging but wrong for a wall pass — Nexus is built to
 * isolate concurrent users by construction (per-runId UUIDs, per-
 * (runId, actorId) mailbox storage, runId-keyed ledger filtering;
 * HL#8 proven by E2E-116). The shared harness exercises that
 * isolation for real.
 *
 * Contract (per vitest globalSetup):
 *   export async function setup() — returns the teardown function
 *
 * State exported via env (read by tests/e2e/harness.ts:bootHarness):
 *   NEXUS_E2E_BASE_URL    — http://127.0.0.1:<port>
 *   NEXUS_E2E_SERVER_CWD  — the shared tmpdir the server writes to
 *
 * Disk layout (one fresh tmpdir per wall run):
 *   <tmp>/keys     -> symlink to <repo>/keys
 *   <tmp>/config   -> symlink to <repo>/config
 *   <tmp>/fixtures -> symlink to <repo>/fixtures
 *   <tmp>/nexus.db                       (sqlite)
 *   <tmp>/nexus.ledger.jsonl             (infra ledger)
 *   <tmp>/runs/infra.run-ledger.jsonl    (run ledger — all runs)
 *   <tmp>/runs/mailbox/<runId>.jsonl     (per-run mailbox)
 *   <tmp>/runs/compile/*.jsonl           (compile output)
 *   <tmp>/runs/payloads/<uuid>/          (compile payloads)
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('global-setup: failed to bind a free port')));
      }
    });
  });
}

async function waitForHealth(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(baseUrl + '/health');
      if (res.ok) return;
    } catch {
      // server not up yet
    }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(
    `global-setup: shared Nexus server failed to become healthy within ${timeoutMs}ms at ${baseUrl}`
  );
}

let child: ChildProcess | null = null;
let sharedCwd: string | null = null;

export async function setup(): Promise<() => Promise<void>> {
  const repoRoot = process.cwd();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'nx-e2e-shared-'));

  // Symlink the read-only configuration the server needs. Keeping keys/
  // config/fixtures shared with the repo means the shared server sees
  // exactly the same seed registries + manifests as isolated-mode tests.
  for (const subdir of ['keys', 'config', 'fixtures']) {
    await fs.symlink(path.join(repoRoot, subdir), path.join(tmp, subdir), 'dir');
  }

  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  const env = {
    ...process.env,
    NEXUS_DB_PATH: path.join(tmp, 'nexus.db'),
    NEXUS_LEDGER_PATH: path.join(tmp, 'nexus.ledger.jsonl'),
    NEXUS_RUN_LEDGER_PATH: path.join(tmp, 'runs', 'infra.run-ledger.jsonl'),
    // Relocate compile-return so the post-compile self-callback reaches
    // the same server the run was opened on (port is dynamic).
    NEXUS_COMPILE_RETURN_BASE_URL: baseUrl,
  };
  // The infra run-ledger writer is lazy; create the parent dir up front
  // so the first event (workspace_vault_session_opened on the first
  // elevation) doesn't ENOENT and cascade into 400/403 across admin.
  await fs.mkdir(path.dirname(env.NEXUS_RUN_LEDGER_PATH), { recursive: true });

  // Boot the single shared server. `pnpm --dir <repoRoot>` keeps pnpm's
  // package.json resolver pointed at the repo while the spawned tsx
  // process inherits `tmp` as its cwd for relative-path resolution.
  child = spawn('pnpm', ['--dir', repoRoot, 'nexus', 'serve', '--port', String(port)], {
    cwd: tmp,
    env,
    stdio: process.env['NEXUS_E2E_SHARED_VERBOSE'] === '1' ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForHealth(baseUrl, 90_000);
  } catch (err) {
    if (child && !child.killed) child.kill('SIGTERM');
    throw err;
  }

  sharedCwd = tmp;
  process.env['NEXUS_E2E_BASE_URL'] = baseUrl;
  process.env['NEXUS_E2E_SERVER_CWD'] = tmp;

  // Vitest invokes the returned function once after the entire test
  // session finishes (or on abort).
  return async function teardown(): Promise<void> {
    if (child && !child.killed && child.exitCode === null) {
      await new Promise<void>(resolve => {
        const onExit = (): void => resolve();
        child!.once('exit', onExit);
        child!.kill('SIGTERM');
        setTimeout(() => {
          if (child && !child.killed && child.exitCode === null) child.kill('SIGKILL');
        }, 5000);
      });
    }
    // Best-effort tmpdir cleanup; the wall's ledger/mailbox jsonl
    // accumulates across the run and isn't needed once the wall
    // completes.
    if (sharedCwd !== null) {
      await fs.rm(sharedCwd, { recursive: true, force: true }).catch(() => undefined);
    }
    delete process.env['NEXUS_E2E_BASE_URL'];
    delete process.env['NEXUS_E2E_SERVER_CWD'];
    child = null;
    sharedCwd = null;
  };
}

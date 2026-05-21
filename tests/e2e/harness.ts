/**
 * tests/e2e/harness.ts — E2E v0.4.0 §4 — real composition-root harness.
 *
 * `bootHarness()` spawns the actual `pnpm nexus serve` process against a
 * fresh tmp cwd. Tests get a structured handle to log in as one of the
 * 10 ladder users, issue runs, wait for closure, and inspect the ledger.
 * No mocks — every gate (NXS pipeline, NVG, SigningCouncil, claim drift,
 * delegation mint, compile) runs for real.
 *
 * Per-suite isolation: each test FILE calls bootHarness() in beforeAll
 * and shutdown() in afterAll, picking a free port. Suites do not share
 * state.
 *
 * The harness uses Windows-interop-aware path resolution so tests run
 * from either WSL or a native Linux/Mac shell.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import type { UserLadderRole } from '../../scripts/seeds/user-ladder-seeds.js';

export interface RunPostBody {
  workspaceSocketId: string;
  promptMode: 'free_text' | 'sectioned' | 'secure_rails';
  prompt?: string;
  agents?: ReadonlyArray<string>;
  preferredEndpointId?: string;
  subTasks?: ReadonlyArray<unknown>;
  subTaskEdges?: ReadonlyArray<unknown>;
  outputContractTemplateId?: string;
}

export interface E2EHarness {
  readonly baseUrl: string;
  readonly cwd: string;
  shutdown(): Promise<void>;
  jwtFor(role: UserLadderRole | 'dev-admin'): Promise<string>;
  elevatedSessionFor(role: UserLadderRole | 'dev-admin', jwt: string): Promise<string>;
  createRun(jwt: string, body: RunPostBody): Promise<{ runId: string; planPreview: unknown }>;
  resolveCheckback(jwt: string, runId: string, allow: boolean): Promise<void>;
  waitForRunClosed(
    jwt: string,
    runId: string,
    opts?: { timeoutMs?: number }
  ): Promise<RunClosedSnapshot>;
  readLedger(
    runId: string
  ): Promise<ReadonlyArray<{ eventType: string; detail: Record<string, unknown> }>>;
  readMailboxItems(runId: string): Promise<ReadonlyArray<unknown>>;
}

export interface RunClosedSnapshot {
  readonly runId: string;
  readonly runClosed: boolean;
  readonly finalOutcome: string | null;
  readonly closeReason: string | null;
  readonly artifactBody: string | null;
  readonly ledgerEvents: ReadonlyArray<{ eventType: string; detail: Record<string, unknown> }>;
}

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
        srv.close(() => reject(new Error('no port')));
      }
    });
  });
}

/**
 * Read full events for a given runId from the infra run-ledger jsonl
 * (single file for all runs; entries carry runId for filtering). The
 * workspace HTTP run-status route exposes only event types — full detail
 * lives on disk and the harness reads it directly so tests can assert
 * against detail fields.
 */
async function readRunEvents(
  tmpCwd: string,
  runId: string
): Promise<Array<{ eventType: string; detail: Record<string, unknown> }>> {
  const filePath = path.join(tmpCwd, 'runs', 'infra.run-ledger.jsonl');
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map(
      line =>
        JSON.parse(line) as { runId?: string; eventType: string; detail?: Record<string, unknown> }
    )
    .filter(e => e.runId === runId)
    .map(e => ({ eventType: e.eventType, detail: e.detail ?? {} }));
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
  throw new Error(`harness: server failed to become healthy within ${timeoutMs}ms at ${baseUrl}`);
}

/**
 * Bring up the composition root in a fresh cwd. Copies the keys + lexicon
 * fixtures + policy bundle so the boot path finds everything; spawns
 * `pnpm nexus serve --port <N>` and waits for /health.
 */
export async function bootHarness(opts?: {
  /** Override timeout in ms (default 60_000 — ollama-warmup gives margin). */
  startupTimeoutMs?: number;
  /** Inherit-stdio if true; pipes to dev/null otherwise. */
  verbose?: boolean;
}): Promise<E2EHarness> {
  const repoRoot = process.cwd();
  const tmpCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'nx-e2e-'));
  // Symlink-clone the configuration the server needs. The composition
  // root reads CWD-relative paths for keys/, config/, fixtures/. We
  // need the test to have a separate sqlite + ledger jsonl so suites
  // don't interfere, but the keys + manifests can be shared with the
  // repo source.
  for (const subdir of ['keys', 'config', 'fixtures']) {
    await fs.symlink(path.join(repoRoot, subdir), path.join(tmpCwd, subdir), 'dir');
  }
  // Symlink the planner lexicon submodule too — its loader reads from
  // fixtures/planner/db-lexicon which is captured by the fixtures
  // symlink above.

  const port = await findFreePort();
  const env = {
    ...process.env,
    NEXUS_DB_PATH: path.join(tmpCwd, 'nexus.db'),
    NEXUS_LEDGER_PATH: path.join(tmpCwd, 'nexus.ledger.jsonl'),
    NEXUS_RUN_LEDGER_PATH: path.join(tmpCwd, 'runs', 'infra.run-ledger.jsonl'),
    // Relocate the signed compile-return manifest URL (default
    // `127.0.0.1:7701`) to this harness's dynamic port so the self-
    // callback after compile_assembly_complete reaches the same server
    // the run was opened on. The receiver still verifies the signed
    // request against the manifest's keyId — only the network origin is
    // rewritten, not auth or signature.
    NEXUS_COMPILE_RETURN_BASE_URL: `http://127.0.0.1:${port}`,
  };
  // The infra run ledger writer opens the file lazily and assumes its
  // parent directory exists — create it up front. Without this, the
  // first event (workspace_vault_session_opened on elevation verify)
  // fails ENOENT and cascades into 400/403 across the admin surface.
  await fs.mkdir(path.dirname(env.NEXUS_RUN_LEDGER_PATH), { recursive: true });

  // `pnpm nexus serve` resolves the `nexus` script from package.json.
  // Spawned from a fresh tmp cwd, `pnpm` would walk up looking for a
  // package.json and fail (ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND). Pass
  // `--dir <repoRoot>` so pnpm resolves the script against the repo's
  // package.json while the subprocess's working directory stays
  // tmpCwd (which is what gives each suite isolated keys/config/
  // fixtures via the symlinks above + isolated sqlite + ledger via the
  // env overrides below).
  const child: ChildProcess = spawn(
    'pnpm',
    ['--dir', repoRoot, 'nexus', 'serve', '--port', String(port)],
    {
      cwd: tmpCwd,
      env,
      stdio: opts?.verbose ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    }
  );

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForHealth(baseUrl, opts?.startupTimeoutMs ?? 60_000);
  } catch (err) {
    child.kill('SIGTERM');
    throw err;
  }

  async function loadApiKey(role: UserLadderRole | 'dev-admin'): Promise<string> {
    const p =
      role === 'dev-admin'
        ? path.join(repoRoot, 'keys', 'workspace-dev-admin.apikey')
        : path.join(repoRoot, 'keys', 'users', role + '.apikey');
    return (await fs.readFile(p, 'utf-8')).trim();
  }

  async function postJson<T>(p: string, jwt: string | null, body: unknown): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
    const res = await fetch(baseUrl + p, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { ok: boolean; data?: T; error?: string };
    if (!data.ok) {
      throw new Error(`harness: POST ${p} → ${res.status} ${data.error ?? 'unknown'}`);
    }
    return data.data as T;
  }

  async function getJson<T>(p: string, jwt: string): Promise<T> {
    const res = await fetch(baseUrl + p, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const data = (await res.json()) as { ok: boolean; data?: T; error?: string };
    if (!data.ok) {
      throw new Error(`harness: GET ${p} → ${res.status} ${data.error ?? 'unknown'}`);
    }
    return data.data as T;
  }

  async function shutdown(): Promise<void> {
    return new Promise(resolve => {
      const onExit = (): void => {
        // Best-effort tmpdir cleanup; ignore errors.
        void fs.rm(tmpCwd, { recursive: true, force: true }).then(() => resolve());
      };
      if (child.killed || child.exitCode !== null) {
        onExit();
        return;
      }
      child.once('exit', onExit);
      child.kill('SIGTERM');
      // Belt-and-suspenders: SIGKILL after 5s if SIGTERM didn't take.
      setTimeout(() => {
        if (!child.killed && child.exitCode === null) child.kill('SIGKILL');
      }, 5000);
    });
  }

  return {
    baseUrl,
    cwd: tmpCwd,
    shutdown,
    async jwtFor(role) {
      const apiKey = await loadApiKey(role);
      const data = await postJson<{ token: string }>('/workspace/auth/login', null, {
        type: 'api_key',
        value: apiKey,
      });
      return data.token;
    },
    async elevatedSessionFor(role, jwt) {
      // Look up the actor's principalId via /workspace/me, run the
      // challenge → verify cycle with the same API key as proof.
      const me = await getJson<{ principalId: string }>('/workspace/me', jwt);
      const apiKey = await loadApiKey(role);
      const chal = await postJson<{ challengeId: string }>('/workspace/vault/auth', jwt, {
        action: 'challenge',
        principalId: me.principalId,
        method: 'api_key_reauth',
      });
      const verified = await postJson<{ elevatedSessionId: string }>('/workspace/vault/auth', jwt, {
        action: 'verify',
        principalId: me.principalId,
        method: 'api_key_reauth',
        challengeId: chal.challengeId,
        response: apiKey,
      });
      return verified.elevatedSessionId;
    },
    async createRun(jwt, body) {
      return postJson<{ runId: string; planPreview: unknown }>('/workspace/runs', jwt, body);
    },
    async resolveCheckback(jwt, runId, allow) {
      await postJson<unknown>(`/workspace/runs/${encodeURIComponent(runId)}/checkback`, jwt, {
        decision: allow ? 'allow' : 'deny',
      });
    },
    async waitForRunClosed(jwt, runId, opts2): Promise<RunClosedSnapshot> {
      // The workspace run-status route only returns { status, eventCount,
      // eventTypes, lastEvent, rejection? } — the full event detail isn't
      // exposed by HTTP. To synthesize a RunClosedSnapshot we (1) poll
      // until status=='closed' (or the run is terminally rejected), then
      // (2) read full events from the infra run-ledger jsonl on disk
      // (single file for all runs, filtered by runId).
      const timeoutMs = opts2?.timeoutMs ?? 90_000;
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        try {
          const snap = await getJson<{
            status?: 'open' | 'closed';
            eventTypes?: ReadonlyArray<string>;
            rejection?: { reason: string; reasonDetail: string };
          }>(`/workspace/runs/${encodeURIComponent(runId)}`, jwt);
          const types = snap.eventTypes ?? [];
          // Closed via run_closed, or terminally rejected by the planner
          // (rejection means no further events will fire).
          const isRejected = !!snap.rejection || types.includes('plan_rejected');
          if (snap.status === 'closed' || isRejected) {
            const ledgerEvents = await readRunEvents(tmpCwd, runId);
            const closeEvent = ledgerEvents.find(e => e.eventType === 'run_closed');
            const rejectEvent = ledgerEvents.find(e => e.eventType === 'plan_rejected');
            const closeReason = closeEvent
              ? ((closeEvent.detail['closeReason'] as string | undefined) ?? null)
              : rejectEvent
                ? 'plan_rejected'
                : null;
            const finalOutcome = closeEvent
              ? ((closeEvent.detail['finalOutcome'] as string | undefined) ?? null)
              : null;
            return {
              runId,
              runClosed: snap.status === 'closed',
              finalOutcome,
              closeReason,
              artifactBody: null,
              ledgerEvents,
            };
          }
        } catch {
          // Run record may not yet exist; keep polling.
        }
        await new Promise(r => setTimeout(r, 500));
      }
      // Final read so the timeout error carries diagnostic context.
      let lastTypes: ReadonlyArray<string> = [];
      try {
        const ev = await readRunEvents(tmpCwd, runId);
        lastTypes = ev.map(e => e.eventType);
      } catch {
        // ignore
      }
      throw new Error(
        `harness: run ${runId} did not close within ${timeoutMs}ms; last ledger events: ${JSON.stringify(lastTypes)}`
      );
    },
    async readLedger(runId) {
      return readRunEvents(tmpCwd, runId);
    },
    async readMailboxItems(runId) {
      const filePath = path.join(tmpCwd, 'runs', 'mailbox', runId + '.jsonl');
      try {
        const raw = await fs.readFile(filePath, 'utf-8');
        return raw
          .split(/\r?\n/)
          .filter(Boolean)
          .map(line => JSON.parse(line));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw err;
      }
    },
  };
}

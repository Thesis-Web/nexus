/**
 * HOLE-LIFECYCLE-001 — workspace owns terminal run lifecycle.
 *
 * Canonical law (component outline §3 + §HL #4):
 *   - Workspace is the only authorized user entry point.
 *   - runId is assigned at workspace ingress; `run_opened` is written there.
 *   - The orchestrator is a plug-and-play package; it MAY emit operational
 *     events (plan_*, node_*, dag_*, compile_*, final_response,
 *     planner_infeasible, user_cancelled_run) inside its coordination scope
 *     but MUST NOT write `run_closed` or otherwise own terminal authority.
 *   - The workspace writes the canonical `run_closed` based on the typed
 *     `RunOrchestrationTerminal` returned by `Orchestrator.dispatch` —
 *     unless the terminal kind is `compile_dispatched` (compile-return
 *     delivery path writes the close) or `planner_infeasible` (the run
 *     stays OPEN until the user explicitly cancels via the workspace).
 *
 * This test stands up the live workspace Express route with an injected
 * `dispatchToOrchestrator` stub that returns a chosen `OrchestratorDispatchResult`
 * and verifies the ledger close that the workspace writes carries the
 * canonical machine-typed fields with `closedBy === 'workspace'`.
 *
 * Each canonical-machine-field assertion is keyed to the v3 owner directive:
 *   - closeReason (canonical machine string)
 *   - finalOutcome (canonical machine string)
 *   - closedBy === 'workspace'
 *   - human detail, if present, in closeReasonDetail (NOT closeReason)
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createHash } from 'node:crypto';
import { registerWorkspaceRoutes } from '../../packages/interfaces/api/src/routes/workspace.js';
import type {
  AuthCredentials,
  IdentityClaims,
  IdentityProviderInterface,
  NonEmpty,
  OrchestratorDispatchResult,
  OrchestratorPlanPreview,
  RunLedgerEntry,
  RunLedgerWriter,
  RunOrchestrationTerminalKind,
  Sha256Hex,
  Uuid,
  WorkspaceManifestRecord,
  WorkspaceRunRequest,
  WorkspaceSession,
  WorkspaceSessionStorePort,
} from '@nexus/contracts';

const TEST_JWT_SECRET = 'lifecycle-ownership-integration-test-secret';
const TEST_PRINCIPAL = '11111111-1111-1111-1111-111111111111';
const TEST_ACTOR = '22222222-2222-2222-2222-222222222222' as Uuid;
const CHAT_AGENT_ID = '00000000-0000-4000-a000-000000000004' as Uuid;

const GOVERNED_WORKSPACE: WorkspaceManifestRecord = {
  workspaceSocketId: 'reference-workspace' as NonEmpty,
  workspaceType: 'reference_http' as NonEmpty,
  enabled: true,
  entryMode: 'governed_only',
  baseUrl: 'http://localhost:4100' as NonEmpty,
  returnEndpointId: 'reference-workspace-return' as NonEmpty,
  capabilities: { promptEntry: true, planReview: true, finalDisplay: true, fileSpace: false },
  configuration: {},
};

function inMemorySessionStore(): WorkspaceSessionStorePort {
  const sessions = new Map<string, WorkspaceSession>();
  return {
    create: session => {
      sessions.set(session.workspaceAuthSessionId, session);
    },
    get: sid => sessions.get(sid) ?? null,
    revoke: sid => {
      sessions.delete(sid);
    },
  };
}

function ledgerWriter(): RunLedgerWriter & { events: Array<Omit<RunLedgerEntry, 'entryId'>> } {
  const events: Array<Omit<RunLedgerEntry, 'entryId'>> = [];
  return {
    events,
    writeEvent: async entry => {
      events.push(entry);
    },
    getByRunId: async () => [],
    tail: async () => [],
    getLatestRunId: async () => null,
  };
}

function identityProvider(): IdentityProviderInterface {
  return {
    providerType: 'reference_adapter',
    providerVersion: '1.0.0' as NonEmpty,
    authenticate: async (_: AuthCredentials) => TEST_ACTOR as NonEmpty,
    resolveIdentity: async (): Promise<IdentityClaims> => ({
      principalIdentity: TEST_PRINCIPAL as NonEmpty,
      roleAssignments: ['user'] as NonEmpty[],
      capabilityCeilings: [
        { allowedSystems: ['*'], allowedCapabilities: ['*'], maxRiskTier: 'critical' },
      ],
      environmentContext: 'reference' as NonEmpty,
      actorClass: 'HUMAN',
    }),
  };
}

function computeDigest(obj: unknown): Sha256Hex {
  return createHash('sha256').update(JSON.stringify(obj), 'utf-8').digest('hex') as Sha256Hex;
}

function fakePreview(runId: Uuid): OrchestratorPlanPreview {
  return {
    runId,
    orchestratorSocketId: 'fake-orch' as NonEmpty,
    orchestratorActorId: TEST_ACTOR,
    plannerMode: 'deterministic',
    selectedAgents: [],
    requiresUserApproval: false,
    planDigest: computeDigest({ runId }),
    plan: null,
    rejection: null,
  };
}

interface Harness {
  baseUrl: string;
  token: string;
  setTerminal: (terminal: RunOrchestrationTerminalKind | 'none') => void;
  /** Dispatch invocations per runId — proves the workspace calls
   *  `dispatchToOrchestrator` exactly once per POST /workspace/runs, which
   *  guards against a regression where the refactored route accidentally
   *  re-runs orchestration (and thus NXS actions, model calls, ledger
   *  events, side effects) on the same request. */
  dispatchInvocations: Map<string, number>;
  ledger: ReturnType<typeof ledgerWriter>;
  close: () => Promise<void>;
}

async function startHarness(): Promise<Harness> {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  const ledger = ledgerWriter();
  const dispatchInvocations = new Map<string, number>();
  let activeTerminal: RunOrchestrationTerminalKind | 'none' = 'none';

  const dispatchToOrchestrator = async (
    request: WorkspaceRunRequest
  ): Promise<OrchestratorDispatchResult> => {
    dispatchInvocations.set(request.runId, (dispatchInvocations.get(request.runId) ?? 0) + 1);
    const preview = fakePreview(request.runId);
    if (activeTerminal === 'none') {
      return { preview, terminal: null };
    }
    return {
      preview,
      terminal: { kind: activeTerminal },
    };
  };

  registerWorkspaceRoutes(app, {
    runLedgerWriter: ledger,
    identityProvider: identityProvider(),
    workspaceSockets: [GOVERNED_WORKSPACE],
    computeDigest,
    workspaceJwtSecret: TEST_JWT_SECRET,
    workspaceSessionStore: inMemorySessionStore(),
    dispatchToOrchestrator: dispatchToOrchestrator as unknown as (
      r: WorkspaceRunRequest
    ) => Promise<unknown>,
  });

  const server: Server = await new Promise(resolve => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const loginRes = await fetch(`${baseUrl}/workspace/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'api_key', value: 'lifecycle-ownership-test-key' }),
  });
  const loginBody = (await loginRes.json()) as { ok: boolean; data?: { token: string } };
  if (!loginBody.ok || !loginBody.data) {
    throw new Error(`login failed: ${JSON.stringify(loginBody)}`);
  }
  const token = loginBody.data.token;

  return {
    baseUrl,
    token,
    setTerminal: (kind: RunOrchestrationTerminalKind | 'none') => {
      activeTerminal = kind;
    },
    dispatchInvocations,
    ledger,
    close: () =>
      new Promise<void>((resolve, reject) => server.close(err => (err ? reject(err) : resolve()))),
  };
}

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  if (harness) await harness.close();
});

async function postRun(): Promise<{ runId: string }> {
  const res = await fetch(`${harness.baseUrl}/workspace/runs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${harness.token}`,
    },
    body: JSON.stringify({
      promptMode: 'free_text',
      prompt: 'lifecycle-ownership test',
      agents: [CHAT_AGENT_ID],
    }),
  });
  const json = (await res.json()) as {
    ok: boolean;
    data?: { runId: string };
    error?: string;
  };
  if (!json.ok || !json.data) {
    throw new Error(`postRun failed: ${JSON.stringify(json)}`);
  }
  return { runId: json.data.runId };
}

function eventsForRun(runId: string): Array<Omit<RunLedgerEntry, 'entryId'>> {
  return harness.ledger.events.filter(e => e.runId === runId);
}

function closeEventForRun(runId: string): Omit<RunLedgerEntry, 'entryId'> | undefined {
  return eventsForRun(runId).find(e => e.eventType === 'run_closed');
}

describe('HOLE-LIFECYCLE-001 — workspace owns canonical run_closed', () => {
  it('terminal=no_compile_inputs → workspace writes closeReason=compile_not_applicable, finalOutcome=no_eligible_results, closedBy=workspace', async () => {
    harness.setTerminal('no_compile_inputs');
    const { runId } = await postRun();

    const close = closeEventForRun(runId);
    expect(close, 'workspace must write run_closed for no_compile_inputs').toBeDefined();
    const d = close!.detail;
    expect(d['closeReason']).toBe('compile_not_applicable');
    expect(d['finalOutcome']).toBe('no_eligible_results');
    expect(d['closedBy']).toBe('workspace');
    expect(d['terminalKind']).toBe('no_compile_inputs');
  });

  it('terminal=executor_error → workspace writes closeReason=error, finalOutcome=error, closedBy=workspace', async () => {
    harness.setTerminal('executor_error');
    const { runId } = await postRun();

    const close = closeEventForRun(runId);
    expect(close, 'workspace must write run_closed for executor_error').toBeDefined();
    const d = close!.detail;
    expect(d['closeReason']).toBe('error');
    expect(d['finalOutcome']).toBe('error');
    expect(d['closedBy']).toBe('workspace');
    expect(d['terminalKind']).toBe('executor_error');
  });

  it('terminal=user_cancelled_plan → workspace writes closeReason=user_cancelled, finalOutcome=cancelled, closedBy=workspace', async () => {
    harness.setTerminal('user_cancelled_plan');
    const { runId } = await postRun();

    const close = closeEventForRun(runId);
    expect(close).toBeDefined();
    const d = close!.detail;
    expect(d['closeReason']).toBe('user_cancelled');
    expect(d['finalOutcome']).toBe('cancelled');
    expect(d['closedBy']).toBe('workspace');
    expect(d['terminalKind']).toBe('user_cancelled_plan');
  });

  it('terminal=user_cancelled_during_run → workspace writes closeReason=user_cancelled, finalOutcome=cancelled, closedBy=workspace', async () => {
    harness.setTerminal('user_cancelled_during_run');
    const { runId } = await postRun();

    const close = closeEventForRun(runId);
    expect(close).toBeDefined();
    const d = close!.detail;
    expect(d['closeReason']).toBe('user_cancelled');
    expect(d['finalOutcome']).toBe('cancelled');
    expect(d['closedBy']).toBe('workspace');
    expect(d['terminalKind']).toBe('user_cancelled_during_run');
  });

  it('terminal=compile_dispatched → workspace does NOT close (compile-return delivery path owns close)', async () => {
    harness.setTerminal('compile_dispatched');
    const { runId } = await postRun();

    const close = closeEventForRun(runId);
    expect(close, 'workspace must NOT write run_closed for compile_dispatched').toBeUndefined();
    // The run still opened (workspace ingress).
    const open = eventsForRun(runId).find(e => e.eventType === 'run_opened');
    expect(open).toBeDefined();
  });

  it('terminal=planner_infeasible → workspace does NOT close (run stays OPEN until user cancels)', async () => {
    harness.setTerminal('planner_infeasible');
    const { runId } = await postRun();

    const close = closeEventForRun(runId);
    expect(
      close,
      'workspace must NOT auto-close on planner_infeasible — HL#4 requires user cancel'
    ).toBeUndefined();
    const open = eventsForRun(runId).find(e => e.eventType === 'run_opened');
    expect(open).toBeDefined();
  });

  it('terminal=null (custom orch with no terminal) → workspace does NOT close', async () => {
    harness.setTerminal('none');
    const { runId } = await postRun();

    const close = closeEventForRun(runId);
    expect(
      close,
      'workspace must not invent a close when the orch reports no terminal'
    ).toBeUndefined();
  });

  // HOLE-LIFECYCLE-001 regression guard: prove the workspace invokes
  // `dispatchToOrchestrator` exactly once per POST /workspace/runs across
  // every terminal kind. A double-dispatch would silently duplicate every
  // run-coordinator side effect — NXS pipeline actions, NVG model calls,
  // delegation issuance, mailbox writes, ledger operational events — and
  // typecheck cannot catch it. This test pins the boundary.
  describe('dispatch-call-count invariant', () => {
    const allKinds: Array<RunOrchestrationTerminalKind | 'none'> = [
      'compile_dispatched',
      'no_compile_inputs',
      'executor_error',
      'user_cancelled_plan',
      'user_cancelled_during_run',
      'planner_infeasible',
      'none',
    ];
    for (const kind of allKinds) {
      it(`terminal=${kind} → dispatchToOrchestrator called exactly once`, async () => {
        harness.setTerminal(kind);
        const { runId } = await postRun();
        const count = harness.dispatchInvocations.get(runId) ?? 0;
        expect(
          count,
          `workspace must call dispatchToOrchestrator exactly once per request; observed ${count} for terminal=${kind}`
        ).toBe(1);
      });
    }
  });
});

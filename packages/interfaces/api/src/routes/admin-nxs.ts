/**
 * Admin NXS Test Route — CLAUDE-CODE-NXS-WIRE-PHASE-B §2.
 *
 * File: packages/interfaces/api/src/routes/admin-nxs.ts
 * Layer 7 — workspace-attached admin route that submits a synthetic
 * AgentAction through the runtime NXS pipeline (the 7-gate authority
 * chain Identity → Classification → Delegation → Policy → Approval →
 * Execution → Evidence). Phase B brings that chain online; Phase B+
 * will reach it from real adapters.
 *
 * Auth: same chain as admin-writer/admin-ledger — workspace JWT +
 * nexus-admin role + X-Elevated-Session.
 *
 * Test action lifecycle:
 *   1. Resolve the target agent (Actor) from the registry.
 *   2. Resolve its registering principal.
 *   3. Mint an EPHEMERAL root delegation from that principal to the
 *      agent, scoped to the requested tool's system. Stored in the
 *      same delegationStore the pipeline reads from so Gate 03 can
 *      verify the chain.
 *   4. Create an EPHEMERAL session bound to that delegation so Gate 01
 *      finds an active session at processing time.
 *   5. Build the AgentAction envelope and hand it to dispatchToNxs.
 *      The dispatcher takes care of the §22.5 bypass annotation, the
 *      nxs_action ledger event, and the evidence record.
 *
 * Ephemeral state: the session+delegation TTLs are bounded so admin
 * test actions don't leak long-lived authority. Failed dispatches
 * still emit evidence — Gate 07 always runs.
 *
 * Import law: Layer 7 — @nexus/contracts only, plus local route
 * helpers. mintRootDelegation, the stores, and dispatchToNxs are
 * injected via DI from the composition root.
 */
import { randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import type {
  ActorRegistry,
  AgentAction,
  DelegationContext,
  DelegationStore,
  ElevatedAuthProvider,
  NonEmpty,
  PipelineResult,
  Principal,
  PrincipalRegistry,
  Session,
  SessionStoreInterface,
  Uuid,
  Actor,
} from '@nexus/contracts';
import { addSeconds, nowIso, riskTierExceeds } from '@nexus/contracts';
import { checkAdminAuth, type AdminAuthDeps } from './admin-auth.js';
import { san } from './shared.js';

/** Pipeline-side delegation parameters extracted from the agent + principal. */
interface MintRootDelegationParams {
  principalId: string;
  actorId: string;
  allowedSystems: string[];
  allowedCapabilities: string[];
  forbiddenCapabilities: string[];
  maxRiskTier: string;
  allowDownstreamPropagation: boolean;
  environment: string;
  expiresAt: string;
  maxChainDepth: number;
}

export interface AdminNxsRouteDeps extends AdminAuthDeps {
  readonly dispatchToNxs?: (input: {
    rawAction: Omit<AgentAction, 'delegationSequence'>;
    runId: Uuid;
    bracketRun?: {
      runOpenDetail: Record<string, unknown>;
    };
  }) => Promise<PipelineResult>;
  readonly actorRegistry?: ActorRegistry;
  readonly principalRegistry?: PrincipalRegistry;
  readonly sessionStore?: SessionStoreInterface;
  readonly delegationStore?: DelegationStore;
  /**
   * Mints a signed root delegation. Same shape the orchestrator uses for
   * per-run delegations; threaded through DI rather than imported so the
   * route file stays @nexus/contracts-only.
   */
  readonly mintRootDelegation?: (
    principal: Principal,
    actor: Actor,
    params: MintRootDelegationParams
  ) => Promise<DelegationContext>;
  /**
   * Optional elevated-auth provider — admin-auth.ts already requires it
   * via AdminAuthDeps; declared again here for readability.
   */
  readonly elevatedAuthProvider?: ElevatedAuthProvider;
}

/** Default TTLs for ephemeral test session + delegation (10 minutes). */
const TEST_SESSION_TTL_SECONDS = 10 * 60;

interface TestActionBody {
  tool: string;
  verb: string;
  target: string;
  intent: string;
  agentId: string;
}

function parseBody(
  raw: unknown
): { ok: true; body: TestActionBody } | { ok: false; error: string } {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, error: 'JSON object body required' };
  }
  const r = raw as Record<string, unknown>;
  const fields = ['tool', 'verb', 'target', 'intent', 'agentId'] as const;
  const out: Record<string, string> = {};
  for (const k of fields) {
    const v = r[k];
    if (typeof v !== 'string' || v.length === 0) {
      return { ok: false, error: `field "${k}" must be a non-empty string` };
    }
    out[k] = v;
  }
  return {
    ok: true,
    body: {
      tool: out['tool']!,
      verb: out['verb']!,
      target: out['target']!,
      intent: out['intent']!,
      agentId: out['agentId']!,
    },
  };
}

export function registerAdminNxsRoutes(app: Express, deps: AdminNxsRouteDeps): void {
  app.post('/workspace/admin/nxs/test-action', async (req: Request, res: Response) => {
    const auth = await checkAdminAuth(req, res, deps);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }

    if (
      !deps.dispatchToNxs ||
      !deps.actorRegistry ||
      !deps.principalRegistry ||
      !deps.sessionStore ||
      !deps.delegationStore ||
      !deps.mintRootDelegation
    ) {
      res.status(501).json({ ok: false, error: 'NXS dispatch not configured' });
      return;
    }

    const parsed = parseBody(req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, error: parsed.error });
      return;
    }
    const body = parsed.body;

    try {
      // 1. Look up the target agent.
      const actor = await deps.actorRegistry.get(body.agentId as Uuid);
      if (!actor) {
        res.status(404).json({ ok: false, error: `Agent not found: ${body.agentId}` });
        return;
      }
      // 2. Look up the actor's registering principal.
      const principal = await deps.principalRegistry.get(actor.principalId);
      if (!principal) {
        res.status(404).json({
          ok: false,
          error: `Principal not found: ${actor.principalId} (registered the agent)`,
        });
        return;
      }

      // 3. Mint an ephemeral root delegation. Risk ceiling = lesser of
      //    the actor's ceiling and the principal's max delegable tier so
      //    the test never escapes governance bounds. allowedSystems is
      //    intersected so we don't grant authority over a system the
      //    principal can't delegate. Both registries already passed the
      //    no-wildcard manifests check at bootstrap.
      const effectiveSystems = actor.allowedSystems.filter(s =>
        principal.allowedSystems.includes(s)
      );
      const effectiveCapabilities = actor.allowedCapabilities ?? [];
      const effectiveRiskTier = riskTierExceeds(actor.riskCeiling, principal.maxDelegableRiskTier)
        ? principal.maxDelegableRiskTier
        : actor.riskCeiling;
      const delegation = await deps.mintRootDelegation(principal, actor, {
        principalId: principal.principalId,
        actorId: actor.actorId,
        allowedSystems: effectiveSystems,
        allowedCapabilities: effectiveCapabilities,
        forbiddenCapabilities: [],
        maxRiskTier: effectiveRiskTier,
        allowDownstreamPropagation: false,
        environment: actor.environment,
        expiresAt: addSeconds(nowIso(), TEST_SESSION_TTL_SECONDS),
        maxChainDepth: 1,
      });
      await deps.delegationStore.save(delegation);

      // 4. Ephemeral session bound to that delegation. Gate 01 looks
      //    sessions up by sessionId, so we generate a fresh UUID.
      const sessionId = randomUUID() as Uuid;
      const session: Session = {
        sessionId,
        actorId: actor.actorId,
        principalId: principal.principalId,
        delegationId: delegation.delegationId,
        createdAt: nowIso(),
        expiresAt: addSeconds(nowIso(), TEST_SESSION_TTL_SECONDS),
      };
      await deps.sessionStore.create(session);

      // 5. Build the action envelope. delegationSequence is filled by
      //    the pipeline (`Pick<AgentAction, ...>` excludes it).
      const runId = randomUUID() as Uuid;
      const rawAction: Omit<AgentAction, 'delegationSequence'> = {
        actionId: randomUUID() as Uuid,
        runId,
        receivedAt: nowIso(),
        protocol: 'admin-nxs-test/v0.1.0' as NonEmpty,
        adapterVersion: 'admin-test-route/v1' as NonEmpty,
        actorId: actor.actorId,
        principalId: principal.principalId,
        sessionId,
        delegationId: delegation.delegationId,
        tool: body.tool as NonEmpty,
        rawVerb: body.verb as NonEmpty,
        rawTarget: body.target as NonEmpty,
        rawPayload: { intent: body.intent },
        intent: {
          objectiveSummary: body.intent as NonEmpty,
          triggeringSource: 'admin-nxs-test' as NonEmpty,
          toolchainContext: 'workspace-admin' as NonEmpty,
          modelId: null,
          modelConfidence: null,
          riskNote: null,
          extractedAt: nowIso(),
        },
        resolvedVerb: null,
        resolvedCapability: null,
        resolvedTarget: null,
        resolvedDataClasses: [],
        resolvedRiskTier: null,
      };

      // 6. Dispatch through NXS. The dispatcher (composition root) writes
      //    run_opened, bypass_annotation, nxs_action, and run_closed when
      //    we pass `bracketRun` — keeping run_closed writes out of the
      //    routes layer so EXT-12 (OCT-SECURE-LOOP) stays clean.
      const result = await deps.dispatchToNxs({
        rawAction,
        runId,
        bracketRun: {
          runOpenDetail: {
            origin: 'admin-nxs-test',
            adminPrincipalId: auth.principalId,
            agentId: actor.actorId,
            tool: body.tool,
            verb: body.verb,
            target: body.target,
          },
        },
      });
      const evidence = result.evidenceRecord;

      // 7. Return the gate-decision summary so the admin sees exactly
      //    which gate denied (or allowed) the action.
      res.json({
        ok: true,
        data: {
          runId,
          actionId: rawAction.actionId,
          outcome: evidence.finalOutcome,
          disposition: result.disposition,
          evidenceRecordId: evidence.recordId,
          ledgerSequence: evidence.ledgerSequence,
          policyOutcome: evidence.policyOutcome,
          policyRuleId: evidence.policyRuleId,
          gateDecisions: evidence.gateDecisions.map(g => ({
            gateId: g.gateId,
            gateOrder: g.gateOrder,
            plane: g.plane,
            outcome: g.outcome,
            denialCode: g.denialCode,
            reason: g.reason,
          })),
        },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[admin-nxs] test-action error:', err);
      res.status(500).json({ ok: false, error: san(err) });
    }
  });
}

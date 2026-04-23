/**
 * Gate 01 — Identity — spec §13.2
 * Resolves actor, session, principal. Enforces expiry. Non-human registry completeness.
 * SOLVE-011: SessionStore.get() returns regardless of expiry. Gate 01 owns expiry check.
 *
 * HOLE-002 extension (owner-approved):
 * Gate 01 is the sole canonical resolver of the identity tuple:
 *   Actor | Principal | Session | DelegationContext
 * DelegationStore is injected here. Gate 01 loads delegationContext by
 * action.delegationId and writes it into context before downstream gates run.
 * Lookup miss is a governed denial (CHAIN_INTEGRITY_BROKEN) — Gate 07 still writes evidence.
 *
 * PipelineContext.actor, .principal, .delegationContext are optional at process entry.
 * This gate populates all three. Downstream gates use non-null assertions (!) with
 * the invariant that Gate 01 passed if they are executing.
 *
 * Spec: nexus-engineering-spec-v1-8-26.md §11.1, §13.2
 * Blueprint: nexus-blueprint-v1-4-12.md §5.1, §5.4, §8.1
 */
import {
  GATE_ID,
  ACTOR_CLASS,
  DENIAL_CODE,
  type Gate,
  type GateResult,
  type AgentAction,
  type PipelineContext,
  type GateDecision,
  type DelegationStore,
} from '../types/index.js';
import type { ActorRegistry } from '../types/index.js';
import type { SessionStoreInterface } from '../types/index.js';
import type { PrincipalRegistry } from '../types/index.js';

function gateDeny(code: string, reason: string, startMs: number): GateResult {
  return {
    decision: {
      gateId: GATE_ID.G01,
      gateOrder: 1,
      plane: 'control',
      outcome: 'deny',
      reason,
      denialCode: code,
      policyRuleId: null,
      evaluatedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs,
      metadata: {},
    },
  };
}

export class IdentityGate implements Gate {
  readonly gateId = GATE_ID.G01;
  readonly gateOrder = 1;
  readonly plane = 'control' as const;

  constructor(
    private readonly actorRegistry: ActorRegistry,
    private readonly sessionStore: SessionStoreInterface,
    private readonly principalRegistry: PrincipalRegistry,
    private readonly delegationStore: DelegationStore // HOLE-002
  ) {}

  async evaluate(
    action: AgentAction,
    context: PipelineContext,
    _prior: GateDecision[]
  ): Promise<GateResult> {
    const startMs = Date.now();

    const actor = await this.actorRegistry.get(action.actorId);
    if (!actor) return gateDeny(DENIAL_CODE.ACTOR_NOT_REGISTERED, 'actor not registered', startMs);

    // SessionStore.get() returns the record regardless of expiry — Gate 01 owns expiry semantics.
    const session = await this.sessionStore.get(action.sessionId);
    if (!session) return gateDeny(DENIAL_CODE.SESSION_NOT_FOUND, 'session not found', startMs);
    if (new Date(session.expiresAt) <= new Date()) {
      return gateDeny(DENIAL_CODE.SESSION_EXPIRED, 'session expired', startMs);
    }

    const principal = await this.principalRegistry.get(action.principalId);
    if (!principal)
      return gateDeny(DENIAL_CODE.PRINCIPAL_NOT_RESOLVABLE, 'principal not resolvable', startMs);
    if (actor.principalId !== principal.principalId) {
      return gateDeny(DENIAL_CODE.ACTOR_PRINCIPAL_MISMATCH, 'actor/principal mismatch', startMs);
    }

    const isNonHuman =
      actor.actorClass !== ACTOR_CLASS.HUMAN && actor.actorClass !== ACTOR_CLASS.HUMAN_WITH_COPILOT;
    if (isNonHuman && (!actor.owner || !actor.purpose || !actor.reviewCadence)) {
      return gateDeny(
        DENIAL_CODE.NON_HUMAN_ACTOR_INCOMPLETE,
        'non-human actor registry incomplete',
        startMs
      );
    }

    // HOLE-002: resolve delegationContext — Gate 01 is the canonical owner.
    // On miss: governed denial (CHAIN_INTEGRITY_BROKEN) — pipeline still routes to Gate 07.
    const delegationContext = await this.delegationStore.getById(action.delegationId);
    if (!delegationContext) {
      return gateDeny(
        DENIAL_CODE.CHAIN_INTEGRITY_BROKEN,
        'delegation context not found in store',
        startMs
      );
    }

    // Write the full identity tuple into context — downstream gates use non-null assertions.
    context.actor = actor;
    context.principal = principal;
    context.delegationContext = delegationContext;

    return {
      decision: {
        gateId: GATE_ID.G01,
        gateOrder: 1,
        plane: 'control',
        outcome: 'pass',
        reason: 'identity verified',
        denialCode: null,
        policyRuleId: null,
        evaluatedAt: new Date().toISOString(),
        durationMs: Date.now() - startMs,
        metadata: {},
      },
    };
  }
}

// packages/planners/db-lexicon/src/internal/preflight.ts
// AMEND-nexus-planner-db-lexicon-v0-2-1.md §3.3.3.
//
// Branch 3 — preferred-agents preflight feasibility check.
//
// Triggers when the workspace populated `selectedAgentIds` (operator
// preference path). The planner:
//   1. Determines the required capability set (from `requiredCapabilities`
//      OR by inferring via truncated Layer A→C on the prompt).
//   2. Projects each selected agent's capabilities from the live
//      ActorRegistry.
//   3. Checks every required capability is covered by at least one
//      selected agent.
//   4. PASS → build a plan with the operator's preferred agents via
//      the extracted `plan-assembly.planStandard` machinery.
//   5. FAIL → produce a `RejectionCheckbackPayload` populated from
//      what the lexicon (via registry findByCapability) would have
//      picked. Coordinator surfaces this via `plan_checkback_sent` +
//      `OrchestratorPlanPreview.rejection`.
//
// Authority scope reminder (§1.3, F06):
//   - Planner adjudicates AGENT / CAPABILITY feasibility only.
//   - `preferredEndpointId` flows through the trace but is NOT
//     adjudicated here. NVG owns model / endpoint selection.

import type {
  ExecutionPlan,
  MetadataPlannerRequest,
  NonEmpty,
  NormalPlannerRequest,
  PlanRejection,
  PlannerContext,
  RejectionCheckbackPayload,
  Sha256Hex,
  SuggestedAgent,
  Uuid,
} from '@nexus/contracts';
import { isVisible, planStandard, type PlanAssemblyDeps } from '@nexus/orch-ref';
import { decomposeLexically } from './lexical-decomposition.js';
import { resolveLexical } from './lexical-resolver.js';
import type { LexiconTablesV1 } from './types.js';

// ─── Result discriminated union ───

export interface PreflightPassResult {
  kind: 'pass';
  plan: ExecutionPlan;
  // Trace data
  requiredCapabilities: NonEmpty[];
  // The preferred-agents path doesn't run full Layer A-D so candidate
  // agents are just the selected ones for trace purposes.
  candidateAgents: ReadonlyArray<{ capability: NonEmpty; agentIds: Uuid[] }>;
}

export interface PreflightRejectWithSuggestions {
  kind: 'reject_with_suggestions';
  rejection: PlanRejection;
  checkback: RejectionCheckbackPayload;
  // Trace data
  requiredCapabilities: NonEmpty[];
  missingCapabilities: NonEmpty[];
  candidateAgents: ReadonlyArray<{ capability: NonEmpty; agentIds: Uuid[] }>;
}

export interface PreflightRejectMalformed {
  kind: 'reject_malformed';
  rejection: PlanRejection;
}

export interface PreflightRejectFromAssembly {
  kind: 'reject_from_assembly';
  rejection: PlanRejection;
}

export type PreflightResult =
  | PreflightPassResult
  | PreflightRejectWithSuggestions
  | PreflightRejectMalformed
  | PreflightRejectFromAssembly;

// ─── Helpers ───

/**
 * Infer required capabilities from a prompt by running a truncated
 * Layer A→C of the lexical pipeline (no Layer D template expansion).
 *
 * Returns null when the lexical resolver cannot match an intent — the
 * caller maps that to a `malformed_request` rejection because preflight
 * needs SOME capability set to check against.
 */
async function inferRequiredCapabilities(
  prompt: NonEmpty,
  tables: LexiconTablesV1,
  context: PlannerContext
): Promise<NonEmpty[] | null> {
  const resolution = resolveLexical(prompt, tables);
  // We don't actually run full Layer D — just need the intent's
  // required capabilities. decomposeLexically does Layer C+D together;
  // when it fails on Layer D we still get the capability set from
  // its `no_agent` / `no_intent` branches.
  const decomposed = await decomposeLexically(prompt, resolution, tables, context);
  if (decomposed.kind === 'plan') return [...decomposed.requiredCapabilities];
  if (decomposed.kind === 'no_agent') return [...decomposed.requiredCapabilities];
  if (decomposed.kind === 'ambiguous') {
    // Ambiguous intent — we can't pick one capability set. Bail.
    return null;
  }
  return null;
}

/**
 * Build the per-capability candidate-agent map for the trace and for
 * counter-suggestions. Queries the registry by capability + filters by
 * ceiling.
 */
async function findCandidatesByCapability(
  capabilities: ReadonlyArray<NonEmpty>,
  context: PlannerContext
): Promise<Map<NonEmpty, Uuid[]>> {
  const out = new Map<NonEmpty, Uuid[]>();
  for (const cap of capabilities) {
    const found = await context.registry.findByCapability(cap);
    const visible = found.filter(a => a.enabled && isVisible(a, context.capabilityCeiling));
    out.set(
      cap,
      visible.map(a => a.agentId as Uuid)
    );
  }
  return out;
}

/**
 * Build the executable replacement set for `RejectionCheckbackPayload`.
 * Picks the first visible candidate per missing capability. Returns
 * an empty array if any missing capability has zero candidates — the
 * caller should still produce the rejection but with an empty
 * recommendedSelectedAgentIds (workspace surfaces "no usable
 * alternative" UI state).
 */
function buildRecommendedAgents(
  missing: ReadonlyArray<NonEmpty>,
  candidatesByCap: Map<NonEmpty, Uuid[]>
): { recommended: Uuid[]; alternatives: Record<string, SuggestedAgent[]> } {
  const recommended: Uuid[] = [];
  const seen = new Set<string>();
  const alternatives: Record<string, SuggestedAgent[]> = {};

  for (const cap of missing) {
    const candidates = candidatesByCap.get(cap) ?? [];
    const suggestions: SuggestedAgent[] = candidates.map(agentId => ({
      agentId,
      capability: cap,
      reason: `Agent has capability '${cap}'` as NonEmpty,
    }));
    alternatives[cap] = suggestions;
    // Take the first candidate as the executable pick; dedupe by
    // agentId so a single agent covering multiple missing capabilities
    // appears once in `recommended`.
    if (candidates.length > 0) {
      const pick = candidates[0]!;
      if (!seen.has(pick)) {
        seen.add(pick);
        recommended.push(pick);
      }
    }
  }

  return { recommended, alternatives };
}

// ─── Entry point ───

export interface PreflightInput {
  request: NormalPlannerRequest | MetadataPlannerRequest;
  context: PlannerContext;
  tables: LexiconTablesV1;
  computeDigest: (obj: unknown) => Sha256Hex;
  plannerType: NonEmpty;
  plannerVersion: NonEmpty;
  orchestratorActorId: Uuid;
}

/**
 * Run Branch 3 (preferred-agents preflight) end-to-end.
 *
 * Returns a discriminated `PreflightResult` consumed by the planner's
 * tier dispatch. The caller (db-lexicon-planner.ts) translates the
 * result into the contract return type (ExecutionPlan | PlanRejection)
 * + trace stash + (on `reject_with_suggestions`) checkback stash.
 */
export async function runPreflight(input: PreflightInput): Promise<PreflightResult> {
  const { request, context, tables } = input;

  // ── Step 1: Determine required capabilities ──
  let requiredCapabilities: NonEmpty[];
  if (request.requiredCapabilities.length > 0) {
    requiredCapabilities = [...request.requiredCapabilities];
  } else if (request.tier === 'normal' && request.prompt) {
    // Truncated Layer A→C inference
    const inferred = await inferRequiredCapabilities(request.prompt, tables, context);
    if (inferred === null || inferred.length === 0) {
      return {
        kind: 'reject_malformed',
        rejection: {
          rejected: true,
          reason: 'malformed_request',
          reasonDetail:
            'preflight_preferred_agents: cannot infer required capabilities from prompt (no intent matched OR ambiguous intent)' as NonEmpty,
          suggestedAlternatives: [],
        },
      };
    }
    requiredCapabilities = inferred;
  } else {
    // metadata tier with empty requiredCapabilities + no prompt
    return {
      kind: 'reject_malformed',
      rejection: {
        rejected: true,
        reason: 'malformed_request',
        reasonDetail:
          'preflight_preferred_agents: metadata-tier request with non-empty selectedAgentIds requires non-empty requiredCapabilities in V1' as NonEmpty,
        suggestedAlternatives: [],
      },
    };
  }

  // ── Step 2: Project selected agents' capabilities ──
  const agentCapabilities = new Map<Uuid, NonEmpty[]>();
  for (const agentId of request.selectedAgentIds) {
    const agent = await context.registry.getById(agentId);
    if (!agent) {
      return {
        kind: 'reject_malformed',
        rejection: {
          rejected: true,
          reason: 'malformed_request',
          reasonDetail:
            `preflight_preferred_agents: selectedAgentId '${agentId}' not found in registry` as NonEmpty,
          suggestedAlternatives: [],
        },
      };
    }
    agentCapabilities.set(agentId, [...agent.capabilities]);
  }

  // ── Step 3: Check feasibility ──
  const missing: NonEmpty[] = [];
  for (const cap of requiredCapabilities) {
    let covered = false;
    for (const caps of agentCapabilities.values()) {
      if (caps.includes(cap)) {
        covered = true;
        break;
      }
    }
    if (!covered) missing.push(cap);
  }

  // Per-capability candidate-agents map for the trace
  const candidatesByCap = await findCandidatesByCapability(requiredCapabilities, context);
  const candidateAgents: { capability: NonEmpty; agentIds: Uuid[] }[] = [];
  for (const cap of requiredCapabilities) {
    candidateAgents.push({
      capability: cap,
      agentIds: [...(candidatesByCap.get(cap) ?? [])],
    });
  }

  // ── Step 4 (PASS path): emit plan with operator's preferred agents ──
  if (missing.length === 0) {
    // Build a derived request with the required capabilities populated
    // (if they were inferred from the prompt rather than supplied).
    // plan-assembly.planStandard expects requiredCapabilities populated.
    const derivedRequest: NormalPlannerRequest | MetadataPlannerRequest = {
      ...request,
      requiredCapabilities,
    } as NormalPlannerRequest | MetadataPlannerRequest;

    const deps: PlanAssemblyDeps = {
      computeDigest: input.computeDigest,
      plannerType: input.plannerType,
      plannerVersion: input.plannerVersion,
      orchestratorActorId: input.orchestratorActorId,
    };

    const result = await planStandard(derivedRequest, context, deps);
    if ('rejected' in result) {
      return {
        kind: 'reject_from_assembly',
        rejection: result,
      };
    }
    return {
      kind: 'pass',
      plan: result,
      requiredCapabilities,
      candidateAgents,
    };
  }

  // ── Step 5 (FAIL path): rejection with counter-suggestion ──
  const { recommended, alternatives } = buildRecommendedAgents(missing, candidatesByCap);

  const rejection: PlanRejection = {
    rejected: true,
    reason: 'no_capable_agent',
    reasonDetail:
      `preflight_preferred_agents_insufficient: ${missing.join(', ')} uncovered by selectedAgentIds [${request.selectedAgentIds.join(', ')}]` as NonEmpty,
    // The contract `suggestedAlternatives` is the flat list — flatten
    // alternatives map into one stream. The richer per-capability
    // grouping lives on the RejectionCheckbackPayload below.
    suggestedAlternatives: Object.values(alternatives).flat(),
  };

  const checkback: RejectionCheckbackPayload = {
    reason: 'no_capable_agent',
    reasonDetail: rejection.reasonDetail,
    missingCapabilities: missing,
    rejectedSelectedAgentIds: [...request.selectedAgentIds],
    recommendedSelectedAgentIds: recommended,
    alternativesByCapability: alternatives,
  };

  return {
    kind: 'reject_with_suggestions',
    rejection,
    checkback,
    requiredCapabilities,
    missingCapabilities: missing,
    candidateAgents,
  };
}

// packages/orch-ref/src/ref-deterministic-planner.ts
// AMEND-spec-nexus-orch §5 — Reference Deterministic Planner
// External reference — imports @nexus/contracts ONLY.
//
// V1 deterministic planner. No LLM. Structured rule evaluator.
// Planner authority bounds [blueprint-K §11.4.5]:
// - MAY reject for orchestration feasibility reasons
// - MUST NOT perform authorization, risk, policy, OCT, or NXS/NVG decisions
// - Ceiling is catalog visibility only, not authorization [blueprint-K §11.7.1]

import type { Uuid, NonEmpty, Sha256Hex, IsoTimestamp } from '@nexus/contracts';

import type {
  Planner,
  PlannerRequest,
  NormalPlannerRequest,
  MetadataPlannerRequest,
  OctSecurePlannerRequest,
  PlannerContext,
  AgentCapabilityEntry,
  EdgeHint,
} from '@nexus/contracts';

import type {
  ExecutionPlan,
  PlanNode,
  PlanEdge,
  PlanEdgeType,
  PlanCondition,
  PlanConditionOperator,
  PlanRejection,
  PlanRejectionReason,
  SuggestedAgent,
} from '@nexus/contracts';

import { EVIDENCE_SENTINEL, nowIso } from '@nexus/contracts';

import { randomUUID } from 'node:crypto';

// ─── Valid PlanConditionOperator values ───

const VALID_OPERATORS: ReadonlySet<string> = new Set<string>([
  'equals',
  'not_equals',
  'exists',
  'not_exists',
  'gt',
  'lt',
]);

// ─── Condition Evaluation — §3.1 type coercion law ───
// Exported for ORCH-14 testing and executor use.

export interface ConditionEvalResult {
  result: boolean;
  reason: 'match' | 'no_match' | 'type_mismatch';
}

export function evaluateCondition(
  condition: PlanCondition,
  sourceMetadata: Record<string, unknown>
): ConditionEvalResult {
  const sourceValue: unknown = sourceMetadata[condition.sourceField];

  switch (condition.operator) {
    case 'equals':
      return sourceValue === condition.value
        ? { result: true, reason: 'match' }
        : { result: false, reason: 'no_match' };

    case 'not_equals':
      return sourceValue !== condition.value
        ? { result: true, reason: 'match' }
        : { result: false, reason: 'no_match' };

    case 'exists':
      return sourceValue !== undefined && sourceValue !== null
        ? { result: true, reason: 'match' }
        : { result: false, reason: 'no_match' };

    case 'not_exists':
      return sourceValue === undefined || sourceValue === null
        ? { result: true, reason: 'match' }
        : { result: false, reason: 'no_match' };

    case 'gt': {
      if (
        typeof sourceValue !== 'number' ||
        !isFinite(sourceValue) ||
        typeof condition.value !== 'number' ||
        !isFinite(condition.value)
      ) {
        return { result: false, reason: 'type_mismatch' };
      }
      return sourceValue > condition.value
        ? { result: true, reason: 'match' }
        : { result: false, reason: 'no_match' };
    }

    case 'lt': {
      if (
        typeof sourceValue !== 'number' ||
        !isFinite(sourceValue) ||
        typeof condition.value !== 'number' ||
        !isFinite(condition.value)
      ) {
        return { result: false, reason: 'type_mismatch' };
      }
      return sourceValue < condition.value
        ? { result: true, reason: 'match' }
        : { result: false, reason: 'no_match' };
    }

    default:
      return { result: false, reason: 'type_mismatch' };
  }
}

// ─── Dispatch Branching — §5.4 ───
// Exported for ORCH-13 testing.

export type NodeTypeResult =
  | { valid: true; nodeType: PlanNode['nodeType']; requiresNvg: boolean; requiresNxs: boolean }
  | { valid: false; reason: NonEmpty };

export function determineNodeType(
  requiresNvg: boolean,
  requiresNxs: boolean,
  agentId: Uuid,
  orchestratorActorId: Uuid,
  isSecureHandoff: boolean
): NodeTypeResult {
  // Both true → malformed_request [§5.4]
  if (requiresNvg && requiresNxs) {
    return {
      valid: false,
      reason: 'Both requiresNvg and requiresNxs cannot be true on the same node' as NonEmpty,
    };
  }

  if (requiresNvg) {
    return { valid: true, nodeType: 'nvg_dispatch', requiresNvg: true, requiresNxs: false };
  }

  if (requiresNxs) {
    return { valid: true, nodeType: 'nxs_dispatch', requiresNvg: false, requiresNxs: true };
  }

  // Both false — distinguish local_control vs secure_agent_handoff
  if (isSecureHandoff) {
    return {
      valid: true,
      nodeType: 'secure_agent_handoff',
      requiresNvg: false,
      requiresNxs: false,
    };
  }

  // local_control: agentId MUST equal orchestratorActorId [§5.4]
  if (agentId !== orchestratorActorId) {
    return {
      valid: false,
      reason: 'local_control node agentId must equal orchestratorActorId' as NonEmpty,
    };
  }

  return { valid: true, nodeType: 'local_control', requiresNvg: false, requiresNxs: false };
}

// ─── DAG Acyclicity Check ───

function hasCycle(nodes: PlanNode[], edges: PlanEdge[]): boolean {
  const nodeIds = new Set(nodes.map(n => n.nodeId));
  const adjacency = new Map<string, string[]>();
  for (const id of nodeIds) {
    adjacency.set(id, []);
  }
  for (const edge of edges) {
    adjacency.get(edge.sourceNodeId)?.push(edge.targetNodeId);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(nodeId: string): boolean {
    if (inStack.has(nodeId)) return true; // cycle
    if (visited.has(nodeId)) return false;
    visited.add(nodeId);
    inStack.add(nodeId);
    for (const neighbor of adjacency.get(nodeId) ?? []) {
      if (dfs(neighbor)) return true;
    }
    inStack.delete(nodeId);
    return false;
  }

  for (const id of nodeIds) {
    if (dfs(id)) return true;
  }
  return false;
}

// ─── Edge Sort Comparator — §5.1 step 10 ───

function compareEdges(a: PlanEdge, b: PlanEdge): number {
  if (a.sourceNodeId < b.sourceNodeId) return -1;
  if (a.sourceNodeId > b.sourceNodeId) return 1;
  if (a.targetNodeId < b.targetNodeId) return -1;
  if (a.targetNodeId > b.targetNodeId) return 1;
  if (a.edgeType < b.edgeType) return -1;
  if (a.edgeType > b.edgeType) return 1;
  if (a.edgeId < b.edgeId) return -1;
  if (a.edgeId > b.edgeId) return 1;
  return 0;
}

// ─── Rejection Helper ───

function reject(
  reason: PlanRejectionReason,
  detail: string,
  alternatives: SuggestedAgent[] = []
): PlanRejection {
  return {
    rejected: true,
    reason,
    reasonDetail: detail as NonEmpty,
    suggestedAlternatives: alternatives,
  };
}

// ─── RefDeterministicPlanner ───

export class RefDeterministicPlanner implements Planner {
  readonly plannerType: NonEmpty = 'ref-deterministic' as NonEmpty;
  readonly plannerVersion: NonEmpty = '1.0.0' as NonEmpty;

  constructor(
    private readonly computeDigest: (obj: unknown) => Sha256Hex,
    private readonly orchestratorActorId: Uuid
  ) {}

  async plan(
    request: PlannerRequest,
    context: PlannerContext
  ): Promise<ExecutionPlan | PlanRejection> {
    // §5.1 step 1: Match on tier discriminant
    switch (request.tier) {
      case 'oct_secure':
        return this.planOctSecure(request, context);
      case 'metadata':
        return this.planStandard(request, context);
      case 'normal':
        return this.planStandard(request, context);
      default:
        return reject('malformed_request', 'Unknown visibility tier');
    }
  }

  // ─── OCT-SECURE plan ───
  // Single node for secureAgentId. No prompt. secure_agent_handoff.
  // taskSummary = 'OCT_SECURE_REDACTED'. [§5.1 step 1]
  private async planOctSecure(
    request: OctSecurePlannerRequest,
    context: PlannerContext
  ): Promise<ExecutionPlan | PlanRejection> {
    const agent = await context.registry.getById(request.secureAgentId);
    if (!agent) {
      return reject(
        'no_capable_agent',
        `Secure agent ${request.secureAgentId} not found in registry`
      );
    }

    const node: PlanNode = {
      nodeId: randomUUID() as Uuid,
      planOrderIndex: 0,
      agentId: request.secureAgentId,
      taskSummary: 'OCT_SECURE_REDACTED' as NonEmpty,
      requiresNvg: false,
      requiresNxs: false,
      nodeType: 'secure_agent_handoff',
      declaredRiskHint: EVIDENCE_SENTINEL,
      expectedOutputSlots: ['secure_output' as NonEmpty],
      timeoutMs: 60000,
    };

    const plan = this.buildPlan(request.runId, [node], []);
    return plan;
  }

  // ─── Standard plan (normal / metadata) ───
  private async planStandard(
    request: NormalPlannerRequest | MetadataPlannerRequest,
    context: PlannerContext
  ): Promise<ExecutionPlan | PlanRejection> {
    // §5.1 step 3: both empty → reject
    if (request.selectedAgentIds.length === 0 && request.requiredCapabilities.length === 0) {
      return reject('malformed_request', 'V1 requires explicit agent selection or capabilities');
    }

    // Resolve agents
    const resolvedAgents: AgentCapabilityEntry[] = [];

    if (request.selectedAgentIds.length > 0) {
      // §5.1 step 2: validate selectedAgentIds
      for (const agentId of request.selectedAgentIds) {
        const agent = await context.registry.getById(agentId);

        if (!agent) {
          // Suggest-not-deny [§5.2]
          const alternatives = await this.findAlternatives(request.requiredCapabilities, context);
          return reject('no_capable_agent', `Agent ${agentId} not found in registry`, alternatives);
        }

        // Check visibility under capabilityCeiling [§5.2]
        if (!this.isVisible(agent, context.capabilityCeiling)) {
          const alternatives = await this.findAlternatives(agent.capabilities, context);
          return reject(
            'capability_outside_ceiling',
            `Agent ${agentId} is outside capability ceiling`,
            alternatives
          );
        }

        if (!agent.enabled) {
          const alternatives = await this.findAlternatives(agent.capabilities, context);
          return reject('no_capable_agent', `Agent ${agentId} is disabled`, alternatives);
        }

        resolvedAgents.push(agent);
      }
    } else {
      // Find agents by requiredCapabilities
      const seenAgentIds = new Set<string>();
      for (const capability of request.requiredCapabilities) {
        const candidates = await context.registry.findByCapability(capability);
        const visible = candidates.filter(
          a => a.enabled && this.isVisible(a, context.capabilityCeiling)
        );

        if (visible.length === 0) {
          const allAlts = await this.findAlternatives([capability], context);
          return reject(
            'no_capable_agent',
            `No enabled agent found for capability '${capability}'`,
            allAlts
          );
        }

        // Take first visible agent not already in the plan
        const chosen = visible.find(a => !seenAgentIds.has(a.agentId)) ?? visible[0];
        if (!seenAgentIds.has(chosen.agentId)) {
          seenAgentIds.add(chosen.agentId);
          resolvedAgents.push(chosen);
        }
      }
    }

    // §5.1 step 9: validate maxSplitDepth
    if (resolvedAgents.length > context.maxSplitDepth) {
      return reject(
        'max_split_exceeded',
        `Plan requires ${resolvedAgents.length} nodes but maxSplitDepth is ${context.maxSplitDepth}`
      );
    }

    // §5.1 step 4: create PlanNodes with sequential planOrderIndex
    const agentToNodeId = new Map<string, string>();
    const nodes: PlanNode[] = resolvedAgents.map((agent, index) => {
      const nodeId = randomUUID() as Uuid;
      agentToNodeId.set(agent.agentId, nodeId);
      return {
        nodeId,
        planOrderIndex: index,
        agentId: agent.agentId as Uuid,
        taskSummary: this.buildTaskSummary(request, agent),
        requiresNvg: false,
        requiresNxs: true,
        nodeType: 'nxs_dispatch' as const,
        declaredRiskHint: EVIDENCE_SENTINEL,
        expectedOutputSlots: ['default' as NonEmpty],
        timeoutMs: 30000,
      };
    });

    // §5.1 step 7: build edges from edgeHints [OD-ORCH-02]
    const edgesResult = this.buildEdges(request.edgeHints, agentToNodeId);
    if ('rejected' in edgesResult) {
      return edgesResult;
    }
    const edges = edgesResult;

    // §5.1 step 8: validate DAG acyclicity
    if (edges.length > 0 && hasCycle(nodes, edges)) {
      return reject('malformed_request', 'Edge hints form a cycle — DAG required');
    }

    // §5.1 step 10: sort (nodes already sorted by planOrderIndex from construction)
    edges.sort(compareEdges);

    const plan = this.buildPlan(request.runId, nodes, edges);
    return plan;
  }

  // ─── Build edges from EdgeHints ───
  private buildEdges(
    edgeHints: EdgeHint[],
    agentToNodeId: Map<string, string>
  ): PlanEdge[] | PlanRejection {
    if (edgeHints.length === 0) return [];

    const edges: PlanEdge[] = [];

    for (const hint of edgeHints) {
      const sourceNodeId = agentToNodeId.get(hint.sourceAgentId);
      const targetNodeId = agentToNodeId.get(hint.targetAgentId);

      if (!sourceNodeId) {
        return reject(
          'malformed_request',
          `EdgeHint references unknown sourceAgentId '${hint.sourceAgentId}'`
        );
      }
      if (!targetNodeId) {
        return reject(
          'malformed_request',
          `EdgeHint references unknown targetAgentId '${hint.targetAgentId}'`
        );
      }

      // Validate conditionSpec per EdgeHint normalization law
      const conditionResult = this.validateAndBuildCondition(hint);
      if (conditionResult !== null && 'rejected' in conditionResult) {
        return conditionResult;
      }

      edges.push({
        edgeId: randomUUID() as Uuid,
        sourceNodeId: sourceNodeId as Uuid,
        targetNodeId: targetNodeId as Uuid,
        edgeType: hint.edgeType as PlanEdgeType,
        condition: conditionResult,
        outputSlotRef: hint.outputSlotRef,
      });
    }

    return edges;
  }

  // ─── Validate and build PlanCondition from EdgeHint ───
  private validateAndBuildCondition(hint: EdgeHint): (PlanCondition | null) | PlanRejection {
    // Non-conditional edge requires conditionSpec === null
    if (hint.edgeType !== 'conditional') {
      if (hint.conditionSpec !== null) {
        return reject(
          'malformed_request',
          `Non-conditional edge type '${hint.edgeType}' must have null conditionSpec`
        );
      }
      return null;
    }

    // Conditional edge requires non-null conditionSpec
    if (hint.conditionSpec === null) {
      return reject('malformed_request', 'Conditional edge requires non-null conditionSpec');
    }

    const spec = hint.conditionSpec;

    // Validate operator
    if (!VALID_OPERATORS.has(spec.operator)) {
      return reject('malformed_request', `Invalid conditionSpec operator '${spec.operator}'`);
    }

    // Validate value type: must be string | number | boolean | null
    if (
      spec.value !== null &&
      typeof spec.value !== 'string' &&
      typeof spec.value !== 'number' &&
      typeof spec.value !== 'boolean'
    ) {
      return reject(
        'malformed_request',
        `conditionSpec.value must be string | number | boolean | null, got ${typeof spec.value}`
      );
    }

    return {
      conditionId: randomUUID() as Uuid,
      sourceField: spec.sourceField,
      operator: spec.operator as PlanConditionOperator,
      value: spec.value as string | number | boolean | null,
    };
  }

  // ─── Build final ExecutionPlan with digest ───
  private buildPlan(runId: Uuid, nodes: PlanNode[], edges: PlanEdge[]): ExecutionPlan {
    const planId = randomUUID() as Uuid;
    const createdAt = nowIso();

    // §3.2: planDigest excludes createdAt
    const planDigest = this.computeDigest({
      planId,
      runId,
      nodes: [...nodes].sort((a, b) => a.planOrderIndex - b.planOrderIndex),
      edges: [...edges].sort(compareEdges),
      plannerType: this.plannerType,
      plannerVersion: this.plannerVersion,
    });

    return {
      planId,
      runId,
      planDigest,
      nodes,
      edges,
      plannerType: this.plannerType,
      plannerVersion: this.plannerVersion,
      createdAt,
    };
  }

  // ─── Visibility check — catalog visibility only [blueprint-K §11.7.1] ───
  private isVisible(agent: AgentCapabilityEntry, ceiling: NonEmpty[]): boolean {
    if (ceiling.length === 0) return true;
    return agent.capabilities.some(cap => ceiling.includes(cap));
  }

  // ─── Suggest-not-deny — find alternative agents [§5.2] ───
  private async findAlternatives(
    capabilities: NonEmpty[],
    context: PlannerContext
  ): Promise<SuggestedAgent[]> {
    const alternatives: SuggestedAgent[] = [];
    const seen = new Set<string>();

    for (const capability of capabilities) {
      const candidates = await context.registry.findByCapability(capability);
      const visible = candidates.filter(
        a => a.enabled && this.isVisible(a, context.capabilityCeiling)
      );
      for (const alt of visible) {
        if (!seen.has(alt.agentId)) {
          seen.add(alt.agentId);
          alternatives.push({
            agentId: alt.agentId as Uuid,
            capability,
            reason: `Agent has capability '${capability}'` as NonEmpty,
          });
        }
      }
    }

    return alternatives;
  }

  // ─── Task summary builder ───
  private buildTaskSummary(
    request: NormalPlannerRequest | MetadataPlannerRequest,
    agent: AgentCapabilityEntry
  ): NonEmpty {
    return `Task for agent ${agent.agentId}` as NonEmpty;
  }
}

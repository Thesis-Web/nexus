// packages/planners/db-lexicon/src/internal/lexical-decomposition.ts
// AMEND-nexus-planner-db-lexicon-v0-2-1.md §3.3.4 Layer C + Layer D.
//
// Branch 4 (lexical decomposition) Layer C/D pipeline:
//
//   Input  — `LexicalResolutionResult` from Layer B (lexical-resolver.ts)
//          + `LexiconTablesV1` (in-memory lexicon)
//          + `PlannerContext` (live AgentRegistryReader)
//          + originating prompt (for per-node taskPrompt)
//
//   Layer C — Capability transformer:
//     1. Identify candidate `planner_task_intent` entries by token
//        overlap between (canonicalVerbs ∪ targetTerms ∪ operands) and
//        the intent's `name` field. The intent name encodes the
//        canonical trigger token set (space-separated lower-case
//        canonical verbs / target terms / operands). One or more
//        candidates may match.
//     2. Resolve required capabilities for each candidate via
//        `planner_task_capability`.
//     3. Resolve target catalog entries (system, resourceType,
//        resourceScope) for each resolved target term.
//
//   Layer D — Workflow / DAG expander:
//     1. For each candidate intent, find matching
//        `planner_workflow_template` rows.
//     2. Multiple-template ambiguity (more than one template across
//        all candidates) returns a `LexicalDecompositionAmbiguous`
//        result; the caller (Layer E) maps to PlanRejection
//        `unmappable_request` with detail `ambiguous_intent`.
//     3. For the single selected template, expand `planner_workflow_node`
//        + `planner_workflow_edge` rows into per-node candidate-agent
//        lists via `AgentRegistryReader.findByCapability` filtered by
//        `context.capabilityCeiling`.
//     4. Any node with zero visible candidate agents returns a
//        `LexicalDecompositionNoAgent` result (caller maps to
//        `no_capable_agent` with `suggestedAlternatives` from any
//        visible alternative capabilities).
//     5. Build `SubTaskDecl[]` + `SubTaskEdgeHint[]` with proper
//        `inputSlotReads` chained via edges and synthesized
//        `NxsActionTemplate` for `kind: 'nxs'` nodes.
//
//   Layer E (in db-lexicon-planner.ts) consumes this output by handing
//   it to `plan-assembly.planFromSubTasks` for ExecutionPlan emission +
//   the full 14+1 validation suite.

import type {
  NonEmpty,
  NxsActionTemplate,
  NxsSlotBinding,
  PlannerContext,
  SlotReadRef,
  SubTaskDecl,
  SubTaskEdgeHint,
  Uuid,
} from '@nexus/contracts';
import type {
  ExpandedTemplate,
  IntentCandidate,
  LexicalResolutionResult,
  LexiconTablesV1,
  PlannerTargetCatalog,
  PlannerWorkflowEdge,
  PlannerWorkflowNode,
  PlannerWorkflowTemplate,
} from './types.js';
import { isVisible } from '@nexus/orch-ref';

// ─── Result discriminated union ───

export interface LexicalDecompositionPlan {
  kind: 'plan';
  subTasks: SubTaskDecl[];
  subTaskEdges: SubTaskEdgeHint[];
  // Trace fields (consumed by db-lexicon-planner.ts for the trace stash)
  candidateIntents: NonEmpty[];
  selectedIntent: NonEmpty;
  candidateTemplates: NonEmpty[];
  selectedTemplate: NonEmpty;
  requiredCapabilities: NonEmpty[];
  candidateAgents: ReadonlyArray<{ capability: NonEmpty; agentIds: Uuid[] }>;
}

export interface LexicalDecompositionAmbiguous {
  kind: 'ambiguous';
  candidateIntents: NonEmpty[];
  candidateTemplates: NonEmpty[];
  reasonDetail: string;
}

export interface LexicalDecompositionNoIntent {
  kind: 'no_intent';
  reasonDetail: string;
}

export interface LexicalDecompositionNoAgent {
  kind: 'no_agent';
  candidateIntents: NonEmpty[];
  selectedIntent: NonEmpty;
  candidateTemplates: NonEmpty[];
  selectedTemplate: NonEmpty;
  requiredCapabilities: NonEmpty[];
  missingCapabilities: NonEmpty[];
  reasonDetail: string;
}

export interface LexicalDecompositionBlocked {
  kind: 'blocked';
  reasonDetail: string;
}

export type LexicalDecompositionResult =
  | LexicalDecompositionPlan
  | LexicalDecompositionAmbiguous
  | LexicalDecompositionNoIntent
  | LexicalDecompositionNoAgent
  | LexicalDecompositionBlocked;

// ─── Layer C — Capability transformer ───

/**
 * Tokenize an intent name into lowercase tokens. The intent.name field
 * encodes the canonical trigger token set space-separated (e.g.
 * "read update inventory_row receiving_delta").
 */
function intentNameTokens(intentName: string): Set<string> {
  return new Set(
    intentName
      .toLowerCase()
      .split(/\s+/)
      .filter(t => t.length > 0)
  );
}

/**
 * Collect every canonical token from Layer B's resolution streams.
 * Used to score intent candidacy.
 */
function resolvedTokens(resolution: LexicalResolutionResult): Set<string> {
  const out = new Set<string>();
  for (const v of resolution.verbs) out.add(v.canonicalVerb.toLowerCase());
  for (const t of resolution.targets) out.add(t.targetTerm.toLowerCase());
  for (const o of resolution.operands) out.add(o.operand.toLowerCase());
  return out;
}

/**
 * Find candidate intents whose trigger tokens (from intent.name) are
 * fully covered by the resolved tokens. An intent is a candidate when
 * every token in its name appears in the resolution.
 *
 * Returns IntentCandidate[] keyed by intent + the required capabilities
 * looked up via planner_task_capability.
 */
function findCandidateIntents(
  resolution: LexicalResolutionResult,
  tables: LexiconTablesV1
): IntentCandidate[] {
  const resolved = resolvedTokens(resolution);
  const candidates: IntentCandidate[] = [];

  for (const intent of tables.taskIntents) {
    const triggerTokens = intentNameTokens(intent.name);
    if (triggerTokens.size === 0) continue;

    let allCovered = true;
    for (const tok of triggerTokens) {
      if (!resolved.has(tok)) {
        allCovered = false;
        break;
      }
    }
    if (!allCovered) continue;

    const requiredCaps = tables.capabilitiesByIntent.get(intent.intentId);
    if (!requiredCaps) continue; // intent has no capability row — skip

    candidates.push({
      intentId: intent.intentId,
      requiredCapabilities: requiredCaps,
    });
  }

  return candidates;
}

/**
 * Resolve target-catalog entries for each resolved target term. Returns
 * the first matching target catalog entry per target term. Missing
 * entries are skipped (V1 — Layer D synthesizes a fallback target from
 * the resolved targetTerm if needed).
 */
function resolveTargetCatalog(
  resolution: LexicalResolutionResult,
  tables: LexiconTablesV1
): PlannerTargetCatalog[] {
  const out: PlannerTargetCatalog[] = [];
  const seen = new Set<string>();
  for (const target of resolution.targets) {
    const entry = tables.targetByBusinessTerm.get(target.targetTerm.toLowerCase());
    if (!entry) continue;
    const key = `${entry.system}::${entry.resourceType}::${entry.resourceScope}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

// ─── Layer D — Workflow / DAG expander ───

/**
 * For each candidate intent, collect matching workflow templates. V1
 * ambiguity rule: if a single intent matches multiple templates, treat
 * as ambiguous; if multiple intents each match a single template,
 * still treat as ambiguous (the caller can disambiguate by content).
 */
function findCandidateTemplates(
  intents: IntentCandidate[],
  tables: LexiconTablesV1
): { byIntent: Map<NonEmpty, PlannerWorkflowTemplate[]>; flatList: NonEmpty[] } {
  const byIntent = new Map<NonEmpty, PlannerWorkflowTemplate[]>();
  const flatList: NonEmpty[] = [];
  for (const intent of intents) {
    const templates = tables.templatesByIntent.get(intent.intentId) ?? [];
    byIntent.set(intent.intentId, [...templates]);
    for (const tpl of templates) {
      flatList.push(tpl.templateId);
    }
  }
  return { byIntent, flatList };
}

/**
 * Expand a single workflow template — collect its nodes, edges, and
 * candidate agents (filtered by capability ceiling).
 */
async function expandTemplate(
  template: PlannerWorkflowTemplate,
  tables: LexiconTablesV1,
  context: PlannerContext
): Promise<ExpandedTemplate> {
  const nodes = tables.nodesByTemplate.get(template.templateId) ?? [];
  const edges = tables.edgesByTemplate.get(template.templateId) ?? [];

  const agentsByNodeKey = new Map<string, Uuid[]>();
  for (const node of nodes) {
    const candidates = await context.registry.findByCapability(node.capability);
    const visible = candidates.filter(a => a.enabled && isVisible(a, context.capabilityCeiling));
    agentsByNodeKey.set(
      node.nodeKey,
      visible.map(a => a.agentId as Uuid)
    );
  }

  return {
    template,
    nodes,
    edges,
    agentsByNodeKey,
  };
}

/**
 * Compute the inputSlotReads for a single node from incoming workflow
 * edges. Each incoming edge contributes one SlotReadRef pair
 * (fromSubTaskKey = source node's key, slotId = edge.outputSlotRef OR
 * the source node's first expectedOutputSlot).
 */
function computeInputSlotReads(nodeKey: string, expanded: ExpandedTemplate): SlotReadRef[] {
  const incoming = expanded.edges.filter(e => e.targetNodeKey === nodeKey);
  const reads: SlotReadRef[] = [];
  for (const edge of incoming) {
    const sourceNode = expanded.nodes.find(n => n.nodeKey === edge.sourceNodeKey);
    if (!sourceNode) {
      throw new Error(
        `lexical-decomposition: workflow_edge references unknown source nodeKey '${edge.sourceNodeKey}' (template '${expanded.template.templateId}'). Should have failed loader cross-fixture invariant.`
      );
    }
    const slotId = edge.outputSlotRef ?? sourceNode.expectedOutputSlots[0];
    if (!slotId) {
      throw new Error(
        `lexical-decomposition: source node '${edge.sourceNodeKey}' has no expectedOutputSlots — cannot compute inputSlotReads for target '${nodeKey}'`
      );
    }
    reads.push({
      fromSubTaskKey: edge.sourceNodeKey,
      slotId,
    });
  }
  return reads;
}

/**
 * Synthesize an NxsActionTemplate for a kind='nxs' node. V1 payload
 * convention: generic structure naming the operation + target +
 * operands. Mock connectors in the integration test accept this shape;
 * V2 connectors interpret it per their target system semantics.
 */
function synthesizeNxsActionTemplate(
  node: PlannerWorkflowNode,
  resolution: LexicalResolutionResult,
  targetCatalogEntries: PlannerTargetCatalog[],
  inputSlotReads: SlotReadRef[]
): NxsActionTemplate {
  const target = targetCatalogEntries[0] ?? {
    // Fallback when no target catalog entry resolved — the resourceType
    // becomes the literal target term. V2: fail-closed instead.
    system: 'unknown' as NonEmpty,
    resourceType: 'record' as NonEmpty,
    resourceScope: 'single' as NonEmpty,
    businessTerm: '',
  };

  // For each inputSlotRead, place a placeholder in rawPayload.values
  // that the slotBinding will overwrite at dispatch time.
  const values: Record<string, string> = {};
  const slotBindings: NxsSlotBinding[] = inputSlotReads.map(ref => {
    values[ref.slotId] = `\${slot:${ref.slotId}}`;
    return {
      fromSubTaskKey: ref.fromSubTaskKey,
      slotId: ref.slotId,
      payloadPath: `values.${ref.slotId}` as NonEmpty,
    };
  });

  const rawPayload = {
    operation: node.capability,
    system: target.system,
    resourceType: target.resourceType,
    resourceScope: target.resourceScope,
    operands: resolution.operands.map(o => o.operand),
    targetTerms: resolution.targets.map(t => t.targetTerm),
    values,
  };

  return {
    capability: node.capability,
    target: {
      system: target.system,
      resourceType: target.resourceType,
      resourceScope: target.resourceScope as NonEmpty,
    },
    rawPayload,
    slotBindings,
  };
}

/**
 * Build SubTaskDecl[] + SubTaskEdgeHint[] from an expanded template +
 * Layer B resolution. Each workflow node becomes one SubTaskDecl;
 * each workflow edge becomes one SubTaskEdgeHint. Agent assignment
 * picks the first candidate visible agent per node.
 *
 * Returns null if any node has zero candidate agents (caller maps to
 * `no_capable_agent`).
 */
function buildSubTasksFromTemplate(
  expanded: ExpandedTemplate,
  resolution: LexicalResolutionResult,
  targetCatalogEntries: PlannerTargetCatalog[],
  prompt: NonEmpty
): { subTasks: SubTaskDecl[]; subTaskEdges: SubTaskEdgeHint[]; missing: NonEmpty[] } | null {
  const subTasks: SubTaskDecl[] = [];
  const missing: NonEmpty[] = [];

  for (const node of expanded.nodes) {
    const candidates = expanded.agentsByNodeKey.get(node.nodeKey) ?? [];
    if (candidates.length === 0) {
      missing.push(node.capability);
      continue;
    }
    const agentId = candidates[0]!;
    const inputSlotReads = computeInputSlotReads(node.nodeKey, expanded);

    switch (node.kind) {
      case 'nxs': {
        const actionTemplate = synthesizeNxsActionTemplate(
          node,
          resolution,
          targetCatalogEntries,
          inputSlotReads
        );
        subTasks.push({
          kind: 'nxs',
          subTaskKey: node.nodeKey,
          agentId,
          taskSummary:
            `${node.capability} on ${actionTemplate.target.system}/${actionTemplate.target.resourceType}` as NonEmpty,
          expectedOutputSlots: node.expectedOutputSlots,
          inputSlotReads,
          actionTemplate,
        });
        break;
      }
      case 'nvg':
        subTasks.push({
          kind: 'nvg',
          subTaskKey: node.nodeKey,
          agentId,
          taskSummary: `nvg ${node.capability}` as NonEmpty,
          expectedOutputSlots: node.expectedOutputSlots,
          inputSlotReads,
          taskPrompt: prompt,
        });
        break;
      case 'secure_handoff':
        subTasks.push({
          kind: 'secure_handoff',
          subTaskKey: node.nodeKey,
          agentId,
          taskSummary: 'OCT_SECURE_REDACTED' as NonEmpty,
          expectedOutputSlots: node.expectedOutputSlots,
          inputSlotReads,
          taskPrompt: null,
        });
        break;
    }
  }

  if (missing.length > 0) {
    return { subTasks: [], subTaskEdges: [], missing };
  }

  // Build edges from workflow edges
  const subTaskEdges: SubTaskEdgeHint[] = expanded.edges.map((edge: PlannerWorkflowEdge) => ({
    sourceSubTaskKey: edge.sourceNodeKey,
    targetSubTaskKey: edge.targetNodeKey,
    edgeType: edge.edgeType,
    conditionSpec: null,
    outputSlotRef: edge.outputSlotRef,
  }));

  return { subTasks, subTaskEdges, missing: [] };
}

// ─── Entry point ───

/**
 * Run Layer C/D over a Layer B resolution. Returns a discriminated
 * union of outcomes consumed by Branch 4 in db-lexicon-planner.ts.
 */
export async function decomposeLexically(
  prompt: NonEmpty,
  resolution: LexicalResolutionResult,
  tables: LexiconTablesV1,
  context: PlannerContext
): Promise<LexicalDecompositionResult> {
  // Short-circuit on blocked alias from Layer B.
  if (resolution.hasBlockedAlias) {
    return {
      kind: 'blocked',
      reasonDetail: 'lexical resolution encountered a blocked alias — prompt rejected at Layer B',
    };
  }

  // ── Layer C ──
  const candidateIntents = findCandidateIntents(resolution, tables);
  if (candidateIntents.length === 0) {
    return {
      kind: 'no_intent',
      reasonDetail: `no intent matched (resolved tokens: verbs=[${resolution.verbs
        .map(v => v.canonicalVerb)
        .join(',')}], targets=[${resolution.targets
        .map(t => t.targetTerm)
        .join(',')}], operands=[${resolution.operands.map(o => o.operand).join(',')}])`,
    };
  }

  const targetCatalogEntries = resolveTargetCatalog(resolution, tables);

  // ── Layer D — template matching ──
  const { byIntent, flatList } = findCandidateTemplates(candidateIntents, tables);
  const allTemplates = flatList;

  // Ambiguity: more than one template across all candidates
  if (allTemplates.length === 0) {
    return {
      kind: 'no_intent',
      reasonDetail: `intent matched but no workflow template found (intents: ${candidateIntents
        .map(i => i.intentId)
        .join(',')})`,
    };
  }
  if (allTemplates.length > 1) {
    return {
      kind: 'ambiguous',
      candidateIntents: candidateIntents.map(i => i.intentId),
      candidateTemplates: allTemplates,
      reasonDetail: `ambiguous_intent: ${allTemplates.length} workflow templates matched equally — refusing to guess`,
    };
  }

  // Single template selected.
  const selectedIntentId = candidateIntents[0]!.intentId;
  const selectedIntentCaps = candidateIntents[0]!.requiredCapabilities;
  const templates = byIntent.get(selectedIntentId) ?? [];
  const selectedTemplate = templates[0]!;

  // ── Layer D — expand template + agent assignment ──
  const expanded = await expandTemplate(selectedTemplate, tables, context);
  const built = buildSubTasksFromTemplate(expanded, resolution, targetCatalogEntries, prompt);

  if (built === null) {
    // Shouldn't happen but defensive
    return {
      kind: 'no_intent',
      reasonDetail: 'unexpected: buildSubTasksFromTemplate returned null',
    };
  }

  if (built.missing.length > 0) {
    return {
      kind: 'no_agent',
      candidateIntents: candidateIntents.map(i => i.intentId),
      selectedIntent: selectedIntentId,
      candidateTemplates: allTemplates,
      selectedTemplate: selectedTemplate.templateId,
      requiredCapabilities: [...selectedIntentCaps],
      missingCapabilities: built.missing,
      reasonDetail: `no_capable_agent: capabilities without visible agents: ${built.missing.join(', ')}`,
    };
  }

  // Build per-capability candidate-agents list for the trace.
  const candidateAgents: { capability: NonEmpty; agentIds: Uuid[] }[] = [];
  for (const node of expanded.nodes) {
    const agents = expanded.agentsByNodeKey.get(node.nodeKey) ?? [];
    candidateAgents.push({
      capability: node.capability,
      agentIds: [...agents],
    });
  }

  return {
    kind: 'plan',
    subTasks: built.subTasks,
    subTaskEdges: built.subTaskEdges,
    candidateIntents: candidateIntents.map(i => i.intentId),
    selectedIntent: selectedIntentId,
    candidateTemplates: allTemplates,
    selectedTemplate: selectedTemplate.templateId,
    requiredCapabilities: [...selectedIntentCaps],
    candidateAgents,
  };
}

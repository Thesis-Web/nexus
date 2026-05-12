// packages/planners/db-lexicon/src/internal/types.ts
// AMEND-nexus-planner-db-lexicon-v0-2-1.md §2.1, §2.3.
//
// Internal record shapes for the 10 conceptual lexicon tables (8 on
// disk; `planner_agent_capability` is a runtime projection per §2.3;
// `planner_plan_trace` is a ledger event per §3.6, not a table).
//
// `LexiconTablesV1` is what the bootstrap-time fixture loader produces
// and the factory constructor receives. The loader builds raw record
// arrays AS AUTHORED (preserved order — part of the signed payload per
// §2.2) plus derived lookup indexes for fast per-plan-call access.

import type { NonEmpty, Uuid } from '@nexus/contracts';

// ─── Record shapes (per spec §2.1) ───

export type PhraseClass = 'verb' | 'noun' | 'business_phrase';
export type AliasStatus = 'approved' | 'blocked' | 'review_required';
export type WorkflowNodeKind = 'nxs' | 'nvg' | 'secure_handoff';
export type WorkflowEdgeType = 'data_dependency' | 'conditional' | 'sequential';
export type ResourceScope = 'single' | 'bulk' | 'collection' | 'system';

export interface PlannerLexicalTerm {
  rawTerm: string;
  canonicalTerm: string;
  phraseClass: PhraseClass;
  source: NonEmpty;
}

export interface PlannerAliasRule {
  rawTerm: string;
  canonicalTerm: string;
  status: AliasStatus;
  reason: NonEmpty;
}

export interface PlannerTaskIntent {
  intentId: NonEmpty;
  name: NonEmpty;
  description: NonEmpty;
}

export interface PlannerTaskCapability {
  intentId: NonEmpty;
  requiredCapabilities: NonEmpty[];
}

export interface PlannerTargetCatalog {
  businessTerm: string;
  system: NonEmpty;
  resourceType: NonEmpty;
  resourceScope: ResourceScope;
}

export interface PlannerWorkflowTemplate {
  templateId: NonEmpty;
  name: NonEmpty;
  description: NonEmpty;
  intentId: NonEmpty;
  nodeIds: NonEmpty[];
}

export interface PlannerWorkflowNode {
  templateId: NonEmpty;
  nodeKey: NonEmpty;
  capability: NonEmpty;
  kind: WorkflowNodeKind;
  expectedOutputSlots: NonEmpty[];
}

export interface PlannerWorkflowEdge {
  templateId: NonEmpty;
  sourceNodeKey: NonEmpty;
  targetNodeKey: NonEmpty;
  edgeType: WorkflowEdgeType;
  outputSlotRef: NonEmpty | null;
}

// ─── Signed fixture header (per spec §2.2) ───

export interface LexiconFixtureHeader {
  schemaVersion: 'v1';
  signedAt: string; // ISO timestamp
  recordCount: number;
  contentDigest: string; // hex sha256
  signature: string; // base64url Ed25519
}

// ─── In-memory tables + derived indexes ───
//
// Loader builds raw arrays AS AUTHORED (record order preserved per §2.2)
// plus derived lookup indexes for per-plan-call access. Indexes are pure
// derivations — they can be rebuilt from raw arrays at any time.

export interface LexiconTablesV1 {
  // Raw records (authored order)
  readonly lexicalTerms: ReadonlyArray<PlannerLexicalTerm>;
  readonly aliasRules: ReadonlyArray<PlannerAliasRule>;
  readonly taskIntents: ReadonlyArray<PlannerTaskIntent>;
  readonly taskCapabilities: ReadonlyArray<PlannerTaskCapability>;
  readonly targetCatalog: ReadonlyArray<PlannerTargetCatalog>;
  readonly workflowTemplates: ReadonlyArray<PlannerWorkflowTemplate>;
  readonly workflowNodes: ReadonlyArray<PlannerWorkflowNode>;
  readonly workflowEdges: ReadonlyArray<PlannerWorkflowEdge>;

  // Derived indexes (built once at load; immutable thereafter)
  readonly termByRaw: ReadonlyMap<string, ReadonlyArray<PlannerLexicalTerm>>;
  readonly aliasByRaw: ReadonlyMap<string, PlannerAliasRule>;
  readonly intentById: ReadonlyMap<string, PlannerTaskIntent>;
  readonly capabilitiesByIntent: ReadonlyMap<string, ReadonlyArray<NonEmpty>>;
  readonly targetByBusinessTerm: ReadonlyMap<string, PlannerTargetCatalog>;
  readonly templateById: ReadonlyMap<string, PlannerWorkflowTemplate>;
  readonly templatesByIntent: ReadonlyMap<string, ReadonlyArray<PlannerWorkflowTemplate>>;
  readonly nodesByTemplate: ReadonlyMap<string, ReadonlyArray<PlannerWorkflowNode>>;
  readonly edgesByTemplate: ReadonlyMap<string, ReadonlyArray<PlannerWorkflowEdge>>;
}

// ─── Lexical resolver output shape (per spec §3.3.4 Layer B) ───
//
// Three distinct streams — verbs, targets, operands. NOT dotted
// compound canonicals like `read.target`. This is what Layer B feeds
// to Layer C.

export interface ResolvedVerb {
  rawTerm: string;
  canonicalVerb: NonEmpty;
  aliasRule: AliasStatus | null;
}

export interface ResolvedTarget {
  rawTerm: string;
  targetTerm: string;
  /** Optional filter value embedded in the phrase, e.g. 'product A' → 'A'. */
  value: string | null;
}

export interface ResolvedOperand {
  rawTerm: string;
  operand: string;
}

export interface LexicalResolutionResult {
  verbs: ReadonlyArray<ResolvedVerb>;
  targets: ReadonlyArray<ResolvedTarget>;
  operands: ReadonlyArray<ResolvedOperand>;
  /** Unmatched tokens (after greedy phrase matching). Empty when every
   *  meaningful token resolved to verb/target/operand or was a stop-word. */
  unmatched: ReadonlyArray<string>;
  /** Convenience flag — true when any alias rule status is `'blocked'`. */
  hasBlockedAlias: boolean;
}

// ─── Layer C output shape ───

export interface IntentCandidate {
  intentId: NonEmpty;
  requiredCapabilities: ReadonlyArray<NonEmpty>;
}

// ─── Layer D output shape ───

export interface ExpandedTemplate {
  template: PlannerWorkflowTemplate;
  nodes: ReadonlyArray<PlannerWorkflowNode>;
  edges: ReadonlyArray<PlannerWorkflowEdge>;
  /** Per node, the candidate agent IDs that match its capability. Filtered
   *  by capability ceiling already; empty array means no visible agent. */
  agentsByNodeKey: ReadonlyMap<string, ReadonlyArray<Uuid>>;
}

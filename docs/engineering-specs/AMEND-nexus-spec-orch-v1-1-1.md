# Nexus Stack — Engineering Spec Amendment: Orch-Ref

# Version: v1.1.1
# Filename: AMEND-nexus-spec-orch-v1-1-1.md
# Status: RATIFIED — subordinate implementation law for AMEND-nexus-blueprint-orch-v1-1-1.md
#
# ───── SUPERSESSION NOTICE (added 2026-05-13 per Commit 7 of
#       AMEND-nexus-planner-db-lexicon-v0-2-1.md §6.2) ─────
#
# The `RefDeterministicPlanner` class and `plannerType: 'ref-deterministic'`
# value referenced throughout §0–§14 below were V1 scaffolding. They have
# been REPLACED by `DbLexiconTransformerPlanner` and
# `plannerType: 'db-lexicon-transformer-v0'` per
# AMEND-nexus-planner-db-lexicon-v0-2-1.md. The replacement is exhaustive:
#
#   - Class file `packages/orch-ref/src/ref-deterministic-planner.ts`
#     was DELETED in Commit 6 (HEAD 48e8477).
#   - Reusable plan-assembly primitives (`planFromSubTasks`,
#     `planStandard`, `planOctSecure`, `hasCycle`, `compareEdges`,
#     `buildPlan`, etc.) were extracted to
#     `packages/orch-ref/src/plan-assembly.ts` in Commit 1.
#   - Condition + dispatch utilities (`evaluateCondition`,
#     `determineNodeType`) were extracted to
#     `packages/orch-ref/src/condition-evaluator.ts` in Commit 1.
#   - The new planner lives in
#     `packages/planners/db-lexicon/src/db-lexicon-planner.ts` and is
#     registered with the orchestrator manifest as
#     `plannerType: 'db-lexicon-transformer-v0'`.
#
# Sections affected by this supersession (read these passages with the
# replacement in mind):
#
#   §1 Repository Placement — file rows 110 + 140 reference the deleted
#     class file path; replaced by the new package layout.
#   §5 Reference Deterministic Planner — entire section describes the
#     deleted class; preserved as historical background; the production
#     reference planner is now `DbLexiconTransformerPlanner` per the AMEND
#     §3.1–§3.3.
#   §10.1 Bootstrap steps — step 22 / step 23 narrative replaced by
#     bootstrap step 17b (PlannerFactoryRegistry) + 18a (lexicon fixture
#     load + factory registration) + 22c (registry resolution); see
#     AMEND §4.1.
#   §10.2 Manifest example — YAML block uses 'ref-deterministic' as
#     historical example; the live signed manifest at
#     config/orchestrators/orchestrators.v1.yaml uses
#     plannerType: 'db-lexicon-transformer-v0', maxSplitDepth: 3,
#     plannerVersion: '0.1.0'.
#   §10.3 Composition root law — `RefDeterministicPlanner` in the
#     forbidden-construction list of API routes still applies as a
#     historical statement; under the AMEND the equivalent rule is "API
#     routes MUST NOT construct any Planner implementation directly",
#     which the §6.5 package-layer law in the AMEND enforces.
#   §11 CI Gates ORCH-01 — historical gate description of "Planner
#     interface — RefDeterministicPlanner implements Planner" is now
#     satisfied by the equivalent test for DbLexiconTransformerPlanner +
#     PlannerTraceReader interfaces (see AMEND §9.1).
#   §12 ORCH-PUSH-02 — historical record of the original build push.
#     Final V1 packaging lives under AMEND §6.2 (7-commit migration).
#
# Tests proving the AMEND production cut: db-lexicon-planner.test.ts (14
# tests covering four-branch dispatch + trace/checkback stash) +
# plan-assembly.test.ts (54 tests covering extracted primitives) +
# condition-evaluator.test.ts (14 tests covering evaluateCondition +
# determineNodeType) + fixture-loader.test.ts (5 tests covering signed
# JSONL load + cross-fixture invariants) + lexical-resolver.test.ts (6
# tests covering tokenization + alias rules + ACTION_VERB invariant) +
# planner-factory-registry.test.ts (4 tests).
#
# ────────────────────────────────────────────────────────────
# Owner: James Huson / Lake Area LLC
# Ratified: 2026-05-02
# Governing blueprint: AMEND-nexus-blueprint-orch-v1-1-1.md
# Purpose: implementation law for orch-ref only
#
# Ratification history:
# - 7 audit rounds, ~50 findings total, all resolved
# - 24 CI gates defined, 6-push build order
# - 5 owner decisions applied (OD-ORCH-01 through OD-ORCH-05)
# - Promoted from DRAFT v0.3.7
#
# v0.3.6 changes from v0.3.5:
# - ORCH35-F01: Executor loop guard fixed — cancel check inside loop, not in
#   while condition; skipAllPendingAndReady covers both statuses
# - ORCH35-F02: Cancel route added to §1.3; route law note added
# - ORCH35-F04: run_cancelled event field names corrected for forensic honesty
#   (totalSkipped, totalCompleted — not cancel-specific derivations)
# - ORCH35-H01: activeRuns registration wrapped in try/finally; executor-throw
#   terminal behavior defined
# - ORCH35-F03: Logged as HOLE-ORCH-003 (V2 — coordinator-side planner
#   validation for enterprise replacement planners)
#
# v0.3.5 changes from v0.3.4:
# - ORCH34-F01: V1 active-run state tracking added to RunCoordinator; cancelRun
#   locates RunDagState by runId via in-memory map
# - ORCH34-F02: Cancelled-run terminal classification added before normal DAG
#   classification; cancelled runs do NOT emit dag_completed, do NOT compile
# - ORCH34-M01: ORCH-12 gate updated to test cancel terminal closure
# - run_cancelled event minimums updated with runId and reason
#
# v0.3.4 changes from v0.3.3:
# - HOLE-ORCH-001: Orchestrator socket extended with cancel method; RefOrchestrator implements it
# - ORCH33-M01: final_response + run_closed rows added to §4.7 event detail table
# - HOLE-ORCH-002: DelegationScope type defined in §7.1 (orch-ref-internal)
# - EDITORIAL-ORCH-001: §8.2 section numbering corrected (was §8.3)
#
# v0.3.3 changes from v0.3.2:
# - F01: Orch-ref writes final_response + run_closed when compile_skipped
# - F02: compileEligible aligned with DAG classification (requires enabled+compileOnPartial)
# - F02: Manifest validation: compileOnPartial=true requires enabled=true
# - H01: Amendment flow reordered — validate merge before issuing delegations

---

## 0. Precedence and Scope

### 0.1 Law Stack

1. `nexus-complete-end-to-end-flow-v4.8.md`
2. `nexus-owner-ratification-v1-4-12.md`
3. `nexus-blueprint-v1-5-13.md`
4. `AMEND-nexus-blueprint-orch-v1-1-1.md` — orch-ref blueprint law (Amendment K)
5. `AMEND-blueprint-nexus-infra-externals-v1-0-0.md`
6. `nexus-engineering-spec-v1-8-26.md`
7. `AMEND-spec-nexus-infra-externals-v0-2-5.md`
8. `AMEND-spec-nexus-compile-1-0-0.md`
9. This spec (`AMEND-nexus-spec-orch-v1-1-1.md`) — orch-ref implementation law only
10. Repo implementation

Blueprint wins all conflicts. Holes require owner-approved best-solve before
the builder proceeds.

### 0.2 Scope

Builds the reference orchestrator with pluggable deterministic planner, DAG
executor, and run coordinator. Does NOT build:
- Production orchestrator intelligence [blueprint §36.2]
- Multi-party orchestrator / orchestration trees [blueprint §36.2]
- LLM-assisted planner [blueprint-K §11.4.1 — deferred to future planner type]
- Workspace DAG display UI [workspace-ref scope]
- Production agent registry persistence [future scope]
- Free-text capability inference [OD-ORCH-01 — V2]
- Full distributed cancel/abort propagation [OD-ORCH-05 — deferred]

### 0.3 Spec Approach — Pin-Back, No Echo

This spec does not duplicate blueprint law. Where the blueprint defines
architecture, invariants, boundaries, or replacement rules, this spec pins
back with `[blueprint §X.Y]` or `[blueprint-K §X.Y]`. The builder reads
both documents.

This spec owns: TypeScript interfaces, file paths, naming, pseudo code,
build steps, CI gates, push sequence. The blueprint owns the WHY. This
spec owns the HOW and WHAT.

### 0.4 Naming Law

| Name | Package | What | Blueprint Pin |
|---|---|---|---|
| `Planner` | contracts/externals | Pluggable planner socket interface | [blueprint-K §11.4.3] |
| `PlannerFactory` | contracts/externals | Factory for planner construction | [blueprint-K §11.4.4] |
| `PlannerFactoryRegistry` | contracts/externals | Factory registry for planner types | [blueprint-K §11.4.4] |
| `PlannerRequest` | contracts/externals | Visibility-safe request union | [blueprint-K §11.5] |
| `NormalPlannerRequest` | contracts/externals | Full prompt visible | [blueprint-K §11.5.1] |
| `MetadataPlannerRequest` | contracts/externals | Structured metadata only | [blueprint-K §11.5.2] |
| `OctSecurePlannerRequest` | contracts/externals | Auth tokens only, no content | [blueprint-K §11.5.3] |
| `ExecutionPlan` | contracts/externals | DAG structure: nodes + edges | [blueprint-K §11.6.1] |
| `PlanNode` | contracts/externals | Single agent task assignment | [blueprint-K §11.6.1] |
| `PlanEdge` | contracts/externals | Dependency/condition between nodes | [blueprint-K §11.6.1] |
| `PlanCondition` | contracts/externals | Condition for conditional edges | [blueprint-K §11.6.2] |
| `PlanRejection` | contracts/externals | Typed planner rejection | [blueprint-K §11.4.3] |
| `NodeStatus` | contracts/externals | Per-node lifecycle state | [blueprint-K §11.6.2] |
| `RunDagState` | contracts/externals | Full DAG runtime state | [blueprint-K §11.6.2] |
| `PromptVisibilityTier` | contracts/externals | normal / metadata / oct_secure | [blueprint-K §11.5] |
| `DbLexiconTransformerPlanner` | planners/db-lexicon | V1 reference planner — lexicon-backed prompt decomposition (was `RefDeterministicPlanner`; replaced per AMEND-nexus-planner-db-lexicon-v0-2-1.md §3.2) | [blueprint-K §11.4.1] |
| `DagExecutor` | orch-ref | DAG execution engine | [blueprint-K §11.4.1] |
| `RunCoordinator` | orch-ref | Run lifecycle manager | [blueprint-K §11.4.1] |
| `PlanAmendmentHandler` | orch-ref | Mid-run plan extension | [blueprint-K §11.6.6] |
| `DelegationScope` | orch-ref | Plan-node context for delegation issuer callback | [blueprint §11.3] |
| `RefOrchestrator` | orch-ref | Assembled reference orch | [blueprint §11.1] |

---

## 1. Repository Placement

### 1.1 New Package

| Package | Path | Layer |
|---|---|---|
| `@nexus/orch-ref` | `packages/orch-ref/` | External reference — imports Layer 2 ONLY |

Follows `packages/identity-ref/` pattern [OD-ORCH-03]. Reference implementation
of the Orchestrator socket. Enterprise replaces by swapping the whole package or
by swapping the planner component within it.

Import rule: `packages/orch-ref/` imports `@nexus/contracts` ONLY. It must
never import core, vanguard, adapters, connectors, or interfaces.

### 1.2 New Files

| File | Path |
|---|---|
| `planner.ts` | `packages/contracts/src/externals/planner.ts` |
| `execution-plan.ts` | `packages/contracts/src/externals/execution-plan.ts` |
| `db-lexicon-planner.ts` | `packages/planners/db-lexicon/src/db-lexicon-planner.ts` (was `packages/orch-ref/src/ref-deterministic-planner.ts`; replaced per AMEND-nexus-planner-db-lexicon-v0-2-1.md §6.2 Commit 6) |
| `plan-assembly.ts` | `packages/orch-ref/src/plan-assembly.ts` (extracted plan-assembly primitives — `planStandard`, `planFromSubTasks`, `planOctSecure`, `hasCycle`, `compareEdges`, `buildPlan`; per AMEND-nexus-planner-db-lexicon-v0-2-1.md §6.2 Commit 1) |
| `condition-evaluator.ts` | `packages/orch-ref/src/condition-evaluator.ts` (extracted `evaluateCondition` + `determineNodeType`; per AMEND-nexus-planner-db-lexicon-v0-2-1.md §6.2 Commit 1) |
| `dag-executor.ts` | `packages/orch-ref/src/dag-executor.ts` |
| `run-coordinator.ts` | `packages/orch-ref/src/run-coordinator.ts` |
| `plan-amendment.ts` | `packages/orch-ref/src/plan-amendment.ts` |
| `ref-orchestrator.ts` | `packages/orch-ref/src/ref-orchestrator.ts` |
| `index.ts` | `packages/orch-ref/src/index.ts` |
| `package.json` | `packages/orch-ref/package.json` |
| `tsconfig.json` | `packages/orch-ref/tsconfig.json` |

### 1.3 Extended Files

| File | Change |
|---|---|
| `contracts/src/externals/orchestrator.ts` | Extend OrchestratorPlanPreview with plan reference; extend Orchestrator socket with cancel method |
| `contracts/src/externals/manifests.ts` | Extend OrchestratorManifestRecord |
| `contracts/src/externals/factories.ts` | Add PlannerFactory |
| `contracts/src/externals/factory-registries.ts` | Add PlannerFactoryRegistry |
| `contracts/src/externals/index.ts` | Barrel exports for new files |
| `contracts/src/interfaces/index.ts` | Add orch-ref RunEventType values |
| `interfaces/api/src/routes/orchestrator.ts` | Enhance dispatch route; add cancel route |
| `pnpm-workspace.yaml` | Add packages/orch-ref |
| `turbo.json` | Add orch-ref build target |

### 1.4 Rules

No Zod in contracts. `orch-ref` imports contracts ONLY. `strictNullChecks` +
`exactOptionalPropertyTypes` apply. Reference harness route receives
pre-constructed services through composition root [§10.3].

---

## 2. Contracts — `planner.ts`

```typescript
// packages/contracts/src/externals/planner.ts
// AMEND-spec-nexus-orch §2 — Planner Socket Interface
// Layer 2 — pluggable planner contract.
//
// Planner authority bounds [blueprint-K §11.4.5]:
// - Planner MAY reject for orchestration feasibility reasons
// - Planner MUST NOT perform authorization, risk adjudication, policy deny,
//   OCT enforcement, or substitute for NXS/NVG decisions
// - Planner uses identity-provider ceiling as catalog visibility filter,
//   not authorization [blueprint-K §11.7.1]

import type { Uuid, NonEmpty, IsoTimestamp } from '../types/index.js';
import type { ExecutionPlan, PlanRejection } from './execution-plan.js';

// ─── PromptVisibilityTier ───
// [blueprint-K §11.5, §11.5.4]
// OCT floor is non-negotiable. Policy can elevate, never lower.

export type PromptVisibilityTier = 'normal' | 'metadata' | 'oct_secure';

// ─── AgentRegistryReader ───
// Read-only view of agent registry for planner consultation.
// Planner never mutates the registry [blueprint-K §11.4.3].

export interface AgentCapabilityEntry {
  agentId: Uuid;
  actorClass: NonEmpty;
  capabilities: NonEmpty[];
  octTier: NonEmpty;
  environment: NonEmpty;
  enabled: boolean;
}

export interface AgentRegistryReader {
  findByCapability(capability: NonEmpty): Promise<AgentCapabilityEntry[]>;
  getById(agentId: Uuid): Promise<AgentCapabilityEntry | null>;
  listVisible(capabilityCeiling: NonEmpty[]): Promise<AgentCapabilityEntry[]>;
}

// ─── PlannerRequest — visibility-safe union ───
// Type-level enforcement: oct_secure physically cannot carry prompt content.
// [blueprint-K §11.5.1–§11.5.3]

export interface NormalPlannerRequest {
  tier: 'normal';
  runId: Uuid;
  userId: NonEmpty;
  principalId: Uuid;
  prompt: NonEmpty;
  selectedAgentIds: Uuid[];
  requiredCapabilities: NonEmpty[];
  edgeHints: EdgeHint[];
  workspaceSocketId: NonEmpty;
  planCheckbackRequested: boolean;
  enteredAt: IsoTimestamp;
}

export interface MetadataPlannerRequest {
  tier: 'metadata';
  runId: Uuid;
  userId: NonEmpty;
  principalId: Uuid;
  // NO prompt field — planner sees structured metadata only
  requiredCapabilities: NonEmpty[];
  requiredSystemTargets: NonEmpty[];
  selectedAgentIds: Uuid[];
  edgeHints: EdgeHint[];
  templateRef: NonEmpty | null;
  taskShape: { subTaskCount: number; expectedOutputTypes: NonEmpty[] };
  workspaceSocketId: NonEmpty;
  planCheckbackRequested: boolean;
  enteredAt: IsoTimestamp;
}

export interface OctSecurePlannerRequest {
  tier: 'oct_secure';
  runId: Uuid;
  userId: NonEmpty;
  principalId: Uuid;
  // NO prompt, NO metadata, NO capabilities, NO task shape
  // Planner sees auth identity only [blueprint-K §11.5.3]
  secureAgentId: Uuid;
  workspaceSocketId: NonEmpty;
  enteredAt: IsoTimestamp;
}

export type PlannerRequest =
  | NormalPlannerRequest
  | MetadataPlannerRequest
  | OctSecurePlannerRequest;

// ─── EdgeHint ───
// User-provided dependency hints. Optional [OD-ORCH-02].
// Absent → all-parallel. Present → validated as DAG.

export interface EdgeHint {
  sourceAgentId: Uuid;
  targetAgentId: Uuid;
  edgeType: 'data_dependency' | 'conditional' | 'sequential';
  conditionSpec: { sourceField: NonEmpty; operator: string; value: unknown } | null;
  outputSlotRef: NonEmpty | null;
}

// EdgeHint normalization law:
// - conditionSpec.operator MUST be one of PlanConditionOperator.
// - conditionSpec.value MUST be string | number | boolean | null.
// - Conditional edge requires non-null conditionSpec.
// - Non-conditional edge requires conditionSpec === null.
// - Invalid conditionSpec rejects plan as malformed_request.
// Planner validates all EdgeHints before constructing PlanEdges.

// ─── PlannerContext ───

export interface PlannerContext {
  registry: AgentRegistryReader;
  capabilityCeiling: NonEmpty[];
  maxSplitDepth: number;
}

// ─── Planner ───

export interface Planner {
  readonly plannerType: NonEmpty;
  readonly plannerVersion: NonEmpty;
  plan(
    request: PlannerRequest,
    context: PlannerContext,
  ): Promise<ExecutionPlan | PlanRejection>;
}
```

---

## 3. Contracts — `execution-plan.ts`

```typescript
// packages/contracts/src/externals/execution-plan.ts
// AMEND-spec-nexus-orch §3 — Execution Plan Types
// Layer 2 — DAG structure produced by planner, consumed by executor.
//
// Replay determinism law [blueprint-K §11.6.5]:
// - planOrderIndex is immutable per node
// - Monotonic run sequence is sole ordering authority
// - Wall-clock timestamps are evidence metadata, not ordering input
// - planDigest excludes createdAt

import type { Uuid, NonEmpty, Sha256Hex, IsoTimestamp } from '../types/index.js';
import type { EvidenceSentinel } from '../constants/index.js';

// ─── PlanNode ───

export interface PlanNode {
  nodeId: Uuid;
  planOrderIndex: number;                // immutable, assigned at plan creation
  agentId: Uuid;
  taskSummary: NonEmpty;                  // metadata-only ref per visibility tier
  requiresNvg: boolean;
  requiresNxs: boolean;
  // Dispatch law [§5.4]:
  // - nvg_dispatch: requiresNvg=true, requiresNxs=false
  // - nxs_dispatch: requiresNvg=false, requiresNxs=true
  // - local_control: both false, agentId MUST equal orchestratorActorId,
  //   no external dispatch occurs
  // - secure_agent_handoff: both false, taskSummary MUST equal
  //   'OCT_SECURE_REDACTED', no prompt/metadata/capabilities in node,
  //   dispatch creates delegation+mailbox handoff only, secure agent
  //   performs its own NVG/NXS under delegated authority
  // - Both requiresNvg and requiresNxs true → malformed_request
  nodeType: 'nvg_dispatch' | 'nxs_dispatch' | 'local_control' | 'secure_agent_handoff';
  declaredRiskHint: EvidenceSentinel;
  // declaredRiskHint is non-authoritative metadata for UX/preflight
  // display only. It MUST NOT be used for NXS policy, delegation,
  // approval, grant, or denial decisions. Gate 02 remains the only
  // risk classification authority. V1 always EVIDENCE_SENTINEL.
  expectedOutputSlots: NonEmpty[];
  timeoutMs: number;
}

// ─── PlanEdgeType ───

export type PlanEdgeType =
  | 'data_dependency'
  | 'conditional'
  | 'sequential';

// ─── PlanCondition ───
// Type coercion law [§3.1]:
// - gt/lt valid only when both source value and condition value are
//   finite numbers. No string numeric coercion.
// - Type mismatch evaluates false with reason: 'type_mismatch'.
// - equals/not_equals use strict equality (===).
// - exists/not_exists check value !== undefined && value !== null.

export type PlanConditionOperator =
  | 'equals' | 'not_equals'
  | 'exists' | 'not_exists'
  | 'gt' | 'lt';

export interface PlanCondition {
  conditionId: Uuid;
  sourceField: NonEmpty;
  operator: PlanConditionOperator;
  value: string | number | boolean | null;
}

// §3.1 — Condition evaluation law
// gt/lt: if typeof sourceValue !== 'number' || !isFinite(sourceValue)
//        || typeof condition.value !== 'number' || !isFinite(condition.value)
//        → result = false, reason = 'type_mismatch'
// equals: sourceValue === condition.value (strict)
// not_equals: sourceValue !== condition.value (strict)
// exists: sourceValue !== undefined && sourceValue !== null
// not_exists: sourceValue === undefined || sourceValue === null

// ─── PlanEdge ───

export interface PlanEdge {
  edgeId: Uuid;
  sourceNodeId: Uuid;
  targetNodeId: Uuid;
  edgeType: PlanEdgeType;
  condition: PlanCondition | null;      // non-null only for 'conditional' edges
  outputSlotRef: NonEmpty | null;       // which output slot from source feeds target
}

// ─── ExecutionPlan ───
// planDigest law [§3.2]:
// planDigest = sha256(canonicalize({
//   planId, runId,
//   nodes sorted by planOrderIndex,
//   edges sorted by [sourceNodeId, targetNodeId, edgeType, edgeId],
//   plannerType, plannerVersion
// }))
// createdAt is EXCLUDED from digest — evidence metadata only.

export interface ExecutionPlan {
  planId: Uuid;
  runId: Uuid;
  planDigest: Sha256Hex;
  nodes: PlanNode[];                     // sorted by planOrderIndex
  edges: PlanEdge[];                     // sorted by [sourceNodeId, targetNodeId, edgeType, edgeId]
  plannerType: NonEmpty;
  plannerVersion: NonEmpty;
  createdAt: IsoTimestamp;               // evidence metadata only, excluded from digest
}

// ─── PlanRejection ───
// All rejection reasons are orchestration feasibility, never governance.
// [blueprint-K §11.4.5, §11.7.3]

export type PlanRejectionReason =
  | 'no_capable_agent'
  | 'capability_outside_ceiling'
  | 'unmappable_request'
  | 'structural_constraint'
  | 'malformed_request'
  | 'max_split_exceeded';

export interface PlanRejection {
  rejected: true;
  reason: PlanRejectionReason;
  reasonDetail: NonEmpty;
  suggestedAlternatives: SuggestedAgent[];
}

export interface SuggestedAgent {
  agentId: Uuid;
  capability: NonEmpty;
  reason: NonEmpty;
}

// ─── NodeStatus (runtime) ───

export type NodeStatusType =
  | 'pending' | 'ready' | 'dispatched'
  | 'completed' | 'failed' | 'skipped' | 'timed_out';

export interface NodeStatus {
  nodeId: Uuid;
  planOrderIndex: number;               // copied from PlanNode for sort stability
  status: NodeStatusType;
  runSequence: number;                   // monotonic counter at last state change
  completionMetadata: Record<string, unknown> | null;
  failureReason: NonEmpty | null;
  governanceDenied: boolean;
}

// ─── NodeDelegationBinding ───
// Each dispatchable node MUST have exactly one binding before dispatch.
// Missing binding → node_failed with reason 'delegation_missing'.

export interface NodeDelegationBinding {
  nodeId: Uuid;
  agentId: Uuid;
  delegationId: Uuid;
}

// ─── RunDagState (runtime) ───
// NodeStatus[] sorted by planOrderIndex for deterministic replay.
// No Map — JSON-safe, canonicalization-friendly.

export interface RunDagState {
  plan: ExecutionPlan;
  nodeStatuses: NodeStatus[];            // sorted by planOrderIndex, always
  nodeDelegations: NodeDelegationBinding[];
  runSequenceCounter: number;            // monotonic, incremented on every event
  amendmentCount: number;
  cancelled: boolean;                    // cancel signal [OD-ORCH-05]
}
```

---

## 4. Contract Extensions

### 4.1 Extend `orchestrator.ts`

Add to `OrchestratorPlanPreview`:

```typescript
import type { ExecutionPlan } from './execution-plan.js';

// Add to OrchestratorPlanPreview:
plan: ExecutionPlan | null;              // null = legacy flat preview, non-null = DAG
```

Add to `Orchestrator` socket interface:

```typescript
// Add to Orchestrator:
cancel(runId: Uuid): Promise<void>;      // V1 minimal cancel [OD-ORCH-05]
```

Cancel law: the socket cancel method surfaces the V1 minimal cancel signal.
The orchestrator implementation sets `RunDagState.cancelled = true`. Executor
loop detects on next iteration. Pending → skipped, ready → skipped, in-flight →
completes. Full distributed cancellation with AbortSignal deferred [OD-ORCH-05].

### 4.2 Extend `manifests.ts`

Add to `OrchestratorManifestRecord`:

```typescript
plannerType: NonEmpty;
plannerVersion: NonEmpty;
plannerConfiguration: Record<string, unknown>;
planAmendment: {
  enabled: boolean;
  maxAmendments: number;
  requiresCheckback: boolean;
};
partialCompletion: {
  enabled: boolean;
  minRequiredCompletedNodes: number;
  compileOnPartial: boolean;
};
```

### 4.3 Extend `factories.ts`

```typescript
import type { Planner } from './planner.js';
import type { OrchestratorManifestRecord } from './manifests.js';

export interface PlannerFactory {
  readonly plannerType: NonEmpty;
  readonly factoryVersion: NonEmpty;
  create(record: OrchestratorManifestRecord): Promise<Planner>;
}
```

### 4.4 Extend `factory-registries.ts`

```typescript
import type { PlannerFactory } from './factories.js';

export interface PlannerFactoryRegistry {
  register(factory: PlannerFactory): void;
  get(plannerType: string): PlannerFactory | null;
  list(): PlannerFactory[];
}
```

### 4.5 Extend `index.ts` (barrel)

Add exports for all types from `planner.ts` and `execution-plan.ts`, including:
`NodeDelegationBinding`, `PlannerRequest`, `NormalPlannerRequest`,
`MetadataPlannerRequest`, `OctSecurePlannerRequest`, `EdgeHint`,
`PlannerFactory` (from factories.ts), `PlannerFactoryRegistry` (from factory-registries.ts).

### 4.6 Extend `RunEventType`

```typescript
// ── Orch-Ref Run Ledger Events (AMEND-spec-nexus-orch §4.6) ──────
| 'plan_created'
| 'plan_checkback_sent'
| 'plan_confirmed'
| 'plan_rejected'
| 'node_dispatched'
| 'node_completed'
| 'node_failed'
| 'node_skipped'
| 'node_timed_out'
| 'dependency_resolved'
| 'condition_evaluated'
| 'plan_amended'
| 'dag_completed'
| 'dag_partial_complete'
| 'dag_failed'
| 'compile_triggered'
| 'compile_skipped'
| 'run_cancelled'
```

### 4.7 Run Ledger Event Detail Minimums

Every Run Ledger event emitted by orch-ref must include at minimum:

| Event | Required Detail Fields |
|---|---|
| `plan_created` | planId, planDigest, plannerType, nodeCount, edgeCount |
| `plan_checkback_sent` | planId |
| `plan_confirmed` | planId |
| `plan_rejected` | reason, reasonDetail, suggestedCount |
| `delegation_issued` | planId, nodeId, agentId, delegationId (inherited from base RunEventType; orch-ref emits with these minimums) |
| `node_dispatched` | planId, nodeId, agentId, nodeType, runSequence |
| `node_completed` | planId, nodeId, agentId, runSequence |
| `node_failed` | planId, nodeId, failureReason, governanceDenied, runSequence |
| `node_skipped` | planId, nodeId, reason, runSequence |
| `node_timed_out` | planId, nodeId, timeoutMs, runSequence |
| `dependency_resolved` | edgeId, sourceNodeId, targetNodeId, runSequence |
| `condition_evaluated` | edgeId, conditionId, result, reason, runSequence |
| `plan_amended` | originalPlanId, originalPlanDigest, amendmentPlanId, amendmentPlanDigest, mergedPlanId, mergedPlanDigest, approved, reason, newNodeCount, newEdgeCount |
| `dag_completed` | planId, completedCount |
| `dag_partial_complete` | planId, completedCount, failedCount, skippedCount |
| `dag_failed` | planId, completedCount, failedCount, skippedCount, reason |
| `compile_triggered` | planId, runId |
| `compile_skipped` | planId, runId, reason |
| `final_response` | planId, runId, outcome, payload |
| `run_closed` | planId, runId, closedBy, reason |
| `run_cancelled` | planId, runId, totalSkipped, totalCompleted, reason |

### 4.8 Compile Handoff Boundary

Orch-ref MUST write `compile_triggered` before calling `triggerCompile()`.
Compile-ref / compile-return owns: `compile_started`, `compile_mode_selected`,
`compile_assembly_complete`, `final_response`, `run_closed` — but ONLY when
`compile_triggered` occurs.

When `compile_skipped` occurs (no compile invoked), orch-ref owns terminal
run closure: orch-ref writes `final_response` with no-result payload and
`run_closed`. This ensures every run path closes the Run Ledger regardless
of whether compilation occurs.

When `run_cancelled` occurs, orch-ref owns terminal run closure: orch-ref
writes `run_cancelled`, `compile_skipped` (reason: `run_cancelled`),
`final_response` (outcome: `cancelled`), and `run_closed` (reason:
`run_cancelled`). A cancelled run MUST NOT emit `dag_completed`,
`dag_partial_complete`, or `dag_failed`. A cancelled run MUST NOT call
`triggerCompile()`. Cancellation is checked before DAG completion
classification [§7.2 step 7].

Three terminal paths exist:
1. **compile_triggered** → compile-ref/compile-return owns closure
2. **compile_skipped** (no eligible results) → orch-ref owns closure
3. **run_cancelled** → orch-ref owns closure (compile never considered)

If compile-ref rejects or fails after `compile_triggered`, the compile-return
rejection path MUST close or terminally mark the run per compile-return law
[AMEND-spec-nexus-compile §11].

### 4.8.1 Manifest Validation Rule

`partialCompletion.compileOnPartial` MUST be `false` when
`partialCompletion.enabled` is `false`. Bootstrap manifest loading MUST
reject this combination. This prevents the impossible state where partial
compilation is requested but partial completion is disabled.

### 4.9 DAG Completion Classification

DAG completion classification applies ONLY to non-cancelled runs. Cancelled
runs are handled by the cancellation terminal path [§4.8] before this
classification executes.

```
// Precondition: dagResult.finalState.cancelled === false
if failedNodes.length == 0:
  emit dag_completed
else if completedNodes.length > 0
    && manifest.partialCompletion.enabled
    && manifest.partialCompletion.compileOnPartial:
  emit dag_partial_complete
else:
  emit dag_failed
```

`dag_partial_complete` is emitted ONLY when partial results are policy-eligible
for compilation. A fully failed DAG with no compile eligibility emits `dag_failed`.

---

## 5. Reference Deterministic Planner

**SUPERSEDED** by AMEND-nexus-planner-db-lexicon-v0-2-1.md §3 (replacement
planner) + §6.2 Commit 6 (class deletion). The section below describes
the original V1 scaffolding planner; the production reference planner is
now `DbLexiconTransformerPlanner` at
`packages/planners/db-lexicon/src/db-lexicon-planner.ts`. The reusable
plan-assembly primitives the original class hosted live in
`packages/orch-ref/src/plan-assembly.ts` and serve both the new planner
and test-stub planners.

Historical record below.

File (HISTORICAL): `packages/orch-ref/src/ref-deterministic-planner.ts` — deleted in Commit 6 of the AMEND.

Implements `Planner` interface [blueprint-K §11.4.1, §11.4.3].

### 5.1 Behavior

V1 deterministic planner. No LLM. Structured rule evaluator.

1. Match on `request.tier` discriminant:
   - `'oct_secure'` → create single-node plan for `secureAgentId`. No prompt
     content available to planner. Single node, no edges.
     `nodeType` = `'secure_agent_handoff'`.
     `taskSummary` = `'OCT_SECURE_REDACTED'`.
   - `'metadata'` → match `requiredCapabilities` against registry. If
     `selectedAgentIds` present, use as hints. Build nodes and edges from
     `edgeHints`.
   - `'normal'` → same as metadata but planner may also read `prompt` for
     additional matching context. V1: does not use prompt for inference —
     relies on `selectedAgentIds` and `requiredCapabilities` [OD-ORCH-01].
2. Validate `selectedAgentIds`: each must exist in registry and be visible
   under `capabilityCeiling`. Missing → suggest-not-deny [§5.2].
3. If `selectedAgentIds` empty AND `requiredCapabilities` empty → reject
   `malformed_request` ("V1 requires explicit agent selection or capabilities").
4. For each agent, create `PlanNode`. Assign `planOrderIndex` sequentially (0, 1, 2...).
5. Set `nodeType` from `requiresNvg`/`requiresNxs` per dispatch law [§5.4].
6. Set `declaredRiskHint` = `EVIDENCE_SENTINEL` always in V1.
7. Build edges from `edgeHints` [OD-ORCH-02]. If no edgeHints → no edges (all-parallel).
8. Validate DAG acyclicity. Cycle → reject `malformed_request`.
9. Validate `maxSplitDepth`. Exceeds → reject `max_split_exceeded`.
10. Sort nodes by `planOrderIndex`, edges by `[sourceNodeId, targetNodeId, edgeType, edgeId]`.
11. Compute `planDigest` excluding `createdAt` [§3.2].
12. Return `ExecutionPlan`.

### 5.2 Suggest-Not-Deny Logic

When a requested agent lacks a capability [blueprint-K §11.7.1, §11.7.2]:

```
if agent not in registry OR not visible under ceiling:
  alternatives = registry.findByCapability(neededCapability)
    .filter(visible under capabilityCeiling)
  return PlanRejection {
    reason: 'no_capable_agent' or 'capability_outside_ceiling',
    suggestedAlternatives: alternatives
  }
```

Ceiling is catalog visibility only, not authorization [blueprint-K §11.7.1].

### 5.3 Planner Authority Boundary

FORBIDDEN — governance decisions [blueprint-K §11.4.5]:
```
❌ if (policy.denies(action)) reject
❌ if (riskTier > actor.octCeiling) reject
❌ if (!delegation.allows(system)) reject
❌ if (!session.isValid()) reject
```

PERMITTED — feasibility checks [blueprint-K §11.4.5]:
```
✅ if (!registry.has(agentId)) reject
✅ if (!agent.capabilities.includes(needed)) suggest alternative
✅ if (nodeCount > manifest.maxSplitDepth) reject
✅ if (octSecure && multiAgent && !manifest.secureMode.allowSecureMultiAgent) reject
```

### 5.4 Dispatch Branching Law

V1 PlanNode dispatch rules:

| requiresNvg | requiresNxs | nodeType | Dispatch Path |
|---|---|---|---|
| true | false | `nvg_dispatch` | Route through NVG |
| false | true | `nxs_dispatch` | Route through NXS |
| false | false | `local_control` | No external dispatch; agentId = orchestratorActorId |
| false | false | `secure_agent_handoff` | Delegation + mailbox handoff only; agent self-governs |
| true | true | — | REJECTED as `malformed_request` |

`secure_agent_handoff` law:
- `taskSummary` MUST equal `'OCT_SECURE_REDACTED'`
- `expectedOutputSlots` contain only opaque mailbox/output slot identifiers
- Dispatch creates the governed handoff: secure agent registration check,
  delegation issuance, mailbox assignment, and Run Ledger event
- The orchestrator does not inspect prompt content, task metadata, or the
  secure agent's internal work
- The secure agent performs its own NVG/NXS calls under delegated authority
- This is not a governance bypass — it is a content-blind governed handoff

`local_control` law:
- `agentId` MUST equal `orchestratorActorId`
- No external dispatch occurs
- Used for internal orchestrator control flow (e.g., wait gates, synchronization points)

V1 does not support dual-checkpoint nodes (both NVG and NXS in one node).
If an agent needs both model calls and system actions, the planner must
decompose into separate nodes with a dependency edge.

---

## 6. DAG Executor

File: `packages/orch-ref/src/dag-executor.ts`

Implements DAG execution law [blueprint-K §11.6.2].

### 6.1 Interface

```typescript
export interface DagExecutorDeps {
  dispatchNode: (node: PlanNode, delegationId: Uuid) => Promise<NodeDispatchResult>;
  resolveCondition: (condition: PlanCondition, sourceMetadata: Record<string, unknown>) => boolean;
  onNodeEvent: (nodeId: Uuid, status: NodeStatus) => Promise<void>;
}

export interface NodeDispatchResult {
  success: boolean;
  completionMetadata: Record<string, unknown> | null;
  failureReason: NonEmpty | null;
  governanceDenied: boolean;
}

export interface DagExecutor {
  execute(state: RunDagState, deps: DagExecutorDeps): Promise<DagExecutionResult>;
}

export interface DagExecutionResult {
  finalState: RunDagState;
  completedNodes: Uuid[];
  failedNodes: Uuid[];
  skippedNodes: Uuid[];
}
```

### 6.2 Execution Loop — Pseudo Code

**Deterministic ordering rules:**
- Ready-node dispatch order MUST be sorted by `planOrderIndex`.
- Completion result application MUST be sorted by `planOrderIndex`
  before mutating `RunDagState` or incrementing `runSequenceCounter`.
- `Promise` physical completion order MUST NOT determine `runSequence`.

```
function execute(state, deps):
  // Identify root nodes (no incoming edges)
  readyNodes = findRootNodes(state.plan).sort(by planOrderIndex)
  markReady(state, readyNodes)

  while hasUnfinishedNodes(state):
    // Cancel check — FIRST, before any dispatch [§6.3, OD-ORCH-05]
    if state.cancelled:
      skipAllPendingAndReady(state)
      break

    // Dispatch all ready nodes — sorted by planOrderIndex
    dispatching = []
    for node in getReadyNodes(state).sort(by planOrderIndex):
      if node.nodeType == 'local_control':
        // local_control: no external dispatch, no delegation needed
        markCompleted(state, node, {})
        emit(deps.onNodeEvent, node, 'completed')
        continue

      // Lookup delegation binding — missing = runtime violation
      binding = state.nodeDelegations.find(b => b.nodeId == node.nodeId)
      if !binding:
        markFailed(state, node, 'delegation_missing')
        emit(deps.onNodeEvent, node, 'failed')
        continue

      markDispatched(state, node)
      emit(deps.onNodeEvent, node, 'dispatched')
      dispatching.push({ node, binding, promise: dispatchWithTimeout(node, binding.delegationId, deps) })

    // Wait for all dispatched nodes to settle
    results = await Promise.allSettled(dispatching.map(d => d.promise))

    // CRITICAL: process results sorted by planOrderIndex, NOT promise order
    resultPairs = zip(dispatching, results).sort(by dispatching[i].node.planOrderIndex)

    for (dispatch, result) in resultPairs:
      if result.success:
        markCompleted(state, dispatch.node, result.metadata)
        emit(deps.onNodeEvent, dispatch.node, 'completed')
      else if result.governanceDenied:
        markFailed(state, dispatch.node, result.reason)
        // Anti-recursion: do NOT re-plan [blueprint-K §11.7.4]
      else if result.timedOut:
        markTimedOut(state, dispatch.node)
      else:
        markFailed(state, dispatch.node, result.reason)

    // Resolve dependencies — sorted by planOrderIndex of target
    pendingEdges = getEdgesFromCompletedSources(state)
      .sort(by targetNode.planOrderIndex)

    for edge in pendingEdges:
      if edge.type == 'data_dependency' or edge.type == 'sequential':
        if allIncomingEdgesResolved(state, edge.targetNode):
          markReady(state, edge.targetNode)
          emit('dependency_resolved', edge)
      if edge.type == 'conditional':
        condResult = deps.resolveCondition(edge.condition, sourceMetadata)
        emit('condition_evaluated', edge, condResult)
        if condResult:
          if allIncomingEdgesResolved(state, edge.targetNode):
            markReady(state, edge.targetNode)
        else:
          markSkipped(state, edge.targetNode)

    // Post-dispatch cancel check — catches cancel during in-flight await
    if state.cancelled:
      skipAllPendingAndReady(state)
      break

    // Check partial completion
    if allRemainingNodesBlocked(state) and manifest.partialCompletion.enabled:
      if countCompleted(state) >= manifest.partialCompletion.minRequiredCompletedNodes:
        break

  return buildDagExecutionResult(state)
```

### 6.3 Cancel Signal — V1 Minimal [OD-ORCH-05]

When `state.cancelled` is set to true, the executor checks at two points
(top of loop and after in-flight settlement) and calls `skipAllPendingAndReady`:
- All `pending` nodes → `skipped`
- All `ready` nodes → `skipped` (not dispatched)
- In-flight `dispatched` nodes → allowed to complete (no force-kill in V1)
- Full distributed cancellation with AbortSignal → deferred

### 6.4 Timeout Handling

Per-node timeout from `PlanNode.timeoutMs`. On timeout:
- Node marked `timed_out`, Run Ledger event emitted
- Default: fail the node, NOT the run [blueprint-K §11.6.2]
- Dependent nodes evaluate: if sole dependency was timed-out node → `skipped`

---

## 7. Run Coordinator

File: `packages/orch-ref/src/run-coordinator.ts`

### 7.1 Interface

```typescript
// ─── DelegationScope (orch-ref internal) ───
// Captures plan-node context needed by the delegation issuer callback.
// The bootstrap-injected issueDelegation uses this to build a proper
// DelegationContext via the delegation engine. Not a Layer 2 contract.

export interface DelegationScope {
  taskSummary: NonEmpty;
  requiresNvg: boolean;
  requiresNxs: boolean;
  nodeType: 'nvg_dispatch' | 'nxs_dispatch' | 'local_control' | 'secure_agent_handoff';
  expectedOutputSlots: NonEmpty[];
}

export interface RunCoordinatorDeps {
  planner: Planner;
  dagExecutor: DagExecutor;
  runLedgerWriter: RunLedgerWriter;
  mailboxService: MailboxService;
  outputCollector: OutputCollector;
  computeDigest: (obj: unknown) => Sha256Hex;
  dispatchToGovernance: (node: PlanNode, delegationId: Uuid) => Promise<NodeDispatchResult>;
  issueDelegation: (agentId: Uuid, scope: DelegationScope) => Promise<Uuid>;
  triggerCompile: (runId: Uuid) => Promise<void>;
  sendPlanCheckback: (preview: OrchestratorPlanPreview) => Promise<boolean>;
  buildPlannerRequest: (request: WorkspaceRunRequest) => PlannerRequest;
  // buildPlannerRequest applies visibility tier precedence [blueprint-K §11.5.4]
  // and strips prompt content for metadata/oct_secure tiers
}

export interface RunCoordinator {
  handleRun(request: WorkspaceRunRequest): Promise<OrchestratorPlanPreview>;
  cancelRun(runId: Uuid): Promise<void>;
}
```

### 7.1.1 V1 Active-Run State Tracking

The reference RunCoordinator maintains an in-memory active-run map for V1:

```typescript
// orch-ref internal — NOT a Layer 2 contract.
// Map is acceptable here because this is orch-ref implementation,
// not a contracts type. Entries exist only while the executor is running.
private readonly activeRuns = new Map<Uuid, RunDagState>();
```

Lifecycle:
- `handleRun`: after `initRunDagState()`, register `activeRuns.set(runId, dagState)`
- `handleRun`: after executor returns (before terminal classification), deregister
  `activeRuns.delete(runId)`
- `cancelRun`: lookup via `activeRuns.get(runId)` — if missing, run is not active (no-op)

This map is ephemeral. It holds only in-flight runs. Completed, rejected, and
never-started runs are not present. A production replacement may use a distributed
state store; V1 uses in-process memory.

### 7.2 Run Lifecycle — Pseudo Code

```
function handleRun(request):
  // 1. Build visibility-safe planner request
  plannerRequest = deps.buildPlannerRequest(request)

  // 2. Invoke planner [blueprint-K §11.4.2]
  plannerContext = { registry, capabilityCeiling, maxSplitDepth }
  planResult = await planner.plan(plannerRequest, plannerContext)

  if planResult is PlanRejection:
    writeLedger('plan_rejected', { reason, reasonDetail, suggestedCount })
    return planPreviewFromRejection(planResult)

  plan = planResult as ExecutionPlan

  // 2b. Validate planner output at coordinator trust boundary [ORCH-24]
  // Planner is pluggable [blueprint-K §11.4.3, §11.4.4]. Coordinator MUST
  // validate before plan_created, delegation, mailbox, or dispatch.
  validation = validateExecutionPlan(plan, request, manifest)
  if validation.failed:
    writeLedger('plan_rejected', { reason: 'malformed_request',
      reasonDetail: validation.reason, suggestedCount: 0 })
    return planPreviewFromRejection({ rejected: true,
      reason: 'malformed_request', reasonDetail: validation.reason,
      suggestedAlternatives: [] })

  writeLedger('plan_created', { planId, planDigest, plannerType, nodeCount, edgeCount })

  // 3. Plan checkback if requested
  if request.planCheckbackRequested or manifest.planCheckbackDefault:
    preview = buildPlanPreview(plan)
    writeLedger('plan_checkback_sent', { planId })
    confirmed = await sendPlanCheckback(preview)
    if not confirmed:
      writeLedger('plan_rejected', { reason: 'user_rejected_plan' })
      return preview

  writeLedger('plan_confirmed', { planId })

  // 4. Issue delegations [blueprint §11.3]
  // local_control nodes do not receive sub-agent delegation — they execute
  // under the orchestrator actor's existing run authority.
  nodeDelegations = []
  for node in plan.nodes:
    if node.nodeType != 'local_control':
      delegationId = await issueDelegation(node.agentId, scopeFromPlan(node))
      nodeDelegations.push({ nodeId: node.nodeId, agentId: node.agentId, delegationId })
      writeLedger('delegation_issued', { planId, nodeId, agentId, delegationId })

  // 5. Assign mailboxes for data hops [blueprint-K §11.6.3]
  // Uses existing mailbox contracts [AMEND-spec §3.4]
  for edge in plan.edges where edge.type == 'data_dependency':
    assignIntermediateMailbox(edge)

  // 6. Execute DAG
  dagState = initRunDagState(plan, nodeDelegations)
  this.activeRuns.set(request.runId, dagState)    // register for cancel lookup [§7.1.1]
  try:
    dagResult = await dagExecutor.execute(dagState, executorDeps)
  catch executorError:
    // Executor threw — terminal error path
    writeLedger('dag_failed', { planId, completedCount: 0, failedCount: 0,
      skippedCount: 0, reason: 'executor_error' })
    writeLedger('compile_skipped', { planId, runId: request.runId, reason: 'executor_error' })
    writeLedger('final_response', { planId, runId: request.runId,
      outcome: 'executor_error', payload: null })
    writeLedger('run_closed', { planId, runId: request.runId,
      closedBy: 'orch-ref', reason: 'executor_error' })
    return buildPlanPreview(plan, null)
  finally:
    this.activeRuns.delete(request.runId)         // deregister — always, even on throw

  // 7. Terminal classification — cancelled check FIRST [§7.3, OD-ORCH-05]
  // User cancel is terminal intent. Cancelled runs do not compile.
  if dagResult.finalState.cancelled:
    writeLedger('run_cancelled', { planId, runId: request.runId,
      totalSkipped: dagResult.skippedNodes.length,
      totalCompleted: dagResult.completedNodes.length,
      reason: 'user_cancelled' })
    writeLedger('compile_skipped', { planId, runId: request.runId, reason: 'run_cancelled' })
    writeLedger('final_response', { planId, runId: request.runId, outcome: 'cancelled', payload: null })
    writeLedger('run_closed', { planId, runId: request.runId, closedBy: 'orch-ref', reason: 'run_cancelled' })
    return buildPlanPreview(plan, dagResult)

  // 8. Evaluate completion [§4.9] — only when NOT cancelled
  if dagResult.failedNodes.length == 0:
    writeLedger('dag_completed', { completedCount })
  else if dagResult.completedNodes.length > 0
      and manifest.partialCompletion.enabled
      and manifest.partialCompletion.compileOnPartial:
    writeLedger('dag_partial_complete', { completed, failed, skipped })
  else:
    writeLedger('dag_failed', { completed, failed, skipped, reason })

  // 9. Compile handoff [§4.8]
  // compileEligible MUST align with DAG classification law [§4.9]:
  // partial compile requires partialCompletion.enabled AND compileOnPartial.
  compileEligible = dagResult.completedNodes.length > 0
    and (
      dagResult.failedNodes.length == 0
      or (
        manifest.partialCompletion.enabled
        and manifest.partialCompletion.compileOnPartial
      )
    )
  if compileEligible:
    writeLedger('compile_triggered', { planId, runId })
    await triggerCompile(request.runId)
    // compile-ref / compile-return owns: final_response, run_closed
  else:
    writeLedger('compile_skipped', { planId, runId, reason: 'no_eligible_results' })
    // No compile invoked — orch-ref owns terminal closure for this run
    writeLedger('final_response', { planId, runId, outcome: 'no_eligible_results', payload: null })
    writeLedger('run_closed', { planId, runId, closedBy: 'orch-ref', reason: 'compile_skipped' })

  return buildPlanPreview(plan, dagResult)
```

### 7.2.1 Planner Output Validation Law

`validateExecutionPlan(plan, request, manifest)` runs at the coordinator
trust boundary before `plan_created` is written. The planner is pluggable
[blueprint-K §11.4.3, §11.4.4]; ORCH-17 tests planner-only swap as a V1
surface. The coordinator MUST NOT trust planner output without validation.

Minimum validation checks:

1. `plan.runId === request.runId`
2. `planDigest` re-derives exactly per §3.2 digest law
3. `nodes` sorted by `planOrderIndex`
4. `planOrderIndex` values are unique and contiguous (0, 1, 2, ...)
5. `nodeId` values are unique
6. `edgeId` values are unique
7. All edge `sourceNodeId` / `targetNodeId` reference existing nodes
8. Graph is acyclic
9. Edge sort order matches `[sourceNodeId, targetNodeId, edgeType, edgeId]`
10. No node has `requiresNvg=true` AND `requiresNxs=true`
11. `nodeType` matches `requiresNvg`/`requiresNxs` per dispatch law [§5.4]
12. `local_control` node `agentId` equals `orchestratorActorId`
13. `secure_agent_handoff` node: `taskSummary === 'OCT_SECURE_REDACTED'`,
    no prompt/metadata/capabilities content present
14. `nodes.length <= manifest.maxSplitDepth`

On any failure: return `{ failed: true, reason: <specific check that failed> }`.
Coordinator writes `plan_rejected` with `reason: 'malformed_request'` and
the specific validation failure in `reasonDetail`.

### 7.3 Cancel [OD-ORCH-05]

```
function cancelRun(runId):
  dagState = this.activeRuns.get(runId)

  if !dagState:
    // Run is not active — already completed, rejected, or never started.
    // No-op for V1. No Run Ledger write — the run's ledger is already
    // closed or was never opened by orch-ref.
    return

  dagState.cancelled = true
  // Executor loop detects on next iteration [§6.3]:
  // - Pending → skipped
  // - Ready → skipped (not dispatched)
  // - In-flight → allowed to complete (no force-kill in V1)
  //
  // Run Ledger events (run_cancelled, compile_skipped, final_response,
  // run_closed) are written by handleRun's terminal classification [§7.2]
  // after the executor returns — NOT here. At this point the executor
  // has not finished and the skip/complete counts are not yet known.
```

---

## 8. Plan Amendment

File: `packages/orch-ref/src/plan-amendment.ts`

Implements [blueprint-K §11.6.6].

### 8.1 Amendment Lifecycle

```
function handleAmendment(currentState, amendmentRequest):
  if currentState.amendmentCount >= manifest.planAmendment.maxAmendments:
    writeLedger('plan_amended', { denied: true, reason: 'max_amendments_exceeded' })
    return null

  extensionResult = await planner.plan(amendmentRequest, plannerContext)
  if extensionResult is PlanRejection:
    writeLedger('plan_amended', { denied: true, reason: extensionResult.reason })
    return null

  extension = extensionResult as ExecutionPlan

  // Governance re-check [blueprint-K §11.6.6]
  requiresReCheck = false
  if extension adds new agent not in original plan → requiresReCheck = true
  if extension broadens delegation scope → requiresReCheck = true
  if extension introduces higher OCT path → requiresReCheck = true
  if extension adds external-facing system action → requiresReCheck = true

  if requiresReCheck:
    if manifest.planAmendment.requiresCheckback:
      confirmed = await sendPlanCheckback(extensionPreview)
      if not confirmed: return null

  // Step 1: Validate merge invariants BEFORE issuing delegations [§8.2]
  // Dry-run merge — if any invariant fails, reject without minting delegations.
  mergeValidation = validateMerge(currentState.plan, extension)
  if mergeValidation.failed:
    writeLedger('plan_amended', { denied: true, reason: mergeValidation.reason })
    return null

  // Step 2: Issue delegations for new dispatchable nodes.
  // Only after merge is validated — no minted-but-unused delegations.
  // local_control does not receive sub-agent delegation.
  // secure_agent_handoff IS dispatchable for delegation-binding purposes.
  newDelegationBindings = []
  for node in extension.nodes:
    if node.nodeType != 'local_control':
      delegationId = await issueDelegation(node.agentId, scopeFromPlan(node))
      newDelegationBindings.push({ nodeId: node.nodeId, agentId: node.agentId, delegationId })

  if newDelegationBindings.length < countDispatchableNodes(extension):
    writeLedger('plan_amended', { denied: true, reason: 'delegation_binding_failure' })
    return null

  // Step 3: Commit merge — plan validated, delegations minted
  mergedPlan = mergePlans(currentState.plan, extension)
  currentState.plan = mergedPlan
  currentState.nodeDelegations.push(...newDelegationBindings)
  currentState.amendmentCount++
  writeLedger('plan_amended', { approved: true, originalPlanId, originalPlanDigest,
    amendmentPlanId, amendmentPlanDigest, mergedPlanId, mergedPlanDigest,
    newNodeCount, newEdgeCount })
  return mergedPlan
```

### 8.2 Deterministic Merge Law

Plan amendment merge follows these invariants:

1. `extension.runId` MUST equal `currentState.plan.runId`.
2. Extension `nodeId` and `edgeId` values MUST NOT collide with existing plan IDs.
   Collision → amendment rejected, no DAG mutation.
3. Extension `planOrderIndex` values are discarded and reassigned starting at
   `max(existing.planOrderIndex) + 1`.
4. Extension edges are merged only after validating all referenced `nodeId` values
   exist in the combined (existing + extension) plan.
5. Merged plan MUST be validated for acyclicity. Cycle → amendment rejected.
6. Merged `planDigest` MUST be recomputed over the full merged plan.
7. `plan_amended` event MUST include: `originalPlanId`, `originalPlanDigest`,
   `amendmentPlanId`, `amendmentPlanDigest`, `mergedPlanId`, `mergedPlanDigest`.
8. If any merge invariant fails, amendment is rejected and no DAG mutation occurs.
9. New edges MUST NOT target already-terminal nodes (completed, failed, skipped, timed_out).

---

## 9. Reference Orchestrator Assembly

File: `packages/orch-ref/src/ref-orchestrator.ts`

```typescript
import type { Orchestrator, OrchestratorPlanPreview, WorkspaceRunRequest, NonEmpty, Uuid } from '@nexus/contracts';

export class RefOrchestrator implements Orchestrator {
  readonly orchestratorSocketId: NonEmpty;
  readonly orchestratorVersion: NonEmpty;

  constructor(
    socketId: NonEmpty,
    version: NonEmpty,
    private readonly coordinator: RunCoordinator,
  ) {
    this.orchestratorSocketId = socketId;
    this.orchestratorVersion = version;
  }

  async dispatch(request: WorkspaceRunRequest): Promise<OrchestratorPlanPreview> {
    return this.coordinator.handleRun(request);
  }

  async cancel(runId: Uuid): Promise<void> {
    return this.coordinator.cancelRun(runId);
  }
}
```

Two-level unpluggability [blueprint-K §11.1 amendment]:
1. Swap whole orch: implement `Orchestrator` socket, register new `OrchestratorFactory`.
2. Swap planner only: implement `Planner` interface, register new `PlannerFactory`.

---

## 10. Bootstrap and Composition

### 10.1 New Bootstrap Steps

| Step | What |
|---|---|
| Step 17b (per AMEND-nexus-planner-db-lexicon-v0-2-1.md §4.1) | Construct `PlannerFactoryRegistryImpl` |
| Step 18a (per AMEND-...-v0-2-1.md §4.1) | Load + verify signed lexicon JSONL fixtures; register `DbLexiconTransformerPlannerFactory` |
| Step 22c (per AMEND-...-v0-2-1.md §4.1) | Resolve active planner via `registry.get(orchManifest.plannerType)?.create(orchManifest)` — fail-closed on missing factory |
| Step 24 | Construct `DagExecutor` |
| Step 25 | Construct `RunCoordinator` with planner, executor, injected deps |
| Step 26 | Construct `RefOrchestrator` with coordinator |
| Step 27 | Wire `RefOrchestrator` into OrchestratorFactory result |

The Step 22 / Step 23 rows from the original spec are replaced by the
plannertype-resolved factory path above. The direct `new RefDeterministicPlanner(...)`
construction site is gone (Commit 6); bootstrap now fail-closed throws
on any unknown plannertype.

### 10.2 Manifest Extension

```yaml
orchestrator:
  orchestratorSocketId: "ref-orch-v1"
  orchestratorType: "reference_deterministic"
  enabled: true
  orchestratorActorId: "<registered-actor-uuid>"
  plannerMode: "deterministic_first"
  plannerType: "db-lexicon-transformer-v0"
  plannerVersion: "0.1.0"
  plannerConfiguration: {}  # may carry { lexiconFixtureRoot?: NonEmpty } per AMEND §3.7
  planAmendment:
    enabled: true
    maxAmendments: 3
    requiresCheckback: false
  partialCompletion:
    enabled: true
    minRequiredCompletedNodes: 1
    compileOnPartial: true
  maxSplitDepth: 10
  # ... existing fields unchanged ...
```

### 10.3 Composition Root Law

`interfaces/api/*` MUST NOT import `@nexus/orch-ref`.

`interfaces/api/*` MUST NOT construct `RefOrchestrator`, `RunCoordinator`,
`DagExecutor`, or any `Planner` implementation
(`RefDeterministicPlanner` was the V1 example; replaced by
`DbLexiconTransformerPlanner` per AMEND-nexus-planner-db-lexicon-v0-2-1.md;
§6.5 of that AMEND adds a packages/planners/* layer law that ci:gate
PLANNER-LEXICON-05 enforces structurally).

The lawful composition root (bootstrap) constructs orch-ref and injects only
the `Orchestrator` socket interface into the API server.

```
ALLOWED:
  bootstrap/root imports @nexus/orch-ref
  bootstrap/root constructs RefOrchestrator
  api server receives Orchestrator interface from @nexus/contracts

FORBIDDEN:
  interfaces/api imports @nexus/orch-ref
  interfaces/api constructs orch-ref internals
  routes instantiate planner/executor/coordinator locally
```

### 10.4 Cancel Route Law

The API cancel route calls `orchestrator.cancel(runId)` on the injected
`Orchestrator` socket. It follows the same composition root rules as the
dispatch route:

- Route receives the `Orchestrator` socket interface through DI
- Route MUST NOT import `@nexus/orch-ref`
- Route MUST NOT inspect or mutate `RunDagState` directly
- Route is enforced by ORCH-23; ORCH-19 continues to enforce no orch-ref import from interfaces/api

---

## 11. CI Gates

| Gate | Type | What |
|---|---|---|
| ORCH-01 | unit | Planner interface — `DbLexiconTransformerPlanner` implements `Planner` + `PlannerTraceReader` + `PlannerCheckbackReader` (was `RefDeterministicPlanner implements Planner`; see AMEND-nexus-planner-db-lexicon-v0-2-1.md §9.1) |
| ORCH-02 | unit | Plan creation — single-agent, multi-agent parallel, DAG with deps |
| ORCH-03 | unit | Plan rejection — all PlanRejectionReason codes exercised |
| ORCH-04 | unit | Suggest-not-deny — alternatives returned when available |
| ORCH-05 | unit | DAG executor — parallel dispatch, dependency resolution, conditionals |
| ORCH-06 | unit | Node timeout — node marked, dependents skipped |
| ORCH-07 | unit | Replay determinism — same plan + outcomes → same runSequence |
| ORCH-08 | unit | Anti-recursion — governance deny does not trigger re-plan |
| ORCH-09 | unit | Plan amendment — scope expansion triggers re-check |
| ORCH-10 | unit | Plan amendment — maxAmendments enforced |
| ORCH-11 | unit | Visibility tiers — oct_secure input has no prompt/metadata fields |
| ORCH-12 | unit | Cancel — cancelRun locates active RunDagState by runId, sets cancelled=true, pending→skipped, ready→skipped, in-flight→completes, cancel before first dispatch marks all pending/ready skipped, cancelled run MUST NOT emit dag_completed, MUST NOT call triggerCompile, MUST write run_cancelled + compile_skipped + final_response + run_closed, cancel on non-active runId is no-op |
| ORCH-13 | unit | Dispatch branching — nvg/nxs/local_control/secure_agent_handoff, both-true rejected |
| ORCH-14 | unit | Condition evaluation — type coercion law (gt/lt number-only, strict equals, type_mismatch) |
| ORCH-15 | integration | Full lifecycle — request → plan → dispatch → collect → compile_triggered; compile_skipped MUST NOT call triggerCompile |
| ORCH-16 | integration | Run Ledger events — correct events, correct detail fields, correct sequence |
| ORCH-17 | integration | Two-level replacement — whole-orch swap and planner-only swap |
| ORCH-18 | type/static | orch-ref imports @nexus/contracts only — no core, vanguard, adapters, connectors, interfaces, or relative imports outside packages/orch-ref/src |
| ORCH-19 | type/static | interfaces/api must not import @nexus/orch-ref |
| ORCH-20 | unit/static | OCT-secure plan node contains no prompt/metadata/task content, uses secure_agent_handoff, taskSummary = 'OCT_SECURE_REDACTED' |
| ORCH-21 | unit | Plan amendment merge — index rebase, ID collision rejection, acyclicity re-check, digest recomputation, NodeDelegationBinding insertion for new dispatchable nodes |
| ORCH-22 | unit | dag_failed emitted when no compile-eligible nodes, dag_partial_complete only on policy-eligible partial |
| ORCH-23 | integration/static | API cancel route exists, receives injected Orchestrator, calls orchestrator.cancel(runId), does not import @nexus/orch-ref, does not access RunDagState directly |
| ORCH-24 | unit | Coordinator rejects invalid planner output before plan_created, delegation, mailbox, or dispatch — exercises all 14 validateExecutionPlan checks |

---

## 12. Build Order — Push Sequence

| Push | Content | Gate Target |
|---|---|---|
| ORCH-PUSH-01 | Contracts: planner.ts, execution-plan.ts, extensions | typecheck + ORCH-18 + ORCH-19 |
| ORCH-PUSH-02 | Package scaffold + `RefDeterministicPlanner` (HISTORICAL — superseded by AMEND-nexus-planner-db-lexicon-v0-2-1.md 7-commit migration; current V1 production planner is `DbLexiconTransformerPlanner`) | ORCH-01 thru ORCH-04, ORCH-11, ORCH-13, ORCH-14, ORCH-20 |
| ORCH-PUSH-03 | DagExecutor | ORCH-05, ORCH-06, ORCH-07, ORCH-08, ORCH-12, ORCH-22 |
| ORCH-PUSH-04 | RunCoordinator + PlanAmendmentHandler + validateExecutionPlan | ORCH-09, ORCH-10, ORCH-21, ORCH-24 |
| ORCH-PUSH-05 | RefOrchestrator + bootstrap wiring + cancel route | ORCH-15, ORCH-16, ORCH-17, ORCH-23 |
| ORCH-PUSH-06 | Integration fixtures + full gate sweep | All 24 gates GREEN |

Six pushes. Each push must pass all accumulated gates before the next.

---

## 13. Owner Decisions Applied

| ID | Decision | Ruling |
|---|---|---|
| OD-ORCH-01 | V1 requires explicit `selectedAgentIds` or `requiredCapabilities`. Free-text capability inference is V2/deferred. | APPROVED |
| OD-ORCH-02 | V1 supports optional `edgeHints` in request metadata. Absent edges default to all-parallel. Present edges validated as DAG. | APPROVED |
| OD-ORCH-03 | `packages/orch-ref/` approved as external reference package following identity-ref pattern. Imports contracts only. | APPROVED |
| OD-ORCH-04 | V1 must implement all three visibility tiers at boundary level. Metadata/oct_secure can be minimal but must be testable. | APPROVED |
| OD-ORCH-05 | Cancel is V1 minimal: pending→skipped, ready→stop dispatch, in-flight→completes. Full distributed cancellation deferred. | APPROVED |

---

## 14. Audit Response Log

### Round 1 (v0.1.0 → v0.2.0)

| Finding | Disposition | Action |
|---|---|---|
| F01 Open owner questions | ACCEPTED (BLOCKER) | §13 added |
| F02 Composition-root law | ACCEPTED (BLOCKER) | §10.3 added |
| F03 Replay determinism | ACCEPTED (BLOCKER) | createdAt→IsoTimestamp, planDigest excludes it, sorted by planOrderIndex |
| H01 Map in contracts | ACCEPTED | NodeStatus[] sorted by planOrderIndex |
| H02 estimatedRisk | ACCEPTED | Renamed declaredRiskHint, V1 always EVIDENCE_SENTINEL |
| H03 oct_secure type safety | ACCEPTED | PlannerRequest visibility-safe union |
| M01 selectedAgentIds | ACCEPTED | Per OD-ORCH-01 |
| M02 Condition coercion | ACCEPTED | §3.1 type coercion law |
| M03 Partial completion | ACCEPTED | Manifest field added |
| M04 Event minimums | ACCEPTED | §4.7 table |
| M05 Dispatch branching | ACCEPTED | §5.4 dispatch law |

### Round 2 (v0.2.0 → v0.3.0)

| Finding | Disposition | Action |
|---|---|---|
| F01 Delegation map missing | ACCEPTED (BLOCKER) | NodeDelegationBinding[] added to RunDagState |
| F02 OCT-secure dispatch | ACCEPTED (BLOCKER) | secure_agent_handoff nodeType + content law + ORCH-20 gate |
| F03 Amendment merge | ACCEPTED (BLOCKER) | §8.3 deterministic merge law (9 invariants) |
| H01 Compile handoff | ACCEPTED | compile_triggered event + §4.8 boundary clause |
| H02 dag_partial_complete overuse | ACCEPTED | dag_failed added + §4.9 classification law |
| H03 EdgeHint validation | ACCEPTED | Normalization law added to §2 |
| M01 Edge sort tie-breaker | ACCEPTED | edgeId added to sort key |
| M02 Sync registry | ACCEPTED | AgentRegistryReader methods now async |
| M03 ORCH-18 scope | ACCEPTED | Gate expanded to all forbidden imports |
| M04 local_control agentId | ACCEPTED | agentId = orchestratorActorId law in §5.4 |

### Round 3 (v0.3.0 → v0.3.1)

| Finding | Disposition | Action |
|---|---|---|
| F01 Delegation not wired | ACCEPTED (BLOCKER) | Delegation bindings built in lifecycle, passed to initRunDagState, looked up at dispatch, missing = delegation_missing failure |
| F02 Secure handoff bypass wording | ACCEPTED (BLOCKER) | Rewritten: content-blind governed handoff, not governance bypass |
| H01 Planner edge sort | ACCEPTED | Step 10 now includes edgeId |
| H02 plan_amended event minimums | ACCEPTED | All 6 digest fields added |
| M01 delegation_issued minimums | ACCEPTED | Inherited event minimums clarified in §4.7 |
| M02 local_control no-delegation | ACCEPTED | Exception added: local_control skips delegation, executes under orch authority |
| M03 compile_triggered when not eligible | ACCEPTED | Split into compile_triggered + compile_skipped |

### Round 3.2 (v0.3.2 → v0.3.3)

| Finding | Disposition | Action |
|---|---|---|
| F01 No run closure on compile_skipped | ACCEPTED (BLOCKER) | Orch-ref writes final_response + run_closed when compile_skipped. §4.8 updated with terminal ownership law. |
| F02 compileEligible misaligned | ACCEPTED (BLOCKER) | Eligibility now requires partialCompletion.enabled AND compileOnPartial. §4.8.1 manifest validation added. |
| H01 Amendment delegates before merge validation | ACCEPTED | Reordered: validateMerge → checkback → issueDelegation → commit. No minted-but-unused delegations. |

### Round 4 (v0.3.3 → v0.3.4)

| Finding | Disposition | Action |
|---|---|---|
| HOLE-ORCH-001 Cancel path not wired through socket | ACCEPTED (BLOCKER) | Orchestrator socket extended with cancel method. RefOrchestrator delegates to coordinator.cancelRun. §1.3, §4.1, §9 updated. |
| ORCH33-M01 final_response/run_closed missing from §4.7 | ACCEPTED | Two rows added to §4.7 event detail table. |
| HOLE-ORCH-002 DelegationScope undefined | ACCEPTED | DelegationScope type defined in §7.1 as orch-ref-internal interface. |
| EDITORIAL-ORCH-001 §8.2 numbering gap | ACCEPTED | §8.3 renumbered to §8.2. Internal reference updated. |

### Round 5 (v0.3.4 → v0.3.5)

| Finding | Disposition | Action |
|---|---|---|
| ORCH34-F01 Cancel has no active-run state lookup | ACCEPTED (BLOCKER) | V1 activeRuns Map added to RunCoordinator [§7.1.1]. handleRun registers/deregisters around executor. cancelRun looks up by runId, no-op if not active. |
| ORCH34-F02 Cancelled runs can trigger compile | ACCEPTED (BLOCKER) | Cancelled terminal classification added before normal DAG classification in §7.2. Cancelled run writes run_cancelled → compile_skipped → final_response → run_closed. Never emits dag_completed, never calls triggerCompile. |
| ORCH34-M01 ORCH-12 gate missing terminal closure | ACCEPTED | ORCH-12 updated: tests active-state lookup, cancel terminal closure, no-compile, no dag_completed, non-active no-op. |
| run_cancelled event minimums | ACCEPTED | runId and reason added to §4.7 run_cancelled row. |
| §7.3 dangling ledger write | ACCEPTED | cancelRun no longer writes Run Ledger events — those are written by handleRun's terminal classification after executor returns, when skip/complete counts are known. |

### Round 6 (v0.3.5 → v0.3.6)

| Finding | Disposition | Action |
|---|---|---|
| ORCH35-F01 Executor loop guard bypasses cancel | ACCEPTED | Loop guard changed to `while hasUnfinishedNodes(state)` with cancel check inside loop at top and after in-flight settlement. `skipAllPendingAndReady` covers both statuses. |
| ORCH35-F02 API cancel route not specified | ACCEPTED | Cancel route added to §1.3. §10.4 Cancel Route Law added. No new gate — covered by ORCH-19. |
| ORCH35-F03 Coordinator-side planner validation | DEFERRED (V2) | Logged as HOLE-ORCH-003 in §0.2. V1 reference planner is tested by ORCH-01–ORCH-04. Enterprise replacement planner validation is V2 hardening. |
| ORCH35-F04 run_cancelled counts forensically misleading | PARTIAL ACCEPT | Field names changed to `totalSkipped` / `totalCompleted` for honesty. Cancel-specific tracking infrastructure deferred — individual `node_skipped` events carry per-node detail. |
| ORCH35-H01 activeRuns leak on executor throw | ACCEPTED | try/finally wraps executor call. Executor-throw writes dag_failed → compile_skipped → final_response → run_closed. |

### Round 7 (v0.3.6 → v0.3.7)

| Finding | Disposition | Action |
|---|---|---|
| BLOCKER-01 API cancel route not executable | ACCEPTED | ORCH-23 gate added (integration/static). Proves cancel route exists, calls injected socket, no orch-ref import. ORCH-PUSH-05 updated. |
| BLOCKER-02 Planner validation cannot be V2 | ACCEPTED — prior pushback was wrong | HOLE-ORCH-003 upgraded from V2 to V1. validateExecutionPlan() added to §7.2 with 14 checks. ORCH-24 gate added. ORCH-PUSH-04 updated. V2 deferral removed from §0.2. |
| Footer accuracy | ACCEPTED | Footer corrected. |

---

*AMEND-nexus-spec-orch — RATIFIED v1.1.1*
*24 CI gates. 6-push build order. All blockers closed.*
*Subordinate implementation law for AMEND-nexus-blueprint-orch-v1-1-1.md*
*Ratified: 2026-05-02*
*Owner: James Huson / Lake Area LLC*

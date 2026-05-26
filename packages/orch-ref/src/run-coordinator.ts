// packages/orch-ref/src/run-coordinator.ts
// AMEND-spec-nexus-orch §7 — Run Coordinator
// External reference — imports @nexus/contracts ONLY (except orch-ref-internal).
//
// Orchestrates the run lifecycle: plan → validate → checkback → delegate →
// execute → classify → compile/close.
//
// Integration tests (ORCH-15, ORCH-16, ORCH-17) are in ORCH-PUSH-05.
// This push delivers the structural coordinator with cancelRun, active-run
// tracking, and the handleRun lifecycle.

import type {
  Uuid,
  NonEmpty,
  Sha256Hex,
  ExecutionPlan,
  PlanNode,
  PlanRejection,
  NodeDelegationBinding,
  RunDagState,
  OrchestratorPlanPreview,
  OrchestratorDispatchResult,
  RunOrchestrationTerminal,
  OrchestratorSelectedAgent,
  OrchestratorManifestRecord,
  PlannerRequest,
  WorkspaceRunRequest,
  RunEventType,
  RejectionCheckbackPayload,
  PlannerPlanTrace,
  PlannerTraceReader,
} from '@nexus/contracts';

import type { Planner, PlannerContext, AgentRegistryReader } from '@nexus/contracts';
import type { RunLedgerWriter } from '@nexus/contracts';
import type { MailboxService } from '@nexus/contracts';
import type { OutputCollector } from '@nexus/contracts';

import { EVIDENCE_SENTINEL, nowIso } from '@nexus/contracts';

import type { DagExecutor, DagExecutionResult, NodeDispatchResult } from './dag-executor.js';
import { classifyDagCompletion } from './dag-executor.js';
import { validateExecutionPlan } from './validate-plan.js';
import { evaluateCondition } from './condition-evaluator.js';

// ─── DelegationScope — orch-ref internal [§7.1, HOLE-ORCH-002] ───

export interface DelegationScope {
  taskSummary: NonEmpty;
  requiresNvg: boolean;
  requiresNxs: boolean;
  nodeType: 'nvg_dispatch' | 'nxs_dispatch' | 'local_control' | 'secure_agent_handoff';
  expectedOutputSlots: NonEmpty[];
}

// ─── RunCoordinatorDeps [§7.1] ───

export interface RunCoordinatorDeps {
  planner: Planner;
  dagExecutor: DagExecutor;
  runLedgerWriter: RunLedgerWriter;
  mailboxService: MailboxService;
  outputCollector: OutputCollector;
  computeDigest: (obj: unknown) => Sha256Hex;
  /**
   * Multi-node planner extension: dispatch receives the full ExecutionPlan
   * so it can resolve `inputSlotReads.fromSubTaskKey` → upstream nodeId
   * for slot-read lookups before dispatching its own NVG/NXS work.
   * Legacy single-prompt dispatch ignores `plan` and the existing single-
   * node behavior is unchanged.
   */
  dispatchToGovernance: (
    node: PlanNode,
    delegationId: Uuid,
    plan: ExecutionPlan
  ) => Promise<NodeDispatchResult>;
  issueDelegation: (agentId: Uuid, scope: DelegationScope) => Promise<Uuid>;
  /** Phase 4: composition root's compile entry. The optional second
   *  argument carries the output contract template the planner selected
   *  (when sectioned-mode user pre-picked OR lexicon-matched). When
   *  absent, compile follows Hard Law #11 — pass-through verbatim for
   *  single-item, default-template-generator for multi-item. Both
   *  templateId and templateVersion travel together. */
  triggerCompile: (
    runId: Uuid,
    template?: { readonly templateId: NonEmpty; readonly templateVersion: NonEmpty }
  ) => Promise<void>;
  sendPlanCheckback: (preview: OrchestratorPlanPreview) => Promise<boolean>;
  buildPlannerRequest: (request: WorkspaceRunRequest) => PlannerRequest;
  agentRegistry: AgentRegistryReader;
  capabilityCeiling: NonEmpty[];
  maxSplitDepth: number;
}

// ─── RunCoordinator interface [§7.1] ───

/**
 * Per-run dep overrides. Lets the composition root close over the requesting
 * user's principalId without recreating the coordinator on every run, so the
 * activeRuns/cancellation map stays intact across requests.
 *
 * SPEC-DELEGATION-RUNTIME-PRINCIPAL-FIX §6 (Option B).
 */
export interface RunCoordinatorPerRunDeps {
  readonly issueDelegation?: RunCoordinatorDeps['issueDelegation'];
  readonly dispatchToGovernance?: RunCoordinatorDeps['dispatchToGovernance'];
  /**
   * CHECKBACK-spec — the composition root needs to bind sendPlanCheckback to
   * the originating WorkspaceRunRequest so the pre-flight probe can use the
   * actual agent claims (and so a per-run resolver can wake the right
   * pending Deferred when the user replies).
   */
  readonly sendPlanCheckback?: RunCoordinatorDeps['sendPlanCheckback'];
}

export interface RunCoordinator {
  /**
   * HOLE-LIFECYCLE-001: returns `OrchestratorDispatchResult` so the workspace
   * (composition-root caller) owns the terminal `run_closed` decision.
   * The coordinator MUST NOT write `run_closed` itself — it is a plug-in
   * package and lifecycle authority lives at workspace/composition-root.
   * It MAY emit operational events inside its coordination scope
   * (plan_created, orchestrator_dispatched, node_*, dag_*, compile_triggered,
   * compile_not_applicable, final_response, planner_infeasible,
   * user_cancelled_run).
   */
  handleRun(
    request: WorkspaceRunRequest,
    perRunDeps?: RunCoordinatorPerRunDeps
  ): Promise<OrchestratorDispatchResult>;
  cancelRun(runId: Uuid): Promise<void>;
}

// ─── initRunDagState ───

function initRunDagState(plan: ExecutionPlan, delegations: NodeDelegationBinding[]): RunDagState {
  return {
    plan,
    nodeStatuses: plan.nodes.map(n => ({
      nodeId: n.nodeId,
      planOrderIndex: n.planOrderIndex,
      status: 'pending' as const,
      runSequence: 0,
      completionMetadata: null,
      failureReason: null,
      governanceDenied: false,
    })),
    nodeDelegations: delegations,
    runSequenceCounter: 0,
    amendmentCount: 0,
    cancelled: false,
  };
}

// ─── scopeFromPlanNode ───

function scopeFromPlanNode(node: PlanNode): DelegationScope {
  return {
    taskSummary: node.taskSummary,
    requiresNvg: node.requiresNvg,
    requiresNxs: node.requiresNxs,
    nodeType: node.nodeType,
    expectedOutputSlots: node.expectedOutputSlots,
  };
}

// ─── RefRunCoordinator [§7.2] ───

export class RefRunCoordinator implements RunCoordinator {
  private readonly activeRuns = new Map<Uuid, RunDagState>();

  constructor(
    private readonly manifest: OrchestratorManifestRecord,
    private readonly deps: RunCoordinatorDeps,
    private readonly orchestratorActorId: Uuid
  ) {}

  // ─── handleRun [§7.2] ───

  async handleRun(
    request: WorkspaceRunRequest,
    perRunDeps?: RunCoordinatorPerRunDeps
  ): Promise<OrchestratorDispatchResult> {
    const { deps, manifest } = this;
    // Per-request principal-bound functions take precedence over the
    // construction-time fallbacks. SPEC-DELEGATION-RUNTIME-PRINCIPAL-FIX §6.
    const issueDelegation = perRunDeps?.issueDelegation ?? deps.issueDelegation;
    const dispatchToGovernance = perRunDeps?.dispatchToGovernance ?? deps.dispatchToGovernance;
    const sendPlanCheckback = perRunDeps?.sendPlanCheckback ?? deps.sendPlanCheckback;

    // 1. Build visibility-safe planner request
    const plannerRequest = deps.buildPlannerRequest(request);

    // 2. Invoke planner [blueprint-K §11.4.2]
    const plannerContext: PlannerContext = {
      registry: deps.agentRegistry,
      capabilityCeiling: deps.capabilityCeiling,
      maxSplitDepth: deps.maxSplitDepth,
    };
    const planResult = await deps.planner.plan(plannerRequest, plannerContext);

    // AMEND-nexus-planner-db-lexicon-v0-2-1.md §3.2 — read trace via
    // PlannerTraceReader duck-type. Planners that don't implement (legacy
    // RefDeterministicPlanner) simply return null and the event is
    // skipped. Trace emission MUST happen BEFORE the rejection branch so
    // the trace is preserved for both success + rejection paths.
    const trace = readPlannerTrace(deps.planner);
    if (trace !== null) {
      // `writeLedger` expects Record<string, unknown> for detail; the
      // PlannerPlanTrace interface has named fields. The cast is safe
      // because every PlannerPlanTrace field value is JSON-serializable
      // by construction (Uuid / NonEmpty / number / null / nested
      // primitives).
      await this.writeLedger(
        request.runId,
        'planner_plan_trace',
        trace as unknown as Record<string, unknown>
      );
    }

    if ('rejected' in planResult && (planResult as PlanRejection).rejected) {
      const rejection = planResult as PlanRejection;
      // HL#4 revision (component outline §HL #4, Owner-Ratified 2026-05-23 +
      // fix-spec post-consolidation 2026-05-23 §4): orch has zero governance
      // authority. Planner infeasibility is an orchestration callback
      // signal, not a governance-deny. Behavioral contract:
      //
      //   1. Emit canonical `planner_infeasible` event.
      //   2. Do NOT emit `run_closed` — the run stays OPEN until the user
      //      decides (cancel / rephrase / pick an alternative).
      //   3. Return OrchestratorPlanPreview with `requiresUserApproval: true`
      //      — that flag IS the spec §4.3 step 3 callback signal. The
      //      workspace either renders the Accept-Suggestions / Cancel-Run
      //      modal from `plan_checkback_sent` (when the planner attached an
      //      executable RejectionCheckbackPayload — Path A below) OR shows a
      //      fallback "Plan failed — Cancel Run" UI keyed off
      //      `requiresUserApproval` (when no checkback payload is available
      //      — Path B). Either way the only terminal close path is
      //      POST /workspace/runs/:runId/close → `user_cancelled_run` +
      //      `run_closed { closeReason: 'user_cancelled' }`.
      //   4. If the user accepts the recommended alternatives, the workspace
      //      issues a fresh WorkspaceRunRequest (new runId) — the rejected
      //      run is left in its open-with-rejection state until explicitly
      //      cancelled.
      await this.writeLedger(request.runId, 'planner_infeasible', {
        reason: rejection.reason,
        reasonDetail: rejection.reasonDetail,
        suggestedCount: rejection.suggestedAlternatives.length,
      });
      // Phase 5 — HL#4 (orch cannot kill): every planner-infeasibility
      // IS a user-callback opportunity by definition. The run stays
      // OPEN until the user decides (cancel / rephrase / pick from
      // alternatives — see plan_checkback_modal.tsx + the run-stage-
      // reducer at packages/workspace-ref/.../run-stage-reducer.ts:714
      // which already treats plan_checkback_required as "active waiting
      // on user"). `plan_checkback_sent` (below) is the additional
      // payload-carrier event when alternatives exist; `plan_checkback_
      // required` is the unconditional "needs user input" audit signal
      // that wall tests filter on (E2E-66 ambiguous-agent, E2E-79
      // oversize-batch, E2E-112 HL#4).
      await this.writeLedger(request.runId, 'plan_checkback_required', {
        reason: rejection.reason,
        reasonDetail: rejection.reasonDetail,
        suggestedCount: rejection.suggestedAlternatives.length,
      });

      // AMEND-nexus-planner-db-lexicon-v0-2-1.md §3.3.3 + §3.7 — read the
      // RejectionCheckbackPayload via duck-type. When non-null, emit
      // `plan_checkback_sent` (existing event, reused) and attach the
      // payload to `OrchestratorPlanPreview.rejection` so workspace UI
      // can drive the Accept-Suggestions / Cancel-Run modal.
      const checkback = readPlannerRejectionCheckback(deps.planner);
      if (checkback !== null) {
        await this.writeLedger(request.runId, 'plan_checkback_sent', {
          reason: checkback.reason,
          reasonDetail: checkback.reasonDetail,
          missingCount: checkback.missingCapabilities.length,
          recommendedCount: checkback.recommendedSelectedAgentIds.length,
          // Full payload embedded for workspace UI consumption per
          // AMEND-nexus-planner-db-lexicon-v0-2-1.md §3.7. The reducer
          // recognizes the planner-style shape by the
          // `checkbackPayload` field's presence (legacy NVG-tier
          // checkbacks emit only `{ planId }`).
          checkbackPayload: checkback as unknown as Record<string, unknown>,
        });
      }

      // F4.8 §2.3 — `unmapped_prompt` is the admin-review signal when the
      // planner could not match the prompt against any candidate above
      // confidence threshold. This drives the lexicon admin queue per
      // outline §3 E "MUTATION admin-only: unmapped prompts log as
      // `unmapped_prompt` events; admins review periodically." Emit only
      // when the rejection reason indicates the lexicon match failed
      // (unmappable_request) — capability ceiling / max split / malformed
      // rejections are NOT lexicon mapping signals and do not emit.
      if (rejection.reason === 'unmappable_request' && trace !== null) {
        await this.writeLedger(request.runId, 'unmapped_prompt', {
          principalId: request.principalId,
          // Per outline §3 E: arena drives confidence scoring. V1 portable
          // build uses 'default' until per-workspace arenas land
          // (Manifest Manifold M2). The mini-substrate population spec
          // F4.8 Phase 2 / `lexicon-mini-substrate-v0-1-0.md` will widen
          // this to the workspace-resolved arena id.
          arena: 'default',
          promptDigest: trace.promptDigest,
          topCandidatesUnderThreshold: trace.candidateIntents.map(intentId => ({
            candidateId: intentId,
            score: 0,
          })),
          rejectionReason: rejection.reason,
        });
      }

      // HOLE-LIFECYCLE-001 — planner_infeasible is NOT a terminal close
      // signal. Per HL #4 the run stays OPEN until the user explicitly
      // cancels (POST /workspace/runs/:runId/close). Workspace must NOT
      // auto-close when terminal.kind === 'planner_infeasible'.
      return {
        preview: this.planPreviewFromRejection(request, rejection, checkback),
        terminal: { kind: 'planner_infeasible', reason: rejection.reason as NonEmpty },
      };
    }

    const plan = planResult as ExecutionPlan;

    // 2b. Validate planner output [§7.2.1, ORCH-24]
    const validation = validateExecutionPlan(
      plan,
      request,
      manifest,
      deps.computeDigest,
      this.orchestratorActorId
    );
    if (validation.failed) {
      // HL#4 revision — malformed plan is an orchestration infeasibility.
      await this.writeLedger(request.runId, 'planner_infeasible', {
        reason: 'malformed_request',
        reasonDetail: validation.reason,
        suggestedCount: 0,
      });
      // Phase 5 — HL#4: even on malformed_request the run stays open
      // and the user gets a callback to rephrase or cancel.
      await this.writeLedger(request.runId, 'plan_checkback_required', {
        reason: 'malformed_request',
        reasonDetail: validation.reason,
        suggestedCount: 0,
      });
      return {
        preview: this.planPreviewFromRejection(request, {
          rejected: true,
          reason: 'malformed_request',
          reasonDetail: validation.reason!,
          suggestedAlternatives: [],
        }),
        terminal: { kind: 'planner_infeasible', reason: 'malformed_request' as NonEmpty },
      };
    }

    await this.writeLedger(request.runId, 'plan_created', {
      planId: plan.planId,
      planDigest: plan.planDigest,
      plannerType: plan.plannerType,
      nodeCount: plan.nodes.length,
      edgeCount: plan.edges.length,
    });

    // 3. Plan checkback if requested
    if (request.planCheckbackRequested || manifest.planCheckbackDefault) {
      const preview = this.buildPlanPreview(request, plan);
      await this.writeLedger(request.runId, 'plan_checkback_sent', { planId: plan.planId });
      const confirmed = await sendPlanCheckback(preview);
      if (!confirmed) {
        // HL#4 revision — a user-rejected plan IS a user cancellation, not
        // a planner-side infeasibility. Emit the canonical
        // `user_cancelled_run` operational event (this stays inside the
        // orchestrator's coordination scope per outline §3). The workspace
        // surfaces the rejection / alternatives modal off the returned
        // OrchestratorPlanPreview, then receives terminal.kind ===
        // 'user_cancelled_plan' and writes the canonical `run_closed`
        // itself per HOLE-LIFECYCLE-001 — orch may not close runs.
        await this.writeLedger(request.runId, 'user_cancelled_run', {
          planId: plan.planId,
          reason: 'user_rejected_plan',
        });
        return {
          preview,
          terminal: {
            kind: 'user_cancelled_plan',
            reason: 'user_rejected_plan' as NonEmpty,
            planId: plan.planId,
          },
        };
      }
    }

    await this.writeLedger(request.runId, 'plan_confirmed', { planId: plan.planId });

    // 3.5. Emit orchestrator_dispatched so downstream slot validation has a
    //      Run Ledger entry naming each task's expected output slots. The
    //      OutputCollector reads this event when outputSlotPolicy is
    //      strict_declared_slots; without it, every mailbox write would fail
    //      closed with UNDECLARED_OUTPUT_SLOT regardless of the plan content.
    //      Detail shape matches DeclaredOutputSlotReader: selectedAgents[] of
    //      { taskId, agentId, expectedOutputSlots }.
    await this.writeLedger(request.runId, 'orchestrator_dispatched', {
      orchestratorSocketId: manifest.orchestratorSocketId,
      orchestratorActorId: this.orchestratorActorId,
      planId: plan.planId,
      planDigest: plan.planDigest,
      selectedAgentCount: plan.nodes.length,
      selectedAgents: plan.nodes.map(n => ({
        taskId: n.nodeId,
        agentId: n.agentId,
        expectedOutputSlots: n.expectedOutputSlots,
        // ── Multi-node planner — per-node fields for the run-timeline
        //    DAG visualization. Optional: legacy single-prompt nodes
        //    omit subTaskKey/inputSlotReads. The dashboard treats the
        //    presence of subTaskKey on any node as the signal to switch
        //    to multi-node DAG rendering. ──
        nodeType: n.nodeType,
        taskSummary: n.taskSummary,
        planOrderIndex: n.planOrderIndex,
        ...(n.subTaskKey !== undefined ? { subTaskKey: n.subTaskKey } : {}),
        ...(n.inputSlotReads !== undefined && n.inputSlotReads.length > 0
          ? { inputSlotReads: n.inputSlotReads }
          : {}),
      })),
      // Plan edges. Empty for single-node legacy plans; populated for
      // multi-node DAGs. The viewer needs (sourceNodeId, targetNodeId,
      // edgeType, outputSlotRef) to draw arrows between node cards.
      edges: plan.edges.map(e => ({
        edgeId: e.edgeId,
        sourceNodeId: e.sourceNodeId,
        targetNodeId: e.targetNodeId,
        edgeType: e.edgeType,
        outputSlotRef: e.outputSlotRef,
      })),
      outputSlotPolicy: manifest.outputSlotPolicy,
    });

    // 3.6. Mailbox-pit allocation step — AMEND-nexus-mailbox-pit-v0-2-1
    //      §3.7. Allocate one per-actor mailbox for each unique agentId
    //      in the plan. The MailboxService emits one `mailbox_allocated`
    //      ledger event per new allocation (idempotent — re-running for
    //      the same actors does not duplicate events). Local-control
    //      nodes are emitted by the orchestrator actor itself; they
    //      still get a mailbox allocation if their agentId appears in
    //      the plan, because compile reads from every allocated
    //      mailbox regardless of node type.
    //
    //      Insertion convention: this is "Step 3.6" between
    //      orchestrator_dispatched (3.5) and delegation_issued (4) —
    //      NOT a renumbering of the canonical step list.
    //
    //      Naming seam (DIFF-MAILBOX-PIT-001): orch contracts use
    //      `agentId`; mailbox contracts use `actorId`. Same UUID; we
    //      pass agentId into the actorId parameter here.
    const uniqueActorIds: Uuid[] = Array.from(
      new Set(plan.nodes.map(n => n.agentId).filter(id => id !== this.orchestratorActorId))
    );
    if (uniqueActorIds.length > 0) {
      await deps.mailboxService.allocateForRun(request.runId, uniqueActorIds);
    }

    // 4. Issue delegations [blueprint §11.3]
    const nodeDelegations: NodeDelegationBinding[] = [];
    for (const node of plan.nodes) {
      if (node.nodeType !== 'local_control') {
        const delegationId = await issueDelegation(node.agentId, scopeFromPlanNode(node));
        nodeDelegations.push({
          nodeId: node.nodeId,
          agentId: node.agentId,
          delegationId,
        });
        await this.writeLedger(request.runId, 'delegation_issued', {
          planId: plan.planId,
          nodeId: node.nodeId,
          agentId: node.agentId,
          delegationId,
        });
      }
    }

    // 5. Assign mailboxes for data hops (V1: no-op, mailbox wiring in ORCH-PUSH-05)

    // 6. Execute DAG
    const dagState = initRunDagState(plan, nodeDelegations);
    this.activeRuns.set(request.runId, dagState);

    let dagResult: DagExecutionResult;
    try {
      // Multi-node planner: wrap dispatchToGovernance to thread the
      // ExecutionPlan through to each dispatch call so it can resolve
      // inputSlotReads → upstream nodeId. Single-node plans ignore
      // the third arg; the wrapper is harmless for legacy paths.
      const planAwareDispatch = (node: PlanNode, delegationId: Uuid) =>
        dispatchToGovernance(node, delegationId, plan);
      dagResult = await deps.dagExecutor.execute(dagState, {
        dispatchNode: planAwareDispatch,
        resolveCondition: (condition, metadata) => evaluateCondition(condition, metadata).result,
        onNodeEvent: async (nodeId, status) => {
          const eventType: RunEventType | null =
            status.status === 'dispatched'
              ? 'node_dispatched'
              : status.status === 'completed'
                ? 'node_completed'
                : status.status === 'failed'
                  ? 'node_failed'
                  : status.status === 'skipped'
                    ? 'node_skipped'
                    : status.status === 'timed_out'
                      ? 'node_timed_out'
                      : null;
          if (eventType) {
            await this.writeLedger(request.runId, eventType, {
              planId: plan.planId,
              nodeId,
              agentId: plan.nodes.find(n => n.nodeId === nodeId)?.agentId ?? '',
              runSequence: status.runSequence,
              ...(status.failureReason ? { failureReason: status.failureReason } : {}),
              ...(status.governanceDenied ? { governanceDenied: status.governanceDenied } : {}),
              ...(status.status === 'timed_out'
                ? {
                    timeoutMs: plan.nodes.find(n => n.nodeId === nodeId)?.timeoutMs ?? 0,
                  }
                : {}),
              ...(status.status === 'skipped' && status.failureReason
                ? { reason: status.failureReason }
                : {}),
              // CLAUDE-CODE-MODEL-SELECTION-SPEC §5: thread the dispatch
              // completionMetadata into the node-level ledger event so the
              // audit trail exposes preferredEndpointId / actualEndpointId /
              // preferenceHonored alongside the rest of the dispatch detail.
              ...(status.status === 'completed' && status.completionMetadata
                ? { completionMetadata: status.completionMetadata }
                : {}),
            });
          }
        },
      });
    } catch (_executorError: unknown) {
      // Executor threw — terminal error path [§7.2 step 6]. Under HL#4
      // revision the canonical name is `dag_step_error` (the executor
      // surfaced a step-level error; not a governance-deny). Compile is
      // emitted as `compile_not_applicable` because there is nothing to
      // assemble (HL#11 pass-through path).
      //
      // HOLE-LIFECYCLE-001 — orch does NOT write `run_closed`. It emits
      // the operational signals (dag_step_error / compile_not_applicable /
      // final_response) inside its coordination scope and returns the
      // typed terminal so the workspace writes the canonical close.
      await this.writeLedger(request.runId, 'dag_step_error', {
        planId: plan.planId,
        completedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        reason: 'executor_error',
      });
      await this.writeLedger(request.runId, 'compile_not_applicable', {
        planId: plan.planId,
        runId: request.runId,
        reason: 'executor_error',
      });
      await this.writeLedger(request.runId, 'final_response', {
        planId: plan.planId,
        runId: request.runId,
        outcome: 'executor_error',
        payload: null,
      });
      return {
        preview: this.buildPlanPreview(request, plan),
        terminal: {
          kind: 'executor_error',
          reason: 'executor_error' as NonEmpty,
          planId: plan.planId,
        },
      };
    } finally {
      this.activeRuns.delete(request.runId);
    }

    // 7. Terminal classification — cancelled check FIRST [§7.3]
    if (dagResult.finalState.cancelled) {
      // HL#4 revision — canonical user-initiated operational event. The
      // run_closed write is workspace-owned (HOLE-LIFECYCLE-001).
      await this.writeLedger(request.runId, 'user_cancelled_run', {
        planId: plan.planId,
        runId: request.runId,
        totalSkipped: dagResult.skippedNodes.length,
        totalCompleted: dagResult.completedNodes.length,
        reason: 'user_cancelled',
      });
      await this.writeLedger(request.runId, 'compile_not_applicable', {
        planId: plan.planId,
        runId: request.runId,
        reason: 'user_cancelled_run',
      });
      await this.writeLedger(request.runId, 'final_response', {
        planId: plan.planId,
        runId: request.runId,
        outcome: 'cancelled',
        payload: null,
      });
      return {
        preview: this.buildPlanPreview(request, plan),
        terminal: {
          kind: 'user_cancelled_during_run',
          reason: 'user_cancelled_run' as NonEmpty,
          planId: plan.planId,
        },
      };
    }

    // 8. Evaluate completion [§4.9]
    const classification = classifyDagCompletion({
      cancelled: false,
      completedCount: dagResult.completedNodes.length,
      failedCount: dagResult.failedNodes.length,
      skippedCount: dagResult.skippedNodes.length,
      partialCompletion: {
        enabled: manifest.partialCompletion.enabled,
        minRequiredCompletedNodes: manifest.partialCompletion.minRequiredCompletedNodes,
        compileOnPartial: manifest.partialCompletion.compileOnPartial,
      },
    });

    if (classification === 'dag_completed') {
      await this.writeLedger(request.runId, 'dag_completed', {
        planId: plan.planId,
        completedCount: dagResult.completedNodes.length,
      });
    } else if (classification === 'dag_partial_complete') {
      await this.writeLedger(request.runId, 'dag_partial_complete', {
        planId: plan.planId,
        completedCount: dagResult.completedNodes.length,
        failedCount: dagResult.failedNodes.length,
        skippedCount: dagResult.skippedNodes.length,
      });
    } else {
      // HL#4 revision — DAG produced no compile-eligible nodes; orch logs
      // the step-error state. Run closure is decided below by the compile
      // eligibility branch.
      await this.writeLedger(request.runId, 'dag_step_error', {
        planId: plan.planId,
        completedCount: dagResult.completedNodes.length,
        failedCount: dagResult.failedNodes.length,
        skippedCount: dagResult.skippedNodes.length,
        reason: 'no_compile_eligible_nodes',
      });
    }

    // 9. Compile handoff [§4.8]
    const compileEligible =
      dagResult.completedNodes.length > 0 &&
      (dagResult.failedNodes.length === 0 ||
        (manifest.partialCompletion.enabled && manifest.partialCompletion.compileOnPartial));

    if (compileEligible) {
      await this.writeLedger(request.runId, 'compile_triggered', {
        planId: plan.planId,
        runId: request.runId,
        ...(plan.outputContractTemplateId !== undefined
          ? { outputContractTemplateId: plan.outputContractTemplateId }
          : {}),
        ...(plan.outputContractTemplateVersion !== undefined
          ? { outputContractTemplateVersion: plan.outputContractTemplateVersion }
          : {}),
      });
      // Phase 4: forward the planner-selected output contract template
      // (when present) to composition-root triggerCompile so the
      // CompileRequest carries templateId + templateVersion.
      const template =
        plan.outputContractTemplateId !== undefined &&
        plan.outputContractTemplateVersion !== undefined
          ? {
              templateId: plan.outputContractTemplateId,
              templateVersion: plan.outputContractTemplateVersion,
            }
          : undefined;
      if (template !== undefined) {
        await deps.triggerCompile(request.runId, template);
      } else {
        await deps.triggerCompile(request.runId);
      }
      // HOLE-LIFECYCLE-001: compile-return delivery path writes run_closed
      // when the workspace acknowledges the artifact. Workspace must
      // NOT also close — that would double-write.
      return {
        preview: this.buildPlanPreview(request, plan),
        terminal: { kind: 'compile_dispatched', planId: plan.planId },
      };
    }
    // HL#4 revision — nothing to compile (HL#11 pass-through, but with
    // no eligible results). Emit operational `compile_not_applicable` +
    // `final_response`; workspace owns the canonical `run_closed`.
    await this.writeLedger(request.runId, 'compile_not_applicable', {
      planId: plan.planId,
      runId: request.runId,
      reason: 'no_eligible_results',
    });
    await this.writeLedger(request.runId, 'final_response', {
      planId: plan.planId,
      runId: request.runId,
      outcome: 'no_eligible_results',
      payload: null,
    });
    return {
      preview: this.buildPlanPreview(request, plan),
      terminal: {
        kind: 'no_compile_inputs',
        reason: 'no_eligible_results' as NonEmpty,
        planId: plan.planId,
      },
    };
  }

  // ─── cancelRun [§7.3, OD-ORCH-05] ───

  async cancelRun(runId: Uuid): Promise<void> {
    const dagState = this.activeRuns.get(runId);
    if (!dagState) {
      // Run not active — no-op [§7.3]
      return;
    }
    dagState.cancelled = true;
    // Executor loop detects on next iteration [§6.3]
    // Run Ledger events written by handleRun terminal classification [§7.2]
  }

  // ─── Helpers ───

  private async writeLedger(
    runId: Uuid,
    eventType: RunEventType,
    detail: Record<string, unknown>
  ): Promise<void> {
    await this.deps.runLedgerWriter.writeEvent({
      runId,
      eventType,
      timestamp: nowIso(),
      actorId: this.orchestratorActorId,
      detail,
    });
  }

  private planPreviewFromRejection(
    request: WorkspaceRunRequest,
    rejection: PlanRejection,
    checkback: RejectionCheckbackPayload | null = null
  ): OrchestratorPlanPreview {
    // HL#4 (component outline §HL #4 + fix-spec 2026-05-23 §4): every
    // planner-infeasibility return ALWAYS requires a user decision (cancel,
    // rephrase, or — if alternatives exist — pick one). `requiresUserApproval`
    // is the synchronous callback signal per spec §4.3 step 3, separate from
    // the SSE-driven `plan_checkback_sent` event that carries the modal
    // payload when the planner attached one. Without this flag, the
    // workspace shell sees an empty preview and has no honest way to render
    // "the plan failed; here are your options" — it would either silently
    // hang or treat the run as terminally failed, both of which violate
    // HL#4 (orch has zero authority to terminate a run; only the user does).
    // Prior to 2026-05-23 the flag was gated on `checkback !== null`, which
    // left malformed-plan + planner-without-alternatives paths emitting
    // `planner_infeasible` but signalling no user action needed.
    void rejection;
    return {
      runId: request.runId,
      orchestratorSocketId: this.manifest.orchestratorSocketId,
      orchestratorActorId: this.orchestratorActorId,
      plannerMode:
        this.manifest.plannerMode === 'deterministic_first'
          ? 'deterministic'
          : this.manifest.plannerMode,
      selectedAgents: [],
      requiresUserApproval: true,
      planDigest: '' as Sha256Hex,
      plan: null,
      rejection: checkback,
    };
  }

  private buildPlanPreview(
    request: WorkspaceRunRequest,
    plan: ExecutionPlan
  ): OrchestratorPlanPreview {
    const selectedAgents: OrchestratorSelectedAgent[] = plan.nodes.map(n => ({
      agentId: n.agentId,
      taskId: n.nodeId,
      taskSummary: n.taskSummary,
      requiresNvg: n.requiresNvg,
      requiresNxs: n.requiresNxs,
      estimatedRisk: n.declaredRiskHint,
      expectedOutputSlots: n.expectedOutputSlots,
    }));

    return {
      runId: request.runId,
      orchestratorSocketId: this.manifest.orchestratorSocketId,
      orchestratorActorId: this.orchestratorActorId,
      plannerMode: 'deterministic',
      selectedAgents,
      requiresUserApproval: false,
      planDigest: plan.planDigest,
      plan,
      rejection: null, // success path — no checkback needed
    };
  }
}

// ─── PlannerTraceReader / PlannerCheckbackReader duck-type readers ───
// AMEND-nexus-planner-db-lexicon-v0-2-1.md §3.2 + §3.3.3.
//
// The coordinator detects whether the configured planner exposes
// `getLastTrace()` / `getLastRejectionCheckback()` via property-existence
// duck-type. Planners that don't implement these methods (e.g. legacy
// RefDeterministicPlanner) simply skip the ledger emission. The
// PlannerTraceReader interface is in `@nexus/contracts`;
// `getLastRejectionCheckback` is package-local on the
// DbLexiconTransformerPlanner (per spec §13 ratifications — only the
// trace reader was elevated to a contract surface).

function readPlannerTrace(planner: Planner): PlannerPlanTrace | null {
  if (
    'getLastTrace' in planner &&
    typeof (planner as unknown as PlannerTraceReader).getLastTrace === 'function'
  ) {
    return (planner as unknown as PlannerTraceReader).getLastTrace();
  }
  return null;
}

function readPlannerRejectionCheckback(planner: Planner): RejectionCheckbackPayload | null {
  if (
    'getLastRejectionCheckback' in planner &&
    typeof (planner as unknown as { getLastRejectionCheckback: () => unknown })
      .getLastRejectionCheckback === 'function'
  ) {
    const value = (
      planner as unknown as { getLastRejectionCheckback: () => RejectionCheckbackPayload | null }
    ).getLastRejectionCheckback();
    return value;
  }
  return null;
}

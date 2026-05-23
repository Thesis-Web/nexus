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
  triggerCompile: (runId: Uuid) => Promise<void>;
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
  handleRun(
    request: WorkspaceRunRequest,
    perRunDeps?: RunCoordinatorPerRunDeps
  ): Promise<OrchestratorPlanPreview>;
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
  ): Promise<OrchestratorPlanPreview> {
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
      // HL#4 revision (component outline §HL #4, Owner-Ratified 2026-05-23):
      // orch has zero governance authority. Planner infeasibility is an
      // orchestration callback signal, not a governance-deny. Emit the
      // canonical `planner_infeasible` event. KNOWN GAP: the full
      // planner-infeasibility-to-workspace-callback UX is not yet built —
      // the run coordinator returns the OrchestratorPlanPreview to the caller
      // and the workspace UI surfaces the rejection / alternatives modal;
      // the dedicated callback queue is a future session.
      await this.writeLedger(request.runId, 'planner_infeasible', {
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

      return this.planPreviewFromRejection(request, rejection, checkback);
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
      return this.planPreviewFromRejection(request, {
        rejected: true,
        reason: 'malformed_request',
        reasonDetail: validation.reason!,
        suggestedAlternatives: [],
      });
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
        // `user_cancelled_run` event under the user-initiated terminal
        // class. The workspace surfaces the rejection / alternatives modal
        // off the returned OrchestratorPlanPreview.
        await this.writeLedger(request.runId, 'user_cancelled_run', {
          reason: 'user_rejected_plan',
        });
        // CHECKBACK-spec Part 4: a user-rejected checkback must close the run
        // cleanly. Without this the workspace's status endpoint never flips
        // to 'closed' and the timeline hangs on the rejected planning stage.
        await this.writeLedger(request.runId, 'run_closed', {
          planId: plan.planId,
          runId: request.runId,
          closedBy: 'orch-ref',
          closeReason: 'user_cancelled',
        });
        return preview;
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
      await this.writeLedger(request.runId, 'run_closed', {
        planId: plan.planId,
        runId: request.runId,
        closedBy: 'orch-ref',
        reason: 'executor_error',
      });
      return this.buildPlanPreview(request, plan);
    } finally {
      this.activeRuns.delete(request.runId);
    }

    // 7. Terminal classification — cancelled check FIRST [§7.3]
    if (dagResult.finalState.cancelled) {
      // HL#4 revision — canonical user-initiated terminal event.
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
      await this.writeLedger(request.runId, 'run_closed', {
        planId: plan.planId,
        runId: request.runId,
        closedBy: 'orch-ref',
        reason: 'user_cancelled_run',
      });
      return this.buildPlanPreview(request, plan);
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
      });
      await deps.triggerCompile(request.runId);
    } else {
      // HL#4 revision — nothing to compile (HL#11 pass-through, but with
      // no eligible results). Emit `compile_not_applicable` (canonical
      // name) and close with the same reason string.
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
      await this.writeLedger(request.runId, 'run_closed', {
        planId: plan.planId,
        runId: request.runId,
        closedBy: 'orch-ref',
        reason: 'compile_not_applicable',
      });
    }

    return this.buildPlanPreview(request, plan);
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
    // When the planner produced a counter-suggestion (Branch 3 reject
    // path), the coordinator attaches the executable RejectionCheckbackPayload
    // to `preview.rejection`. Workspace UI consumes this to drive the
    // Accept-Suggestions / Cancel-Run modal. `requiresUserApproval` flips
    // to true so the workspace shell treats this as a user-decision
    // state rather than a terminal rejection.
    return {
      runId: request.runId,
      orchestratorSocketId: this.manifest.orchestratorSocketId,
      orchestratorActorId: this.orchestratorActorId,
      plannerMode:
        this.manifest.plannerMode === 'deterministic_first'
          ? 'deterministic'
          : this.manifest.plannerMode,
      selectedAgents: [],
      requiresUserApproval: checkback !== null,
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

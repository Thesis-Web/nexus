// packages/contracts/src/externals/workspace.ts
// AMEND-spec-nexus-infra-externals-v0-2-5 §3.2, §3.2.1 — Workspace Contracts
// Layer 2 — workspace run request, workspace adapter socket, compile-return ack.
//
// WorkspaceRunRequest law:
// - runId is generated before this request leaves the workspace boundary.
// - prompt is volatile transit data; not written to long-term Run Ledger detail.
// - promptDigest = sha256(canonicalize({ runId, prompt, enteredAt, workspaceSocketId }))
// - selectedAgentIds may be empty when orchestrator owns agent selection.
// - Identity-provider references may be in Run Ledger detail but not in this contract.
// - Raw IAM/OAuth tokens must never be copied into this contract.
//
// WorkspaceAdapter law:
// - submitRun is optional; many production workspaces are external HTTP callers.
// - acceptFinalResponse is required for in-process or reference harness representation.
// - A workspace adapter must not call LLMs as part of entry, return, or display.
// - Final response acceptance path must verify compile-return auth before user display.

import type { Uuid, IsoTimestamp, Sha256Hex, NonEmpty } from '../types/index.js';
import type { DenialCode } from '../constants/index.js';
import type { CompileReturnRequest } from './compile-return.js';
import type { SubTaskDecl, SubTaskEdgeHint } from './planner.js';
import type { OutputFormat } from './workspace-governed.js';

// ─── WorkspaceRunRequest ───

export interface WorkspaceRunRequest {
  runId: Uuid;
  userId: NonEmpty;
  principalId: Uuid;
  authenticatedBy: NonEmpty;
  enteredAt: IsoTimestamp;
  prompt: NonEmpty;
  promptDigest: Sha256Hex;
  promptRef: NonEmpty | null;
  selectedAgentIds: Uuid[];
  workspaceSocketId: NonEmpty;
  planCheckbackRequested: boolean;
  /**
   * User's model preference from the workspace dropdown — the endpointId the
   * user selected (e.g., "ollama-jameshp"). null when the user chose the
   * "Auto (policy)" option or omitted a preference.
   *
   * Treated downstream as a weighted suggestion, not an override. Governance
   * (data classification, OCT model-tier ceiling, routing policy) still
   * applies — the preference biases endpoint selection within the governed
   * tier set. Outside-ceiling → DENY. Unhealthy → fall through to policy
   * routing (which may trigger a checkback).
   */
  preferredEndpointId: NonEmpty | null;
  /**
   * CLAUDE-CODE-FILE-ATTACH Phase A — file content the workspace route read
   * from the blob store after classification + binding. Each entry carries
   * file metadata and the decoded content (UTF-8 for text-like media types,
   * base64 for binary). Empty array when no files are attached.
   *
   * Phase A semantics: this content is included in the model prompt as
   * READ-ONLY context. The model can summarize, quote, or reason over it
   * but cannot act on external systems through it — that requires NXS +
   * connectors, deferred to a later phase.
   *
   * This field is transient: it lives only long enough for the orchestrator
   * to assemble the NVG payload. It is NEVER copied into the run-ledger
   * detail (only metadata is logged) and NEVER persisted in WorkspaceRunRequest
   * storage. The blob store remains the system of record for file bytes.
   */
  attachedFiles: ReadonlyArray<{
    fileId: string;
    filename: string;
    mediaType: string;
    /** UTF-8 text for text-like media types; base64 for binary. */
    content: string;
  }>;
  /**
   * AMEND-spec-nexus-orch §5 extension — multi-node planner submit shape.
   * When non-null and non-empty, the workspace is submitting an explicit
   * sub-task DAG (as the bash-script workflow shapes do today). The
   * orchestrator threads `subTasks` and `subTaskEdges` into the
   * PlannerRequest unchanged; the planner emits one PlanNode per sub-task
   * with proper kind-driven nodeType branching. When null, the legacy
   * single-prompt path (selectedAgentIds → 1-node-per-agent) applies.
   *
   * Required-and-nullable rather than optional so workspace-route
   * construction stays clean under exactOptionalPropertyTypes — every
   * WorkspaceRunRequest carries an explicit null on the legacy path.
   */
  subTasks: SubTaskDecl[] | null;
  subTaskEdges: SubTaskEdgeHint[] | null;
  /**
   * AMEND-nexus-planner-db-lexicon-v0-2-1.md §3.7. Additive optional
   * field, V1. Non-null when this run was opened via the
   * Accept-Suggestions flow from a prior preferred-agents preflight
   * rejection — carries the prior `runId` for audit correlation. Null
   * on fresh runs. Existing routes pass through; no business logic
   * depends on it being non-null. DIFF-PLANNER-LEXICON-CONTRACT-001.
   */
  checkbackSourceRunId: Uuid | null;
  /**
   * Outline §5 — workspace run-type discriminator. The workspace route
   * sets this from the POST body's `promptMode` discriminator (one of
   * free_text / sectioned / secure_rails). The planner branches on it
   * to derive the correct PlannerRequest tier. Required field per
   * WorkspaceRunEnvelope at workspace-governed.ts §3.8.2.
   */
  promptMode: 'free_text' | 'sectioned' | 'secure_rails';
  /**
   * Outline §D + §J — output contract template the user pre-picked on a
   * sectioned-mode submission. Null when:
   *   - promptMode is 'free_text' or 'secure_rails' (the planner may
   *     still emit a template if the prompt itself calls for one;
   *     this field only captures USER intent)
   *   - promptMode is 'sectioned' AND the user did not pre-pick
   *     (planner will pick via the prompt->template lexicon)
   *
   * Both `templateId` and `templateVersion` travel together. When the
   * planner picks (no user choice), it writes its choice to the
   * ExecutionPlan's outputContractTemplateId/Version fields instead.
   * This request-side field is only the user's pre-pick.
   */
  outputContractTemplate: {
    readonly templateId: NonEmpty;
    readonly templateVersion: NonEmpty;
    readonly outputFormat?: OutputFormat;
    readonly executionMode?: 'human_in_the_loop' | 'autonomous';
  } | null;
}

// ─── CompileReturnAck ───

export interface CompileReturnAck {
  runId: Uuid;
  returnEndpointId: NonEmpty;
  accepted: boolean;
  acceptedAt: IsoTimestamp;
  reason: DenialCode | null;
}

// ─── WorkspaceAdapter — replaceable socket contract ───

export interface WorkspaceAdapter {
  readonly workspaceSocketId: NonEmpty;
  readonly workspaceVersion: NonEmpty;
  submitRun?(input: unknown): Promise<WorkspaceRunRequest>;
  acceptFinalResponse(request: CompileReturnRequest): Promise<CompileReturnAck>;
}

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

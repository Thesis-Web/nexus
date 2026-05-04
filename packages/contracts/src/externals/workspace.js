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
export {};

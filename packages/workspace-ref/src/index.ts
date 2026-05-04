// packages/workspace-ref/src/index.ts
// AMEND-nexus-spec-workspace-v1-1-1 §1.1
// Layer 7 — reference workspace barrel export.

export { SqliteWorkspaceSessionStore } from './auth/workspace-session-store.js';
export { SqliteWorkspaceRunAclStore } from './stores/workspace-run-acl-store.js';
export { SqliteWorkspaceEventTicketStore } from './stores/workspace-event-ticket-store.js';
export { SqliteWorkspaceFileStore } from './stores/workspace-file-store.js';
export { FilesystemWorkspaceBlobStore } from './stores/workspace-blob-store.js';
export { SqlitePromptTemplateStore } from './stores/prompt-template-store.js';
export { SqliteSecureRailStore } from './stores/secure-rail-store.js';
export {
  ReferenceWorkspaceApprovalBridge,
  ApprovalBridgeError,
} from './bridge/workspace-approval-bridge.js';
export type { ApprovalBridgeDeps } from './bridge/workspace-approval-bridge.js';

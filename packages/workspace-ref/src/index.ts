// packages/workspace-ref/src/index.ts
// AMEND-nexus-spec-workspace-v1-1-1 §1.1
// Layer 7 — reference workspace barrel export.
//
// Concrete store implementations exported here for bootstrap DI wiring.
// API routes import contract-level port interfaces from @nexus/contracts,
// NOT these concrete implementations (§0.5 plug-and-play law).

export { SqliteWorkspaceSessionStore } from './auth/workspace-session-store.js';

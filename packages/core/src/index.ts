/**
 * @nexus/core — public barrel
 *
 * Re-exports every public symbol from every core module.
 * Exists so `import { ... } from '@nexus/core'` resolves via the
 * workspace symlink + development export condition without a dist/ build.
 *
 * Spec: nexus-engineering-spec-v0-4-6.md §10–§20
 * Blueprint: nexus-blueprint-v0-3-6.md §4–§9
 *
 * Conflict handling:
 *   ChainError     — class in types/index.ts (NexusError subclass);
 *                    interface in chain-verifier.ts (different shape).
 *                    chain-verifier's interface re-exported as ChainVerifierError.
 *   PendingApprovalStore — interface in types/index.ts (simple);
 *                          interface in pending-approval-store.ts (full SQLite shape).
 *                          types version exported via export * from types.
 *                          Module's concrete class SqlitePendingApprovalStore exported explicitly.
 */

// ── §10–§12 — Governed constants, primitives, interfaces, errors ────────────
export * from './types/index.js';

// ── §15 — Utility helpers ───────────────────────────────────────────────────
export * from './utils/time.js';
export * from './utils/helpers.js';

// ── §15 — Crypto layer ──────────────────────────────────────────────────────
export * from './crypto/canonicalize.js';
export * from './crypto/signer.js';
export * from './crypto/verifier.js';
export * from './crypto/key-manager.js';

// ── §20.1 — SQLite schema ───────────────────────────────────────────────────
export * from './db/schema.js';

// ── §17 — Security layer ────────────────────────────────────────────────────
export * from './security/replay-detector.js';
export * from './security/injection-guard.js';
export * from './security/rate-limiter.js';
export * from './security/threat-log.js';

// ── §20 — Identity registries and stores ───────────────────────────────────
export * from './identity/actor-registry.js';
export * from './identity/principal-registry.js';
export * from './identity/approver-registry.js';
export * from './identity/session-store.js';
export * from './identity/delegation-store.js';
export * from './identity/delegation-engine.js';

// ── §13.3 — Classification ──────────────────────────────────────────────────
export * from './classification/verb-normalizer.js';
export * from './classification/target-normalizer.js';
export * from './classification/capability-registry.js';
export * from './classification/data-classifier.js';
export * from './classification/risk-classifier.js';

// ── §13.5 — Policy engine ───────────────────────────────────────────────────
export * from './policy/evaluator.js';
export * from './policy/rule-loader.js';
export * from './policy/grant-template-builder.js';

// ── §13.6 — Approval (packager, decision service, channels) ─────────────────
// channel.interface.ts only re-exports ApprovalChannel from types — skip.
export * from './approval/packager.js';
export * from './approval/decision-service.js';
// pending-approval-store exports a DIFFERENT PendingApprovalStore interface
// (create/getStatus/resolve/markTimedOut vs types' save/delete shape).
// Export only the concrete class to avoid the duplicate-name conflict.
export { SqlitePendingApprovalStore } from './approval/pending-approval-store.js';
export * from './approval/channels/cli.channel.js';

// ── §13.7 — Execution ───────────────────────────────────────────────────────
export * from './execution/grant-minter.js';
export * from './execution/grant-vault.js';

// ── §18 — Redaction ─────────────────────────────────────────────────────────
export * from './redaction/redactor.js';

// ── §14 — CCV / compiler view ───────────────────────────────────────────────
export * from './compiler-view/ccv-builder.js';

// ── §16 — Ledger ────────────────────────────────────────────────────────────
// backend.interface.ts only re-exports LedgerBackend from types — skip.
// chain-verifier exports interface ChainError which conflicts with class ChainError in types.
// Re-export the non-conflicting symbols + rename the conflicting interface.
export { ChainVerificationResult, verifyChain } from './ledger/chain-verifier.js';
export type { ChainError as ChainVerifierError } from './ledger/chain-verifier.js';
export * from './ledger/backends/jsonl.backend.js';

// ── §13.1 — Pipeline orchestrator ───────────────────────────────────────────
export * from './engine/pipeline.js';

// ── §13.2–§13.8 — Gates ─────────────────────────────────────────────────────
// gate.interface.ts only re-exports Gate/GateResult/PipelineContext from types — skip.
export * from './gates/01-identity.gate.js';
export * from './gates/02-classification.gate.js';
export * from './gates/03-delegation.gate.js';
export * from './gates/04-policy.gate.js';
export * from './gates/05-approval.gate.js';
export * from './gates/06-execution.gate.js';
export * from './gates/07-evidence.gate.js';

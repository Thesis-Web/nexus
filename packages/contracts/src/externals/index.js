// packages/contracts/src/externals/index.ts
// AMEND-spec-nexus-infra-externals-v0-2-5 §3 — Externals Barrel
// AMEND-spec-nexus-orch §4.5 — Barrel Extensions
// Layer 2 — public compatibility surface for external plugin contracts.
//
// All plugin-facing contracts are exported here. Baked service interfaces
// (MailboxService, CompileService) are exported as types for DI composition
// but are NOT replaceable plugin surfaces — see individual files for law.
export { OUTPUT_FORMAT_VALUES, ELEVATED_AUTH_METHOD } from './workspace-governed.js';

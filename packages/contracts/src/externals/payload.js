// packages/contracts/src/externals/payload.ts
// AMEND-spec-nexus-infra-externals-v0-2-5 §3.14 — Payload Reference Contracts
// Layer 2 — plugin-facing payload verification/storage contracts.
//
// Payload contracts define how infrastructure verifies resultRef without
// making NVG/NXS/mailbox know every storage system.
//
// V1 allowed reference schemes:
//   mailbox://<runId>/<mailboxItemId>
//   file://<runtime-root-relative-path>
//   inline://<reference-harness-id>
//
// Law:
// - file:// refs must normalize under configured runtime root; path escape fails closed.
// - Unknown schemes fail closed with payload_resolver_not_found.
// - OutputCollector must verify resultDigest against bytes resolved through
//   an approved resolver before mailbox write.
// - Reference harness may use inline:// only in test/dev mode.
export {};

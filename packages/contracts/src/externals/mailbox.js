// packages/contracts/src/externals/mailbox.ts
// AMEND-spec-nexus-infra-externals-v0-2-5 §3.5, §3.6 — Mailbox Contracts
// Layer 2 — mailbox item schema, backend contract, baked service interface.
//
// MailboxBackend is the replaceable storage abstraction — the only mailbox-
// related plugin-facing contract. Enterprises may replace JSONL with
// Postgres/S3/MinIO/object storage later.
//
// MailboxService is BAKED CORE INFRASTRUCTURE — NOT a replaceable plugin
// surface. It owns eligibility and transition rules. Defined here as a type
// for DI composition; implementation lives in packages/core/src/mailbox/.
//
// Law:
// - MailboxBackend has exactly one source of truth: this file.
// - Core implementation files import this contract and must not redefine
//   a second backend interface.
// - Backend implementations must not call LLMs, NXS, NVG, connectors,
//   approval channels, or workspace endpoints.
export {};

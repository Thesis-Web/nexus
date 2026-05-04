// packages/contracts/src/externals/compiler.ts
// AMEND-spec-nexus-infra-externals-v0-2-5 §3.9 — Compiler Contracts
// Layer 2 — compile mode, compile request, final artifact, compiler socket,
// and baked compile service interface.
//
// Compiler is the replaceable compiler socket contract.
//
// CompileService is BAKED CORE INFRASTRUCTURE — NOT a replaceable plugin
// surface. It selects the configured compiler from CompilerManifestRecord,
// enforces OCT-COMPILE inheritance, invokes the compiler, signs/verifies
// final artifact law, and prepares compile-return handoff.
// Implementation: packages/core/src/compile/
//
// Law:
// - selectCompileMode must use the manifest record and compile config, not
//   the Compiler implementation object. The compiler does not self-authorize.
// - CompileConfig is inherited from base spec §12.3.33 and existing
//   packages/contracts/src/interfaces/index.ts — NOT redefined here.
// - Reference deterministic renderer implements Compiler but is actor-
//   registration exempt.
// - Any compiler calling a model, third-party service, custom synthesis, or
//   action surface must be a registered OCT-COMPILE actor.
// - A compiler must not mutate Evidence Ledger, Routing Provenance Trail,
//   Run Ledger history, mailbox payloads, or source mailbox items.
export {};

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

import type { Uuid, IsoTimestamp, Sha256Hex, Base64Url, NonEmpty } from '../types/index.js';
import type { DataClass } from '../constants/index.js';
import type { OutputContract } from './output-contract.js';
import type { MailboxItem } from './mailbox.js';
import type { CompilerManifestRecord } from './manifests.js';
import type { CompileConfig } from '../interfaces/index.js';

// ─── CompileMode ───

export type CompileMode = 'deterministic_render' | 'on_prem_synthesis' | 'frontier_synthesis';

// ─── CompileRequest ───

export interface CompileRequest {
  runId: Uuid;
  compilerSocketId: NonEmpty;
  mailboxId: NonEmpty;
  outputContractId: Uuid;
  requestedAt: IsoTimestamp;
}

// ─── FinalResponseArtifact ───

export interface FinalResponseArtifact {
  artifactId: Uuid;
  runId: Uuid;
  compilerSocketId: NonEmpty;
  compilerActorId: Uuid | null;
  compileMode: CompileMode;
  bodyRef: NonEmpty;
  bodyDigest: Sha256Hex;
  outputClassifications: DataClass[];
  sourceMailboxItems: Uuid[];
  evidenceRefs: Uuid[];
  routingTrailRefs: Uuid[];
  runLedgerRefs: Uuid[];
  createdAt: IsoTimestamp;
  signature: Base64Url;
}

// ─── Compiler — replaceable socket contract ───

export interface Compiler {
  readonly compilerSocketId: NonEmpty;
  readonly compilerVersion: NonEmpty;
  compile(
    request: CompileRequest,
    contract: OutputContract,
    items: MailboxItem[]
  ): Promise<FinalResponseArtifact>;
}

// ─── CompileService — BAKED CORE INFRASTRUCTURE (type only) ───
// NOT a replaceable plugin surface. Implementation: packages/core/src/compile/
// Enterprises may NOT bypass compile mode selection law.

export interface CompileService {
  compile(
    request: CompileRequest,
    contract: OutputContract,
    items: MailboxItem[]
  ): Promise<FinalResponseArtifact>;
  selectCompileMode(
    contract: OutputContract,
    compilerRecord: CompilerManifestRecord,
    config: CompileConfig
  ): CompileMode;
}

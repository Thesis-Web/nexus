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
import type { CompilePreferences } from './compile-template.js';

// ─── CompileMode ───

export type CompileMode = 'deterministic_render' | 'on_prem_synthesis' | 'frontier_synthesis';

// ─── CompileRequest ───

export interface CompileRequest {
  runId: Uuid;
  compilerSocketId: NonEmpty;
  mailboxId: NonEmpty;
  outputContractId: Uuid;
  requestedAt: IsoTimestamp;
  // ── Compile-ref §2.1: template selection (additive, optional) ────────────
  templateId?: NonEmpty;
  templateVersion?: NonEmpty;
  preferences?: CompilePreferences;
}

// ─── Bypass partial types (AMEND-nexus-mailbox-pit-v0-2-1 §5.2) ───
//
// Compile-time bypass disposition for items that fail one of the
// per-item verification checks during assembly. Two dispositions:
//
//   - render_partial: content is included on the artifact (labeled)
//     so the workspace can render a "Agent X produced a malformed
//     contribution; raw text shown below for reference" block.
//   - withhold_quarantine: content is referenced (by mailboxItemId +
//     provenance) but NOT included as renderable bytes. Used when
//     the content is untrusted or unsafe (digest mismatch, guard halt).
//
// Spec §5.2 disposition table:
//   slot_type_mismatch (slot not in template OR validator rejects) → render_partial
//   malformed_output   (item.agentId ≠ mailbox-derived actorId)    → withhold_quarantine
//   digest_mismatch    (compile-time re-verify failed)              → withhold_quarantine
//   guard_halt         (a halt-action guard fired on the item)      → withhold_quarantine

export type BypassReason =
  | 'malformed_output'
  | 'slot_type_mismatch'
  | 'guard_halt'
  | 'digest_mismatch';

export type BypassDisposition = 'render_partial' | 'withhold_quarantine';

export interface BypassPartial {
  /** mailboxItemId of the bypassed item. */
  mailboxItemId: Uuid;
  /** The mailbox the item lives in — authoritative provenance. */
  sourceMailboxId: NonEmpty;
  /** Producing actor (derived from the item, cross-checked with the
   *  source mailbox when the renderer has mailbox provenance info). */
  sourceActorId: Uuid;
  bypassReason: BypassReason;
  bypassDisposition: BypassDisposition;
  /** Workspace-renderable ref for render_partial bypasses. NULL for
   *  withhold_quarantine — the raw bytes are NOT in the artifact body. */
  workspacePartialRef: NonEmpty | null;
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
  /** AMEND-nexus-mailbox-pit-v0-2-1 §5.2 — per-item bypass partials
   *  collected during assembly. Empty when assembly was clean. The
   *  signature covers this field. */
  bypassPartials: readonly BypassPartial[];
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

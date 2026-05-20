// packages/contracts/src/externals/mailbox.ts
// AMEND-spec-nexus-infra-externals-v0-2-5 §3.5, §3.6 — Mailbox Contracts
// AMEND-nexus-mailbox-pit-v0-2-1 §3.1 + §3.2 — Mailbox Pit (per-actor isolation)
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
// - Per AMEND-nexus-mailbox-pit-v0-2-1 §0.3: R2-WIRE-008 "exactly one
//   enabled required mailbox" is SUPERSEDED at the runtime allocation
//   layer. One MailboxManifestRecord still describes one backend
//   instance; that backend hosts many per-actor mailboxIds per run.

import type { Uuid, IsoTimestamp, Sha256Hex, NonEmpty } from '../types/index.js';
import type { DataClass, OctLevel, DenialCode } from '../constants/index.js';
import type { ProvenanceSource } from '../interfaces/index.js';
import type {
  OutputSourceType,
  NvgOutputReference,
  NxsOutputReference,
  AgentPartialOutputReference,
} from './output-references.js';

// ─── Status and redaction types ───

export type MailboxStatus = 'available' | 'blocked' | 'cancelled' | 'expired' | 'consumed';

export type RedactionState = 'not_required' | 'redacted' | 'blocked';

// ─── MailboxItem ───

export interface MailboxItem {
  mailboxItemId: Uuid;
  mailboxId: NonEmpty;
  runId: Uuid;
  taskId: Uuid;
  agentId: Uuid;
  slotId: NonEmpty;
  sourceType: OutputSourceType;
  resultRef: NonEmpty;
  resultDigest: Sha256Hex;
  resultClassifications: DataClass[];
  /**
   * F4.11 §2.2 / Hard Law #6 — provenance of the payload. Set by the
   * writer (NXS connector bridge → 'nxs_connector_result'; agent
   * compile-drop → 'agent_output'; NVG sandbox return → 'agent_output';
   * workspace attachment binder → 'workspace_upload'; chat-history
   * loader → 'planner_history'). NVG's classify-and-route gate applies
   * the §3.3 empty-labels case split using this field; missing trusted
   * provenance with empty labels fails the wall closed.
   *
   * 'unknown' is the defensive default the runtime-utils helper
   * produces when no writer-side mapping applies. Writers SHOULD always
   * supply a concrete source — 'unknown' is reserved for cases where
   * the upstream chain is incomplete and the gate must quarantine.
   */
  provenance: ProvenanceSource;
  octLevel: OctLevel;
  createdAt: IsoTimestamp;
  expiresAt: IsoTimestamp | null;
  evidenceRecordId: Uuid | null;
  routingTrailRecordId: Uuid | null;
  runLedgerEventId: Uuid | null;
  redactionState: RedactionState;
  mailboxStatus: MailboxStatus;
  compileEligible: boolean;
  consumedAt: IsoTimestamp | null;
  blockedReason: DenialCode | null;
}

// ─── MailboxAllocation ───
// AMEND-nexus-mailbox-pit-v0-2-1 §3.1.
// Authoritative provenance record for a per-(runId, actorId) mailbox.
// Compile derives provenance from this record (or from the inverted
// listMailboxesForRun map). Compile MUST NOT parse mailboxId strings
// on the hot path — the deterministic decode function lives in
// packages/core/src/mailbox/mailbox-audit-utils.ts and is NOT exported
// through any public barrel (see spec §3.1.1).

export interface MailboxAllocation {
  allocationId: Uuid;
  runId: Uuid;
  actorId: Uuid;
  mailboxId: NonEmpty;
  /** V1 — future amendments may add 'orch_inbox', 'compile_inbox', etc.
   *  V1 ONLY assigns 'agent_output' (per spec §2.5 / §2.6: no orch or
   *  compile mailbox pre-allocation). */
  mailboxRole: 'agent_output';
  /** Which MailboxBackend instance hosts this mailbox. V1 always
   *  matches the single configured backend's backendId; reserved for
   *  multi-backend amendments. */
  backendId: NonEmpty;
  allocatedAt: IsoTimestamp;
  /** Schema version of the allocation record. Pinned for forward-
   *  compatible migrations. V1 value MUST be 'mailbox-pit/v1'. */
  allocationVersion: 'mailbox-pit/v1';
}

// ─── MailboxWriteContext ───
// AMEND-nexus-mailbox-pit-v0-2-1 §3.6.
// Self-describing record carried with every OutputCollector write so
// the callsite EXPLICITLY declares which mailbox + actor + task + slot
// is being written. Audit grep-ability + redundancy check against the
// output reference's internal fields + the input parameter for
// MailboxService.assertMailboxBelongsToActor.
//
// Fields are intentionally redundant with the output reference (which
// already carries runId/agentId/taskId/slotId). The redundancy lets the
// write boundary catch ANY callsite where the dispatcher's view of who
// produced the item disagrees with what the output reference claims.

export interface MailboxWriteContext {
  /** Run this write belongs to. Must equal output.runId. */
  runId: Uuid;
  /** Actor whose authority produced the output. Must equal output.agentId.
   *  Used by MailboxService.assertMailboxBelongsToActor to confirm the
   *  mailboxId was allocated to this actor under runId. */
  producerActorId: Uuid;
  /** The mailbox the item is being written to. MUST be the per-actor
   *  mailbox allocated to producerActorId for runId — single-primary
   *  fallback is no longer permitted (R2-WIRE-008 superseded; spec
   *  §0.3). */
  mailboxId: NonEmpty;
  /** Plan node id producing the item. Must equal output.taskId. */
  taskId: Uuid;
  /** Output slot being written. Must equal output.slotId. */
  slotId: NonEmpty;
}

// ─── Backend write/read contracts ───

export interface MailboxWriteInput {
  mailboxId: NonEmpty;
  output: NvgOutputReference | NxsOutputReference | AgentPartialOutputReference;
  expiresAt: IsoTimestamp | null;
  runLedgerEventId: Uuid | null;
}

export interface MailboxReadQuery {
  mailboxId: NonEmpty;
  runId: Uuid;
  includeIneligible?: boolean;
}

// ─── MailboxBackend — replaceable storage abstraction ───

export interface MailboxBackend {
  readonly backendId: NonEmpty;
  readonly backendVersion: NonEmpty;
  write(item: MailboxItem): Promise<void>;
  getById(mailboxItemId: Uuid): Promise<MailboxItem | null>;
  listByRun(query: MailboxReadQuery): Promise<MailboxItem[]>;
  updateStatus(
    mailboxItemId: Uuid,
    next: MailboxStatus,
    reason: DenialCode | null
  ): Promise<MailboxItem>;
}

// ─── MailboxService — BAKED CORE INFRASTRUCTURE (type only) ───
// NOT a replaceable plugin surface. Implementation: packages/core/src/mailbox/
// Enterprises may NOT replace eligibility, transition, or digest/classification law.

export interface MailboxService {
  writeFromOutput(input: MailboxWriteInput): Promise<MailboxItem>;
  listEligibleForCompile(mailboxId: NonEmpty, runId: Uuid): Promise<MailboxItem[]>;
  markConsumed(mailboxId: NonEmpty, runId: Uuid, itemIds: Uuid[]): Promise<void>;
  cancelRun(mailboxId: NonEmpty, runId: Uuid, reason: DenialCode): Promise<void>;
  /**
   * Multi-node planner slot-read lookup. Returns the most recent
   * available mailbox item matching (runId, taskId, slotId) — i.e. the
   * output of an upstream node addressed by a downstream node's
   * `inputSlotReads` entry. Returns null when no item exists, when all
   * matching items are blocked/cancelled/expired/consumed, or when the
   * digest verification path would fail. Read-only; no state transitions.
   */
  findBySlot(
    mailboxId: NonEmpty,
    runId: Uuid,
    taskId: Uuid,
    slotId: NonEmpty
  ): Promise<MailboxItem | null>;

  // ── Mailbox-pit V1 (AMEND-nexus-mailbox-pit-v0-2-1 §3.2) ─────────────
  // Per-actor mailbox allocation + provenance + ownership-assertion
  // surface. The single-primary-mailbox dispatch path (R2-WIRE-008) is
  // superseded by the per-actor allocation model — every NXS / NVG write
  // and every cross-actor slot read goes through one of these methods.

  /** Allocate one per-actor mailbox for each unique actorId in the
   *  actors set. Idempotent: same input → same mailboxIds, no duplicate
   *  events. Persists each new allocation per spec §3.3 (allocation
   *  index OR reconstructable from Run Ledger `mailbox_allocated`
   *  events). Emits `mailbox_allocated` to the run ledger for each
   *  newly-allocated mailbox. Returns the canonical mailboxId per
   *  actorId. */
  allocateForRun(runId: Uuid, actors: readonly Uuid[]): Promise<ReadonlyMap<Uuid, NonEmpty>>;

  /** Return the canonical mailboxId for a (runId, actorId) pair.
   *  Returns null when no allocation exists. Does NOT auto-allocate —
   *  allocateForRun must have run first. */
  getMailboxForActor(runId: Uuid, actorId: Uuid): Promise<NonEmpty | null>;

  /** Enumerate every mailbox allocated for the run, keyed by actorId.
   *  Compile reads this to build its list of source targets; the
   *  inverted map (mailboxId → actorId) is compile's hot-path
   *  provenance index. */
  listMailboxesForRun(runId: Uuid): Promise<ReadonlyMap<Uuid, NonEmpty>>;

  /** Resolve the typed MailboxAllocation record for a (runId, mailboxId)
   *  pair. Returns null when the mailboxId is unknown for the run.
   *  Hot-path consumer: a future audit-aware compile mode. Compile's
   *  default hot path uses the inverted listMailboxesForRun map. */
  resolveMailboxProvenance(runId: Uuid, mailboxId: NonEmpty): Promise<MailboxAllocation | null>;

  /** Assert the mailboxId belongs to the actorId under the runId.
   *  Throws NexusSecurityViolation (with a typed denial code) on
   *  mismatch. Called by writeFromOutput before persisting any item
   *  (spec §3.6 write-time ownership validation); may be called by
   *  any defensive callsite that wants the structural assertion. */
  assertMailboxBelongsToActor(runId: Uuid, actorId: Uuid, mailboxId: NonEmpty): Promise<void>;
}

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

import type { Uuid, IsoTimestamp, Sha256Hex, NonEmpty } from '../types/index.js';
import type { DataClass, OctLevel, DenialCode } from '../constants/index.js';
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
}

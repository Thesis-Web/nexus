/**
 * SigningCouncil — AMEND-nexus-admin-multi-admin-signing-federation-v0-1-0.md
 *
 * Baked aggregation service for federated mutations. Every governance-
 * significant operation (mode_unlock, policy_bundle_replace,
 * signing_council_change, lexicon_mutation) flows through here and
 * requires 2 distinct registered admin signatures (Q4) before its
 * operation-specific dispatcher runs.
 *
 * Storage: in-memory by default. Persistent storage is injected via the
 * RequestStore port so the council can run inside a long-lived server
 * (sqlite or jsonl) or a unit test (Map).
 *
 * Layer: core (BAKED). Plug-in admin-writer routes call into this
 * service; plug-in dashboard UIs render the SigningRequest list.
 */
import { randomUUID, createHash } from 'crypto';
import type {
  Base64Url,
  IsoTimestamp,
  NonEmpty,
  RunLedgerWriter,
  Sha256Hex,
  SigningRequest,
  SigningCouncilPort,
  SigningCouncilDispatcher,
  FederatedOperationName,
  SigningRequestStatusName,
} from '@nexus/contracts';
import { FEDERATED_OPERATION, SIGNING_REQUEST_STATUS, getThreshold } from '@nexus/contracts';
import { canonicalize } from '../crypto/canonicalize.js';
import { verify } from '../crypto/verifier.js';
import { loadAdminPublicKey, emitInfrastructureAuditEvent } from '../modes/mode-manager.js';

const DEFAULT_EXPIRY_SECONDS = 24 * 60 * 60; // 24h

export interface SigningCouncilRequestStore {
  put(req: SigningRequest): Promise<void>;
  get(requestId: NonEmpty): Promise<SigningRequest | null>;
  list(filter?: {
    status?: SigningRequestStatusName;
    operation?: FederatedOperationName;
  }): Promise<readonly SigningRequest[]>;
}

/** Default in-memory store. Suitable for unit tests + ephemeral servers. */
export class InMemorySigningCouncilRequestStore implements SigningCouncilRequestStore {
  private readonly byId = new Map<NonEmpty, SigningRequest>();

  async put(req: SigningRequest): Promise<void> {
    this.byId.set(req.requestId, req);
  }

  async get(requestId: NonEmpty): Promise<SigningRequest | null> {
    return this.byId.get(requestId) ?? null;
  }

  async list(filter?: {
    status?: SigningRequestStatusName;
    operation?: FederatedOperationName;
  }): Promise<readonly SigningRequest[]> {
    const all = Array.from(this.byId.values());
    return all.filter(r => {
      if (filter?.status && r.status !== filter.status) return false;
      if (filter?.operation && r.operation !== filter.operation) return false;
      return true;
    });
  }
}

export interface SigningCouncilDeps {
  readonly store: SigningCouncilRequestStore;
  readonly runLedger: RunLedgerWriter;
  /**
   * One dispatcher per operation. Patch 6 wires mode_unlock and
   * signing_council_change first; lexicon_mutation lands in Patch 8;
   * policy_bundle_replace lands in Patch 16.
   */
  readonly dispatchers: Partial<Record<FederatedOperationName, SigningCouncilDispatcher>>;
  /** Optional override for testing; defaults to nowIso() */
  readonly clock?: () => string;
}

export class SigningCouncil implements SigningCouncilPort {
  constructor(private readonly deps: SigningCouncilDeps) {}

  private now(): IsoTimestamp {
    return (this.deps.clock?.() ?? new Date().toISOString()) as IsoTimestamp;
  }

  async open(input: {
    operation: FederatedOperationName;
    payload: Record<string, unknown>;
    openedBy: NonEmpty;
    expiresInSeconds?: number;
  }): Promise<SigningRequest> {
    const operations = Object.values(FEDERATED_OPERATION) as readonly string[];
    if (!operations.includes(input.operation)) {
      throw new Error(`UNKNOWN_OPERATION: ${input.operation}`);
    }
    const requestId = randomUUID() as NonEmpty;
    const openedAt = this.now();
    const expiresAtMs =
      new Date(openedAt).getTime() + (input.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS) * 1000;
    const expiresAt = new Date(expiresAtMs).toISOString() as IsoTimestamp;
    const payloadDigest = sha256Hex(canonicalize(input.payload)) as Sha256Hex;
    const req: SigningRequest = {
      requestId,
      operation: input.operation,
      payload: input.payload,
      payloadDigest,
      openedAt,
      openedBy: input.openedBy,
      expiresAt,
      signatures: [],
      status: SIGNING_REQUEST_STATUS.PENDING,
    };
    await this.deps.store.put(req);
    await emitInfrastructureAuditEvent(
      'federated_operation_opened',
      {
        requestId,
        operation: input.operation,
        openedBy: input.openedBy,
        payloadDigest,
        expiresAt,
        threshold: getThreshold(input.operation as never),
      },
      this.deps.runLedger
    );
    return req;
  }

  async sign(
    requestId: NonEmpty,
    principalId: NonEmpty,
    signature: Base64Url
  ): Promise<SigningRequest> {
    const existing = await this.deps.store.get(requestId);
    if (!existing) throw Object.assign(new Error('REQUEST_NOT_FOUND'), { statusCode: 404 });
    if (existing.status !== SIGNING_REQUEST_STATUS.PENDING) {
      throw Object.assign(new Error(`REQUEST_NOT_PENDING: ${existing.status}`), {
        statusCode: 409,
      });
    }
    if (this.isExpired(existing)) {
      const expired: SigningRequest = {
        ...existing,
        status: SIGNING_REQUEST_STATUS.EXPIRED,
      };
      await this.deps.store.put(expired);
      await emitInfrastructureAuditEvent(
        'federated_operation_expired',
        { requestId: existing.requestId, operation: existing.operation },
        this.deps.runLedger
      );
      throw Object.assign(new Error('REQUEST_EXPIRED'), { statusCode: 410 });
    }
    if (existing.signatures.some(s => s.principalId === principalId)) {
      throw Object.assign(new Error('DUPLICATE_SIGNER'), { statusCode: 409 });
    }
    // Verify signature over canonicalized (payload + requestId + payloadDigest)
    // so a signature on one request cannot be replayed on another.
    const adminPub = await loadAdminPublicKey(principalId);
    if (!adminPub) {
      throw Object.assign(new Error(`UNKNOWN_ADMIN: ${principalId}`), { statusCode: 403 });
    }
    const signed = await verify(this.canonicalSigningEnvelope(existing), signature, adminPub);
    if (!signed) {
      throw Object.assign(new Error('INVALID_ADMIN_SIGNATURE'), { statusCode: 403 });
    }
    const updated: SigningRequest = {
      ...existing,
      signatures: [...existing.signatures, { principalId, signature, signedAt: this.now() }],
    };
    await this.deps.store.put(updated);
    await emitInfrastructureAuditEvent(
      'federated_operation_signature_added',
      {
        requestId: updated.requestId,
        operation: updated.operation,
        principalId,
        signaturesNow: updated.signatures.length,
        threshold: getThreshold(updated.operation as never),
      },
      this.deps.runLedger
    );
    if (updated.signatures.length >= getThreshold(updated.operation as never)) {
      return this.dispatch(updated);
    }
    return updated;
  }

  async get(requestId: NonEmpty): Promise<SigningRequest | null> {
    return this.deps.store.get(requestId);
  }

  async list(filter?: {
    status?: SigningRequestStatusName;
    operation?: FederatedOperationName;
  }): Promise<readonly SigningRequest[]> {
    return this.deps.store.list(filter);
  }

  /**
   * Canonical envelope that admins sign. requestId + payloadDigest +
   * operation are all included so signatures cannot be replayed across
   * requests (FED-07).
   */
  canonicalSigningEnvelope(req: SigningRequest): string {
    return canonicalize({
      requestId: req.requestId,
      operation: req.operation,
      payloadDigest: req.payloadDigest,
      openedAt: req.openedAt,
    });
  }

  private isExpired(req: SigningRequest): boolean {
    return new Date(req.expiresAt).getTime() < new Date(this.now()).getTime();
  }

  private async dispatch(req: SigningRequest): Promise<SigningRequest> {
    const disp = this.deps.dispatchers[req.operation];
    if (!disp) {
      const denied: SigningRequest = {
        ...req,
        status: SIGNING_REQUEST_STATUS.DENIED,
        denialReason: ('no_dispatcher_for_operation:' + req.operation) as NonEmpty,
      };
      await this.deps.store.put(denied);
      await emitInfrastructureAuditEvent(
        'federated_operation_dispatch_failed',
        {
          requestId: req.requestId,
          operation: req.operation,
          reason: denied.denialReason,
        },
        this.deps.runLedger
      );
      return denied;
    }
    try {
      await disp(req);
      const executed: SigningRequest = {
        ...req,
        status: SIGNING_REQUEST_STATUS.EXECUTED,
        dispatchedAt: this.now(),
      };
      await this.deps.store.put(executed);
      await emitInfrastructureAuditEvent(
        'federated_operation_executed',
        {
          requestId: executed.requestId,
          operation: executed.operation,
          signers: executed.signatures.map(s => s.principalId),
          payloadDigest: executed.payloadDigest,
        },
        this.deps.runLedger
      );
      return executed;
    } catch (err) {
      const reason = ((err as Error).message || 'dispatcher_failed') as NonEmpty;
      const denied: SigningRequest = {
        ...req,
        status: SIGNING_REQUEST_STATUS.DENIED,
        denialReason: reason,
      };
      await this.deps.store.put(denied);
      await emitInfrastructureAuditEvent(
        'federated_operation_dispatch_failed',
        { requestId: req.requestId, operation: req.operation, reason },
        this.deps.runLedger
      );
      return denied;
    }
  }
}

function sha256Hex(payload: string): string {
  return createHash('sha256').update(new TextEncoder().encode(payload)).digest('hex');
}

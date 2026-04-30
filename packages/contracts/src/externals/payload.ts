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

import type { Uuid, NonEmpty, Sha256Hex } from '../types/index.js';

/**
 * Resolves a resultRef to its raw bytes for digest verification.
 * Multiple resolvers may be registered; canResolve selects the appropriate one.
 */
export interface PayloadResolver {
  readonly resolverId: NonEmpty;
  readonly resolverVersion: NonEmpty;
  canResolve(resultRef: NonEmpty): boolean;
  resolveBytes(resultRef: NonEmpty): Promise<Uint8Array>;
}

/**
 * Writes payload bytes and returns the assigned resultRef + resultDigest.
 * Used by output adapters to persist payloads before mailbox write.
 */
export interface PayloadStore {
  readonly storeId: NonEmpty;
  readonly storeVersion: NonEmpty;
  write(
    runId: Uuid,
    bytes: Uint8Array,
    hint: NonEmpty
  ): Promise<{ resultRef: NonEmpty; resultDigest: Sha256Hex }>;
  read(resultRef: NonEmpty): Promise<Uint8Array>;
}

# AMEND — Nexus Admin: Multi-Admin Signing Key Federation

**Version:** v0.1.0
**Status:** RATIFIED (outline-aligned, body-first; lexicon_mutation as first-class V1 operation)
**Date:** 2026-05-19
**Owner:** James Huson / Lake Area LLC
**Author:** Claude (dangerous-mode spec rework session)
**Base commit:** 3ae197d
**Outline pin:** docs/alignment/nexus-component-outline-v0-1-0.md §3 K, §3 S, §4 S, Hard Law #10
**Audit packet:** runs/alignment-spec-rework-2026-05-19/audit-input/ (Turn 1 P0-004, Turn 5 P0-043)

---

## §0 Disposition

This spec establishes a **SigningCouncil** that aggregates two-or-more distinct admin signatures for governance-significant mutations, and lists `lexicon_mutation` as a first-class V1 operation alongside `mode_unlock`, `policy_bundle_replace`, and `signing_council_change`. The prior pattern of treating `lexicon_mutation` as an addendum was wrong; it belongs in the operation union, threshold map, migration sequence, executor, routes, UI, and test plan.

**Why first-class:** outline §3 S explicitly says lexicon mutations require two distinct admin signatures; outline §3 E says double-admin signing is required for every lexicon mutation; outline §3 K says admin dashboard owns lexicon mutation writers. Spec lineage that omits `lexicon_mutation` from the federation surface lets builders ship federation while lexicon stays unsigned.

**Hard Laws this spec enforces:**
- **#10** Every signed envelope (mode change, approval response, compile artifact, delegation, template ingestion, lexicon mutation) is Ed25519-signed by an admin-registered key; every gate outcome to ledger; every failure path fail-closed.
- **#13** Default-secure — no operation is allowed without the required signature threshold.

**Q-rulings applied:**
- **Q4** lexicon_mutation threshold STRICT 2 in V1; above 2 only via owner-ratified V2.
- **Q3** BAKED enforcement — the SigningCouncil sits in the baked layer (Mode + Signing per outline §2); plug-in admin-writer rejects malformed envelopes as defense in depth.

**Audit findings closed:** P0-004 (Turn 1 — federation spec adds lexicon_mutation in addendum but omits from migration/tests), P0-043 (Turn 5 — same defect from spec-rewrite lens).

---

## §1 Scope

In scope (V1):
- `SigningCouncil` baked service that aggregates admin signatures for federated operations.
- `lexicon_mutation` operation as first-class member of the operation union.
- Threshold map keyed by operation type.
- Pending request queue with stale/replay rejection.
- Executor that dispatches to the right downstream service (mode-manager, policy-bundle-writer, lexicon-writer, signing-council-config-writer).
- Admin dashboard surfaces: pending queue, sign action, history.
- Run ledger events for request open / signature added / threshold met / executed / denied / expired.
- CI gates per §6.

Out of scope:
- M-of-N variable-threshold UI for non-governance approvals (separate approval-channels work; see Spec 1).
- Hardware-token signing (V2).
- Quorum signing across organizational boundaries (V2).

---

## §2 Contract types

### §2.1 `FederatedOperation` (operation union, V1)

```ts
type FederatedOperation =
  | 'mode_unlock'              // unlock enforcing-lock (see Spec F4.17)
  | 'policy_bundle_replace'    // swap signed policy bundle (Spec F4.2)
  | 'signing_council_change'   // add/remove admin signing key
  | 'lexicon_mutation';        // entity/edge/confidence/arena change (Spec F4.8 Phase 1)
```

`lexicon_mutation` is NOT optional. NOT addendum. NOT future. Listed in the same union as `mode_unlock`.

### §2.2 Threshold map (V1)

| Operation                  | Threshold (distinct admin signatures) | Notes |
|----------------------------|---------------------------------------|-------|
| mode_unlock                | 2                                     | overrides any single-admin dashboard path (Spec F4.17) |
| policy_bundle_replace      | 2                                     | OCT axis mandatory per Spec F4.2 |
| signing_council_change     | 2                                     | adding/removing admin keys |
| lexicon_mutation           | **2 (strict, Q4)**                    | below 2 forbidden; above 2 only via V2 amendment |

Implementation: `getThreshold(op: FederatedOperation): 2`. The map is a literal type so accidental drift compile-errors.

### §2.3 `SigningRequest`

```ts
interface SigningRequest {
  readonly requestId: SigningRequestId;     // ULID
  readonly operation: FederatedOperation;
  readonly payload: SignedOperationPayload; // discriminated by operation
  readonly openedAt: RunSequence;
  readonly openedBy: PrincipalId;            // initiator (counts toward threshold only if also signs)
  readonly expiresAt: WallClockISO;          // V1 default: 24h from open
  readonly signatures: ReadonlyArray<{
    readonly principalId: PrincipalId;
    readonly signature: Ed25519Signature;
    readonly signedAt: RunSequence;
  }>;
  readonly status: 'pending' | 'executed' | 'denied' | 'expired';
}
```

**Forbidden:** same `principalId` counted twice; signatures past `expiresAt`; payload mutation after open (any payload edit forces a new requestId).

### §2.4 `SigningCouncilPort` (baked)

```ts
interface SigningCouncilPort {
  open(op: FederatedOperation, payload: SignedOperationPayload, opener: PrincipalId): Promise<SigningRequestId>;
  sign(requestId: SigningRequestId, principalId: PrincipalId, sig: Ed25519Signature): Promise<SigningRequest>;
  list(filter?: { status?: SigningRequest['status']; operation?: FederatedOperation }): Promise<readonly SigningRequest[]>;
  get(requestId: SigningRequestId): Promise<SigningRequest | null>;
}
```

When `signatures.length >= getThreshold(operation)` AND all signatures are from distinct registered admin keys AND not expired → executor dispatches the operation, writes ledger event `federated_operation_executed`, and marks request `executed`.

---

## §3 Runtime behavior

### §3.1 Open

Admin posts `POST /workspace/admin/signing/requests` with `{ operation, payload }`. Server signs the request opener envelope, persists, emits `federated_operation_opened`. Returns `requestId`.

### §3.2 Sign

Other admin posts `POST /workspace/admin/signing/requests/:id/signatures` with `{ signature }`. Server verifies:
- Request exists, status=pending, not expired.
- `principalId` from auth session is registered admin AND not already in signatures.
- Signature verifies over canonicalized payload using principal's registered Ed25519 public key.

On valid sign: append to `signatures`, emit `federated_operation_signature_added`, check threshold.

### §3.3 Threshold met → dispatch

When `signatures.length >= getThreshold(op)`:
1. Executor calls operation-specific dispatcher:
   - `mode_unlock` → `modeManager.unlockEnforcing(signatures)`
   - `policy_bundle_replace` → `policyBundleWriter.replace(payload, signatures)`
   - `signing_council_change` → `signingCouncilConfigWriter.apply(payload, signatures)`
   - `lexicon_mutation` → `lexiconWriter.applyMutation(payload, signatures)` (Phase 1: JSONL append; Phase 2: SQLite — see Spec F4.8)
2. On success: mark `executed`, emit `federated_operation_executed` with full signature chain.
3. On dispatcher failure: mark `denied`, emit `federated_operation_dispatch_failed` with reason; do NOT mutate target.

### §3.4 Expiry

Background job (or per-request check) marks `expired` after `expiresAt`. Emits `federated_operation_expired`. No dispatch.

### §3.5 Three-mode behavior

| Mode      | Gate behavior                                                                           | Run continues? | Ledger writes? |
|-----------|-----------------------------------------------------------------------------------------|----------------|----------------|
| observe   | open/sign succeed; dispatch logs `would_execute_federated_operation` but does not mutate target | yes            | always         |
| advisory  | open/sign succeed; dispatch executes + emits warning if any signer is recently-rotated  | yes            | always         |
| enforcing | open/sign/dispatch all enforced; below-threshold or duplicate-signer or expired rejected | no on fail     | always         |

### §3.6 BAKED vs plug-in

- **BAKED (floor):** `SigningCouncilPort` impl, threshold map, signature verification, ledger writes.
- **PLUG-IN (defense in depth):** admin dashboard UI panels (presentation), admin-writer HTTP routes (input validation rejects malformed payloads, duplicate-signer pre-check). A customer-supplied admin UI that omitted these defenses would still fail at the baked layer.

---

## §4 Admin dashboard surfaces

- **Pending requests panel**: lists `status=pending` requests with operation type, opener, signatures-so-far / threshold, time-remaining.
- **Sign action**: per-request, "Sign as me" button — server-side signing per `feedback_signing_keys_server_side.md`.
- **History panel**: `status in (executed, denied, expired)`; filter by operation.
- **Lexicon mutation queue**: a filtered view (`operation=lexicon_mutation`) embedded in the Lexicon Admin UI (Spec F4.8).

---

## §5 Implementation sequence

1. Add `FederatedOperation` type + threshold map to `packages/contracts/src/constants/`.
2. Add `SigningRequest` + `SignedOperationPayload` discriminated types.
3. Add `SigningCouncilPort` interface in contracts.
4. Implement baked `SigningCouncil` service in `packages/core/src/signing/`.
5. Implement operation dispatchers (one per operation type), each calling the existing downstream writer.
6. Wire admin-writer HTTP routes (`POST /signing/requests`, `POST /signing/requests/:id/signatures`, `GET /signing/requests`).
7. Wire admin dashboard panels.
8. Add ledger event types to `packages/contracts/src/run-ledger/events.ts`.
9. CI gates per §6.

**Phase order:** mode_unlock + signing_council_change land first (these are infra). policy_bundle_replace and lexicon_mutation follow with full UI + tests. lexicon_mutation MUST land before lexicon-admin V1 declares done.

---

## §6 Tests (acceptance gates)

| Gate | Purpose | Type |
|---|---|---|
| FED-01 | `getThreshold('lexicon_mutation')` returns 2 (literal type compile-checks below-2 paths) | Unit |
| FED-02 | Open request with one signature → status=pending, dispatch not called | Unit |
| FED-03 | Open + 2 distinct signatures → status=executed, dispatcher called once | Unit |
| FED-04 | Same principalId signing twice → second sign rejected (409), signatures length stays 1 | Integration |
| FED-05 | Signature from unregistered admin key → rejected (403) | Integration |
| FED-06 | Signature past `expiresAt` → rejected (410), request marked expired | Integration |
| FED-07 | Stale/replayed signature on a different requestId → rejected (signature verifies over canonicalized payload + requestId) | Integration |
| FED-08 | `operation=lexicon_mutation` with 2 distinct signatures → `lexiconWriter.applyMutation` called once with both signatures | Integration |
| FED-09 | Dispatcher throws → request marked denied, target unchanged, ledger event `federated_operation_dispatch_failed` | Integration |
| FED-10 | observe mode: dispatch logs `would_execute_federated_operation`, target unchanged | Integration |
| FED-11 | enforcing mode: below threshold dispatch attempt returns 409, no ledger `executed` event | Integration |
| FED-12 | Admin dashboard pending list filters by operation type including `lexicon_mutation` | UI |

**CI static gates (added to scripts/ci-gate.ts under GOV-* suite — see Spec F4.19):**
- `GOV-14 lexicon-mutation double-admin` — searches contracts/core for the `lexicon_mutation` operation literal and verifies threshold=2.
- Static ban on any code path that calls `lexiconWriter.applyMutation` with fewer than 2 signatures.

---

## §7 Backwards compatibility

There is no compatible-with state at 3ae197d (no SigningCouncil exists). This is a clean V1 build. The existing single-admin mode-unlock dashboard path (P0-023, P0-034) is forbidden by Spec F4.17; that spec removes the `minRequired=1` path so this spec's SigningCouncil is the only legal route.

---

## §8 Audit closure mapping

| Finding | How closed in this spec |
|---|---|
| P0-004 | `lexicon_mutation` in §2.1 union, §2.2 threshold map, §5 implementation sequence, §6 test plan FED-08/-11/-12 |
| P0-043 | Same; rewritten in body, not addendum |

---

*End of v0.1.0.*

# AMEND — Nexus Admin Signed Mutation Envelopes

**Version:** v0.1.0
**Status:** RATIFIED (per-mutation admin signature + mandatory ledger; best-effort audit retired)
**Date:** 2026-05-19
**Owner:** James Huson / Lake Area LLC
**Author:** Claude (dangerous-mode spec rework session)
**Base commit:** 3ae197d
**Outline pin:** docs/alignment/nexus-component-outline-v0-1-0.md §3 K Admin Dashboard, §3 S Signing Keys, §4 P Run Ledger, Hard Law #10
**Audit packet:** Turn 3 P0-022, P0-024, Turn 4 P0-033

---

## §0 Disposition

Per Hard Law #10, every signed envelope is Ed25519-signed by an admin-registered key, every gate outcome goes to ledger, and every failure path is fail-closed. The repo today has many admin setup writers (`packages/interfaces/api/src/routes/admin-writer.ts`) that mutate signed manifests with admin auth + control-plane re-signing but WITHOUT per-mutation admin signatures and WITHOUT mandatory audit. The secret lifecycle is explicitly best-effort-audited, comments stating "ledger failure must not roll back" (P0-024).

This spec retires that best-effort posture: every governance-relevant admin mutation requires (a) a per-mutation Ed25519 admin signature in the request, (b) a mandatory pre-mutation infra Run Ledger event, and (c) fail-closed behavior when the ledger writer is unavailable.

**Hard Laws this spec preserves:**
- **#10** Every signed envelope + every gate outcome + fail-closed.
- **#13** Default-secure — no mutation without verifiable admin attribution + audit trail.

**Q-rulings applied:**
- **Q3** BAKED enforcement — admin-writer is plug-in surface but the signed envelope verifier + ledger writer are baked.
- **Q5** Plug-ins never kill — plug-in admin-writer never silent-fails; if ledger is unavailable, it returns 503 to the operator.

**Audit findings closed:** P0-022, P0-024 (Turn 3), P0-033 (Turn 4).

---

## §1 Scope

In scope (V1):
- `SignedAdminMutation` envelope on every admin-writer mutation route.
- Pre-mutation infra Run Ledger event (`admin_mutation_intent`).
- Post-mutation infra Run Ledger event (`admin_mutation_committed` / `admin_mutation_failed`).
- Transactional rollback on audit failure (or refuse mutation if non-transactional storage).
- CI gates per Spec F4.19.

Out of scope:
- SigningCouncil federation operations (Spec F4.1) — distinct: those are 2-of-2 governance-mutation; this spec is the single-admin baseline for non-federated routine writes.
- Hardware token signing (V2).

---

## §2 Contract types

### §2.1 `SignedAdminMutation`

```ts
interface SignedAdminMutation<TPayload> {
  readonly payload: TPayload;
  readonly mutationKind: AdminMutationKind;     // discriminator for canonical comparison
  readonly opener: PrincipalId;
  readonly issuedAt: WallClockISO;
  readonly nonce: Nonce;
  readonly signature: Ed25519Signature;          // over canonical(mutationKind + payload + opener + issuedAt + nonce)
}

type AdminMutationKind =
  | 'actor_register'
  | 'actor_deregister'
  | 'agent_config_update'
  | 'llm_config_update'
  | 'identity_provider_update'
  | 'connector_register'
  | 'connector_deregister'
  | 'secret_store'
  | 'secret_remove'
  | 'webhook_register'
  | 'webhook_deregister'
  | 'workspace_config_update'
  | 'orchestrator_config_update'
  | 'compile_config_update'
  | 'mailbox_config_update'
  | 'manifest_entry_add'
  | 'manifest_entry_update'
  | 'manifest_entry_remove'
  // ...as the admin surface grows
  ;
```

Every admin-writer mutation route requires the request body to be a `SignedAdminMutation<...>`. Server verifies signature over canonical form using the opener's registered admin Ed25519 public key.

### §2.2 Infra Run Ledger events

```ts
interface AdminMutationIntentEvent {
  readonly eventType: 'admin_mutation_intent';
  readonly mutationKind: AdminMutationKind;
  readonly mutationId: AdminMutationId;          // ULID
  readonly opener: PrincipalId;
  readonly payloadDigest: HexDigest;
  readonly signatureRef: SignatureRef;
  readonly emittedAt: RunSequence;               // governed infra-run-id namespace
}

interface AdminMutationCommittedEvent {
  readonly eventType: 'admin_mutation_committed';
  readonly mutationId: AdminMutationId;
  readonly resultRef: MutationResultRef;
  readonly emittedAt: RunSequence;
}

interface AdminMutationFailedEvent {
  readonly eventType: 'admin_mutation_failed';
  readonly mutationId: AdminMutationId;
  readonly reason: string;
  readonly errorRef?: ErrorRef;
  readonly emittedAt: RunSequence;
}
```

---

## §3 Runtime behavior

### §3.1 Pre-flight (every admin mutation route)

1. Auth: verify session, elevated admin claim.
2. Parse `SignedAdminMutation<TPayload>`; verify signature; reject 400 on malformed.
3. Verify nonce not seen (replay protection); reject 409 on replay.
4. **Verify `runLedgerWriter` is available; if not, return 503 immediately** — do NOT proceed with mutation.
5. Emit `admin_mutation_intent` ledger event with payload digest + signature ref. If write fails → return 503.

### §3.2 Mutation

1. Apply mutation via downstream writer (manifest, actor registry, secret store, etc.).
2. On success: emit `admin_mutation_committed`. If event write fails → either transactional rollback (if storage supports) OR set mutation status `committed_but_audit_failed` and return 207 with explicit failure; per Q5 / Hard Law #10 the default is to refuse the mutation if ledger is non-transactional, with operator instructed to retry after ledger is healthy.
3. On mutation failure: emit `admin_mutation_failed`; return 500 with reason.

### §3.3 No silent no-op

Code paths that look like:

```ts
if (!deps.runLedgerWriter) return;  // FORBIDDEN
```

are retired. The mutation cannot proceed without a ledger writer. The plug-in admin-writer fail-closes upward.

### §3.4 Secret lifecycle (P0-024 fix)

Secret store/remove follows the same pattern:
- Pre-flight (above) → emit `admin_mutation_intent` with secret kind + key id (NEVER the value).
- Mutation → store/remove the secret.
- Post → emit `admin_mutation_committed`. If ledger writer fails post-mutation:
  - Transactional storage: rollback the secret change.
  - Non-transactional storage: return 207 + operator alert + DO NOT mark as completed; secret is in `committed_but_audit_failed` state requiring operator remediation.
- The "best-effort audit" comments + code paths (P0-024) are explicitly retired.

### §3.5 Three-mode behavior

| Mode      | Gate behavior                                                                                       | Run continues? | Ledger writes? |
|-----------|-----------------------------------------------------------------------------------------------------|----------------|----------------|
| observe   | signature verified; ledger writes "would_commit_*" + intent; mutation NOT applied                   | n/a            | always         |
| advisory  | signature verified; ledger writes; mutation applied + warning to operator                           | n/a            | always         |
| enforcing | signature verified; ledger writes mandatory; mutation applied; on ledger failure → fail closed     | n/a            | always         |

### §3.6 BAKED vs plug-in

- **BAKED (floor):** envelope signature verifier; canonical comparison; Run Ledger writer; the `committed_but_audit_failed` operational state.
- **PLUG-IN (defense in depth):** admin-writer route handlers; dashboard UI showing signing modal; per-mutation form validation.

---

## §4 Admin dashboard surfaces

- Mutation form modal: shows canonical payload preview before signing; explicit "Sign and apply" action that triggers server-side signing.
- Per-route "audit status" indicator (last `admin_mutation_committed` timestamp).
- `committed_but_audit_failed` banner with remediation instructions.

---

## §5 Implementation sequence

1. Add `SignedAdminMutation` + `AdminMutationKind` to contracts.
2. Add infra ledger event types.
3. Refactor every admin-writer route to require `SignedAdminMutation` body.
4. Remove `if (!deps.runLedgerWriter) return;` / silent-no-op paths.
5. Update `tests/api/admin-writer.test.ts` to INVERT the best-effort audit assertions per P0-033 (delete the test that says "secret writes proceed despite audit failure"; add tests proving fail-closed).
6. CI gates per Spec F4.19 (`GOV-08 signed admin mutation envelope`, `GOV-10 credential lifecycle fail-closed`).
7. Tests per §6.

---

## §6 Tests (acceptance gates)

| Gate | Purpose | Type |
|---|---|---|
| SAM-01 | POST mutation without `SignedAdminMutation` → 400 | Integration |
| SAM-02 | POST with signature from non-admin key → 403 | Integration |
| SAM-03 | POST with replayed nonce → 409; no mutation | Integration |
| SAM-04 | POST with valid envelope + ledger writer unavailable → 503; no mutation | Integration |
| SAM-05 | POST with valid envelope → `admin_mutation_intent` written before mutation; `admin_mutation_committed` after success | Integration |
| SAM-06 | Mutation succeeds but post-commit ledger write fails (transactional storage) → rollback; `admin_mutation_failed` written | Integration |
| SAM-07 | Mutation succeeds but post-commit ledger write fails (non-transactional storage) → state `committed_but_audit_failed`; 207; operator alert | Integration |
| SAM-08 | Secret store without `runLedgerWriter` → 503; secret not stored (inverts P0-033 test) | Integration |
| SAM-09 | Secret store with throwing ledger → no committed secret OR rollback per storage class; never silent success | Integration |
| SAM-10 | observe mode: signature verified, intent logged with `would_commit_*`; mutation not applied | Integration |
| SAM-11 | Static gate detects `if (!deps.runLedgerWriter) return` pattern → CI fails | Static |

**CI static gates (Spec F4.19):**
- `GOV-08 signed admin mutation envelope` — verifies every admin-writer route requires `SignedAdminMutation`.
- `GOV-10 credential lifecycle fail-closed` — bans silent-no-op patterns in secret/admin-mutation paths.

---

## §7 Audit closure mapping

| Finding | How closed |
|---|---|
| P0-022 | Per-mutation `SignedAdminMutation` envelope; pre/post ledger events mandatory; tests SAM-01/-02/-05 |
| P0-024 | Secret lifecycle fail-closed; rollback or `committed_but_audit_failed` state; tests SAM-08/-09 |
| P0-033 | Inverts admin-writer test asserting best-effort audit; replaces with fail-closed tests |

---

*End of v0.1.0.*

# AMEND — Nexus Admin: OCT Level UI

**Version:** v0.1.0
**Status:** RATIFIED (Q2 registration-only auth gate; no runtime OCT mutation)
**Date:** 2026-05-19
**Owner:** James Huson / Lake Area LLC
**Author:** Claude (dangerous-mode spec rework session)
**Base commit:** 3ae197d
**Outline pin:** docs/alignment/nexus-component-outline-v0-1-0.md §4 O Identity/OCT/Delegation, §3 K Admin Dashboard, Hard Laws #10/#13/#15
**Audit packet:** Turn 1 P0-001, Turn 5 P0-040

---

## §0 Disposition

Per Q2, **registration is the only auth gate**. An actor's OCT classification is set at registration via a signed envelope and cannot be mutated at runtime. The outline's "OCT cannot be lowered at runtime; can be raised by signed policy" rule is operationalized here: raising is allowed via signed `assignOct` post-registration, but lowering is forbidden — to lower, the operator must **deregister-then-register-new** at the new ceiling. Two ledger events (`actor_deregistered`, `actor_registered`) preserve continuity.

**Q2 ruling (verbatim):** REGISTRATION IS THE AUTH GATE. Agents sit inert in the registry bucket; they are not auth'd until prompt or autonomous trigger; on trigger they are auth'd under the human's authority for that specific run. Evidence chain records (human, agent, llm, permissions = lesser-of-three) per Hard Law #15. There is NO "OCT change at runtime" — it is deregister-then-register-new at a new ceiling.

**Companion spec:** F4.16 strips `octLevel` from the generic actor update schema, removing the bypass path (P0-008, P0-035) so this OCT UI is the only lawful mutation surface.

**Hard Laws this spec preserves:**
- **#10** Every signed envelope (OCT assignment) is Ed25519-signed by an admin-registered key; ledger-logged; fail-closed.
- **#13** Default-secure — OCT cannot be implicitly raised or laundered through actor edit.
- **#15** Run effective permissions = symmetric intersection of (human, agent, LLM); OCT is one dimension of that intersection.

**Q-rulings applied:** Q2 (above) + Q3 BAKED-first (NXS Gate 02 reads OCT from identityClaims; OCT manager is in baked layer) + Q5 plug-ins never kill (admin UI suggests, the baked OCT manager enforces).

**Audit findings closed:** P0-001 (Turn 1), P0-040 (Turn 5).

---

## §1 Scope

In scope (V1):
- OCT-level dropdown in admin actor-registration form (initial only, signed).
- Signed OCT-raise endpoint (`POST /workspace/admin/oct/assign`) using `assignOct` baked manager.
- Bulk OCT-raise UI (signed envelope per assignment, all-or-nothing transaction).
- Deregister-then-register-new flow for lowering (two operations, distinct envelopes).
- Read-only display of current OCT on actor detail (no inline edit).
- Run ledger events for every OCT operation.
- CI gates per §6.

Out of scope:
- Break-glass OCT lower (V2; requires SigningCouncil 2-of-2 + owner ratification).
- OCT auto-rotation by schedule (V2).
- Cross-tenant OCT visibility (V2).

---

## §2 Contract types

### §2.1 `OctLevel` (outline §4 O)

```ts
type OctLevel = 'OCT_OPEN' | 'OCT_INTERNAL' | 'OCT_CONFIDENTIAL' | 'OCT_SECURE';

const OCT_RANK: Record<OctLevel, number> = {
  OCT_OPEN: 0,
  OCT_INTERNAL: 1,
  OCT_CONFIDENTIAL: 2,
  OCT_SECURE: 3,
};
```

Raising = strictly higher rank. Lowering = strictly lower rank. Equal = no-op (treated as invalid request).

### §2.2 `SignedOctAssignmentRequest`

```ts
interface SignedOctAssignmentRequest {
  readonly actorId: ActorId;
  readonly previousOctLevel: OctLevel;       // expected current value (optimistic concurrency)
  readonly newOctLevel: OctLevel;             // must be strictly higher rank than previousOctLevel
  readonly assignedBy: PrincipalId;           // admin principal initiating
  readonly issuedAt: WallClockISO;
  readonly nonce: Nonce;                       // replay protection
  readonly signature: Ed25519Signature;
}
```

Server-side signing per `feedback_signing_keys_server_side.md`; browser never holds the private key.

### §2.3 `OctManagerPort` (baked)

```ts
interface OctManagerPort {
  /** Initial OCT assignment at registration; emits actor_registered with OCT. */
  registerActor(req: SignedActorRegistrationRequest): Promise<ActorId>;

  /** Raise OCT. Validates strictly-higher rank, fails closed on mismatch/replay/downward. */
  assignOct(req: SignedOctAssignmentRequest): Promise<ActorRecord>;

  /** Deregister actor; emits actor_deregistered. Required for "lowering" path. */
  deregisterActor(req: SignedActorDeregistrationRequest): Promise<void>;
}
```

`OctManagerPort.assignOct` MUST reject any request where `OCT_RANK[newOctLevel] <= OCT_RANK[previousOctLevel]`. Reject also if `previousOctLevel` does not match the current persisted value (optimistic concurrency catches stale UI).

---

## §3 Runtime behavior

### §3.1 Initial registration (only OCT-write surface for new actors)

1. Admin dashboard form: actor metadata + OCT-level dropdown (default OCT_OPEN).
2. Submit → server signs `SignedActorRegistrationRequest` → `OctManagerPort.registerActor(req)`.
3. Baked layer validates signature, persists, emits `actor_registered` ledger event with `(actorId, octLevel, registeredBy, signatureRef)`.

### §3.2 Raise (signed assign-OCT, post-registration)

1. Admin opens actor detail, clicks "Raise OCT" (button visible only when actor is at OCT_OPEN/INTERNAL/CONFIDENTIAL).
2. Form: select target OCT (only higher options enabled).
3. Submit → server signs `SignedOctAssignmentRequest` → `OctManagerPort.assignOct(req)`.
4. Baked validates strictly-higher rank, signature, nonce, previousOctLevel match.
5. On success: persist, emit `oct_raised` ledger event with full envelope reference.
6. On rank mismatch / signature failure / nonce replay: emit `oct_assignment_rejected`, deny with reason; no mutation.

### §3.3 Lower = deregister-then-register-new

1. Admin opens actor detail, clicks "Lower OCT (requires deregister + re-register)".
2. UI walks operator through:
   - Step A: confirm deregistration (warns of evidence-chain effect for any in-flight runs).
   - Step B: deregister via signed `SignedActorDeregistrationRequest` → `OctManagerPort.deregisterActor(req)`.
   - Emits `actor_deregistered` ledger event.
   - Step C: open re-registration form with metadata pre-populated; operator confirms new (lower) OCT level.
   - Step D: register via `OctManagerPort.registerActor(req)`.
   - Emits `actor_registered` ledger event.
3. The two ledger events (`actor_deregistered`, `actor_registered`) provide continuity for audit reconstruction of evidence chains.

Per Q2: there is no "downward OCT update" path. Lowering is structurally a different operation.

### §3.4 Bulk raise

UI table allows operator to select multiple actors and raise each to a chosen target. Server signs one `SignedOctAssignmentRequest` per actor. The flow is **all-or-nothing**: if any one request fails validation (mixed direction, signature error, stale `previousOctLevel`), the entire batch is rejected and no actor is mutated. Emits `oct_bulk_raise_attempted` + per-actor results + `oct_bulk_rejected` or `oct_bulk_completed`.

### §3.5 Mixed-direction bulk = fail closed

If the bulk batch contains any pair `(actorA: lower target than current)` plus `(actorB: higher target)`, the entire batch is rejected at the plug-in UI layer with `oct_bulk_mixed_direction_rejected`. The baked layer also rejects each individual downward request, so even if a malicious UI bypassed the batch check the baked enforcement holds.

### §3.6 Three-mode behavior

| Mode      | Gate behavior                                                                 | Run continues? | Ledger writes? |
|-----------|-------------------------------------------------------------------------------|----------------|----------------|
| observe   | OCT assignments evaluated; on downward/mismatch, log `would_reject_oct`; no mutation either way | yes        | always         |
| advisory  | OCT raise succeeds + workspace warning if recent rotation pattern detected    | yes            | always         |
| enforcing | OCT raise enforced; downward/mismatch fails closed; bulk fails closed         | n/a (admin op, not run-time) | always |

### §3.7 BAKED vs plug-in

- **BAKED (floor):** `OctManagerPort` impl in `packages/core/src/identity/oct-manager.ts`; signature verification; strict-higher rank check; ledger writes; OCT visibility in `IdentityClaims` consumed by Gate 02.
- **PLUG-IN (defense in depth):** admin dashboard form (UI rejects downward selection); admin-writer route (server pre-rejects malformed payload); bulk batch UI (pre-rejects mixed direction).

---

## §4 Admin dashboard surfaces

- **Actor detail panel** — OCT displayed as a read-only badge. "Raise OCT" button (enabled when not at max). "Lower OCT (deregister)" button (always visible; warns).
- **Actor registration form** — OCT dropdown required at creation.
- **Bulk raise panel** — table of actors with current/target OCT; "Apply" button.
- **OCT history view** — per-actor ledger view of OCT events (`actor_registered`, `oct_raised`, `actor_deregistered`).

---

## §5 Implementation sequence

1. Add `OCT_RANK` map + `SignedOctAssignmentRequest` / `SignedActorRegistrationRequest` / `SignedActorDeregistrationRequest` to `packages/contracts/`.
2. Implement baked `OctManagerPort` with strict-higher enforcement and signature verification.
3. Wire admin-writer routes (`/workspace/admin/oct/assign`, `/workspace/admin/actors/register`, `/workspace/admin/actors/deregister`).
4. Wire admin dashboard panels.
5. Coordinate with Spec F4.16 — strip `octLevel` from generic actor update schema in the same arc.
6. Add ledger event types.
7. Tests + CI gates per §6.

---

## §6 Tests (acceptance gates)

| Gate | Purpose | Type |
|---|---|---|
| OCT-UI-01 | Initial registration with OCT_CONFIDENTIAL succeeds via signed envelope | Integration |
| OCT-UI-02 | Raise OCT_OPEN → OCT_INTERNAL via signed assign → success | Integration |
| OCT-UI-03 | Attempt lower OCT_SECURE → OCT_OPEN via assignOct → rejected with `oct_assignment_rejected` (downward) | Integration |
| OCT-UI-04 | Attempt same-level OCT_INTERNAL → OCT_INTERNAL → rejected (no-op) | Integration |
| OCT-UI-05 | Stale `previousOctLevel` (concurrent change happened) → rejected | Integration |
| OCT-UI-06 | Replay attack (same nonce) → rejected | Integration |
| OCT-UI-07 | Signature from non-admin key → rejected | Integration |
| OCT-UI-08 | Lower via deregister + register-new flow → two ledger events `actor_deregistered` + `actor_registered` | Integration |
| OCT-UI-09 | Bulk raise with all-valid set → all assignments applied; ledger reflects all | Integration |
| OCT-UI-10 | Bulk raise containing one downward target → entire batch rejected; no actor mutated | Integration |
| OCT-UI-11 | Bulk raise containing one stale `previousOctLevel` → entire batch rejected | Integration |
| OCT-UI-12 | observe mode: downward request logs `would_reject_oct`, no mutation | Integration |
| OCT-UI-13 | Generic actor update payload containing `octLevel` → rejected (Spec F4.16) | Integration |

**CI static gates (Spec F4.19):**
- `GOV-12 OCT mutation single lawful path` — verifies `assignOct` is only called with `OCT_RANK[new] > OCT_RANK[previous]`; verifies generic actor update schema does not accept `octLevel`.

---

## §7 Open questions deferred to V2

- Break-glass OCT lower via SigningCouncil 2-of-2 — owner ratifies separately.
- OCT delegation chains (e.g., raise valid only within delegation window) — V2 if needed.

---

## §8 Audit closure mapping

| Finding | How closed |
|---|---|
| P0-001 | OCT raise mandatory-signed; downward forbidden at runtime; lower = deregister-re-register; mixed bulk fails closed; tests OCT-UI-02/-03/-08/-10 |
| P0-040 | Body rewrites the "unsigned default V1" framing; signed is the only path; no addendum-vs-body contradiction |

---

*End of v0.1.0.*

# AMEND — Nexus Enforcing-Lock Multi-Admin Unlock

**Version:** v0.1.0
**Status:** RATIFIED (remove minRequired=1 dashboard override; SigningCouncil 2-of-2 is only path)
**Date:** 2026-05-19
**Owner:** James Huson / Lake Area LLC
**Author:** Claude (dangerous-mode spec rework session)
**Base commit:** 3ae197d
**Outline pin:** docs/alignment/nexus-component-outline-v0-1-0.md §4 Q Mode + Mode Signing, §3 K Admin, Hard Law #10
**Audit packet:** Turn 3 P0-023, Turn 4 P0-034
**Companion spec:** AMEND-nexus-admin-multi-admin-signing-federation-v0-1-0.md (F4.1)

---

## §0 Disposition

`packages/core/src/modes/mode-manager.ts:131-142` defaults `disableEnforcingLock.minRequired` to 2, but `packages/interfaces/cli/src/commands/serve.ts:251-278` overrides it to 1 for dashboard unlock, and `packages/interfaces/api/src/routes/admin-writer.ts:1986-2011` exposes `/mode/unlock` with only the authenticated admin signing key (P0-023, P0-034). One admin can lower the enforcement safety rail; the multi-party invariant exists in core but a plug-in path bypasses it.

This spec removes the `minRequired=1` override path entirely. The only legitimate enforcing-lock unlock is via SigningCouncil 2-of-2 with `operation='mode_unlock'` (Spec F4.1). Comments + docstrings stating "Single-admin unlock of enforcing-lock from the dashboard" are retired.

**Hard Laws this spec enforces:**
- **#10** Every signed envelope is Ed25519-signed by an admin-registered key; ledger-logged; fail-closed.
- **#13** Default-secure — enforcing lock cannot be removed without explicit multi-party signed evidence.

**Q-rulings applied:**
- **Q3** BAKED enforcement — `modeManager.unlockEnforcing` is baked; plug-in admin-writer route is defense-in-depth that rejects single-admin payloads.
- **Q4** Strict 2 threshold for mode_unlock (per Spec F4.1 threshold map).

**Audit findings closed:** P0-023 (Turn 3), P0-034 (Turn 4).

---

## §1 Scope

In scope (V1):
- Remove `minRequired=1` dashboard override path.
- Route `/workspace/admin/mode/unlock` requires two distinct admin signatures via SigningCouncil.
- Retire docstrings + comments stating single-admin unlock is supported.
- Update `mode-manager.test.ts` to remove any test asserting single-admin success.
- Update `admin-writer.test.ts` to invert the single-admin assertion (P0-034 evidence).
- CI gate per Spec F4.19 (`GOV-09 enforcing-lock multi-admin`).

Out of scope:
- Other mode transitions (observe → advisory, advisory → enforcing) — those are separate signed envelopes; this spec is specifically `mode_unlock` (enforcing → advisory or enforcing → observe).
- Time-bounded unlock (V2 owner-ratified).

---

## §2 Behavior changes

### §2.1 `mode_unlock` flow (canonical, V1)

1. Admin clicks "Unlock enforcing" in dashboard.
2. UI shows: "This operation requires two distinct admin signatures via SigningCouncil. Open a signing request."
3. Submit → server creates `SigningRequest(operation='mode_unlock', payload, opener=principalId)` via SigningCouncil (Spec F4.1).
4. Second admin reviews + signs.
5. Threshold (2) met → `modeManager.unlockEnforcing(signatures)` runs.
6. Mode transitions; ledger event `mode_unlocked` with full signature chain.

### §2.2 Retired paths

- The `serve.ts:251-278` override that constructs `mode-manager` with `minRequired=1` is removed.
- The route `admin-writer.ts:1986-2011` accepting `unlockEnforcing(auth.principalId)` single-admin signature is removed.
- Any docstring or comment containing "Single-admin unlock of enforcing-lock from the dashboard" is deleted.

### §2.3 Three-mode behavior

| Mode      | Gate behavior                                                                                       | Run continues? | Ledger writes? |
|-----------|-----------------------------------------------------------------------------------------------------|----------------|----------------|
| observe   | SigningRequest open + sign succeed; on threshold met, mode-manager logs `would_unlock_enforcing`; mode not changed | n/a (admin op) | always         |
| advisory  | same as observe + workspace warning if opener is single admin without quorum                        | n/a            | always         |
| enforcing | SigningCouncil + threshold required; below-threshold attempt 409; only 2-of-2 unlocks               | n/a            | always         |

### §2.4 BAKED vs plug-in

- **BAKED (floor):** `modeManager.unlockEnforcing` requires `signatures: SignatureChainEntry[]` with `length >= 2` and all distinct registered admin keys.
- **PLUG-IN (defense in depth):** admin-writer route requires the request to be SigningRequest-mediated; single-signature payload rejected with 409.

---

## §3 Implementation sequence

1. Delete `minRequired=1` override in `packages/interfaces/cli/src/commands/serve.ts:251-278`.
2. Delete single-admin unlock route at `packages/interfaces/api/src/routes/admin-writer.ts:1986-2011`; replace with SigningCouncil-mediated route.
3. Update `packages/core/src/modes/mode-manager.ts:131-142` to assert `minRequired >= 2` at construction (compile-error on lower).
4. Update mode-manager tests to remove single-admin success expectations.
5. Update admin-writer tests (`tests/api/admin-writer.test.ts:2286-2294`) to assert single-admin attempt fails 409.
6. Add new tests for two-of-two unlock + duplicate-signer denial + unknown-signer denial.
7. CI gate per Spec F4.19.

---

## §4 Tests (acceptance gates)

| Gate | Purpose | Type |
|---|---|---|
| ELM-01 | `ModeManager` constructed with `minRequired=1` for `disableEnforcingLock` → throws at construction | TS-build / Unit |
| ELM-02 | `/mode/unlock` POST with single signature → 409 + `unlock_requires_two_distinct_admins` | Integration |
| ELM-03 | Duplicate signature from same admin → 409 + `duplicate_signer` | Integration |
| ELM-04 | Signature from unregistered admin key → 403 | Integration |
| ELM-05 | Two distinct registered admin signatures via SigningCouncil → mode transitions; `mode_unlocked` event with full chain | Integration |
| ELM-06 | observe mode: threshold met logs `would_unlock_enforcing`; mode does not transition | Integration |
| ELM-07 | Static gate detects `minRequired=1` literal anywhere in mode-unlock paths → CI fails | Static |
| ELM-08 | Static gate detects "Single-admin unlock" docstring/comment → CI fails | Static |

**CI static gates (Spec F4.19):**
- `GOV-09 enforcing-lock multi-admin` — verifies dashboard unlock requires ≥2 distinct signatures; bans `minRequired=1` literal and single-admin-unlock docstrings.

---

## §5 Audit closure mapping

| Finding | How closed |
|---|---|
| P0-023 | `minRequired=1` path removed; mode-manager construction asserts ≥2; SigningCouncil is only unlock path; tests ELM-01/-02 |
| P0-034 | admin-writer test inverted to assert single-admin fails; static gate bans the override pattern; ELM-07/-08 |

---

*End of v0.1.0.*

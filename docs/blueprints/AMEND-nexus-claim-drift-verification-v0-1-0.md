# AMEND — Nexus Claim Drift Verification

**Version:** v0.1.0
**Status:** RATIFIED (Hard Law #14 implementation; RBAC callback at every NXS/NVG gate)
**Date:** 2026-05-19
**Owner:** James Huson / Lake Area LLC
**Author:** Claude (dangerous-mode spec rework session)
**Base commit:** 3ae197d
**Outline pin:** docs/alignment/nexus-component-outline-v0-1-0.md Hard Law #14, §3 G NVG, §3 H NXS, §3 B RBAC
**Audit packet:** Turn 2 P0-011, Turn 4 P0-037

---

## §0 Disposition

Hard Law #14: NXS and NVG callback to RBAC at every governance gate to verify the carried claims envelope still matches RBAC's current state. Mismatch = hard fail + `claim_drift_detected` ledger event + workspace receipt with reason. Stale or forged claims cannot succeed.

Today: `packages/core/src/gates/01-identity.gate.ts` resolves claims once at Gate 01 and downstream gates trust the carried snapshot (P0-011). This spec adds a `ClaimVerificationPort` that NXS and NVG callback into at every gate before evaluation. Mismatch produces a canonical denial.

**Hard Laws this spec preserves:**
- **#14** Carried claims verified against RBAC at every governance gate.
- **#5** NXS sole action-governance authority — claim drift detection happens inside NXS gates.
- **#6** NVG sole model-firewall governance authority — claim drift detection mirrored in NVG gates.

**Q-rulings applied:**
- **Q3** BAKED enforcement — `ClaimVerificationPort` is baked; plug-in RBAC implementations expose the verification API.
- **Q5** Plug-ins never kill — RBAC plug-in returns drift evidence; baked NXS/NVG denies.

**Audit findings closed:** P0-011 (Turn 2), P0-037 (Turn 4).

---

## §1 Scope

In scope (V1):
- `ClaimVerificationPort` contract.
- Re-verification call wrapper invoked at every NXS gate (01-07).
- Re-verification call wrapper invoked at every NVG gate (classify, route, return-precheck).
- `claim_drift_detected` ledger event with carried-vs-current diff.
- Workspace receipt with reason.
- CI gate per Spec F4.19 (`GOV-15 claim drift verification`).

Out of scope:
- Caching policy beyond per-gate (V2 may permit a short per-run TTL with explicit ratification).
- Multi-tenant RBAC federation drift (V2).

---

## §2 Contract types

### §2.1 `ClaimVerificationPort` (baked)

```ts
interface ClaimVerificationPort {
  /**
   * Re-resolve current claims for principal at this moment and compare to carried snapshot.
   * Returns 'match' if canonical comparison passes; 'drift' with diff details otherwise.
   */
  verify(carried: IdentityClaims, gateName: GateName): Promise<ClaimVerificationResult>;
}

type ClaimVerificationResult =
  | { kind: 'match'; currentClaimsRef: ClaimsRef }
  | { kind: 'drift'; currentClaimsRef: ClaimsRef; diff: ClaimsDiff };

interface ClaimsDiff {
  readonly principalId: PrincipalId;
  readonly fieldsChanged: readonly ClaimsField[];   // e.g., 'permittedTargetSystems', 'octLevel', 'capabilities'
  readonly carriedHash: HexDigest;
  readonly currentHash: HexDigest;
  readonly detectedAt: WallClockISO;
}
```

Canonical comparison: stable JSON canonicalization (per outline §3 S signing model) + SHA-256; both carried and current must hash to the same value.

### §2.2 `claim_drift_detected` ledger event

```ts
interface ClaimDriftDetectedEvent {
  readonly eventType: 'claim_drift_detected';
  readonly runId: RunId;
  readonly nodeId: NodeId;
  readonly gateName: GateName;
  readonly principalId: PrincipalId;
  readonly diff: ClaimsDiff;
  readonly carriedClaimsRef: ClaimsRef;
  readonly currentClaimsRef: ClaimsRef;
  readonly emittedAt: RunSequence;
}
```

---

## §3 Runtime behavior

### §3.1 NXS gate wrapper

Every NXS gate (Gate 01 identity through Gate 07 dispatch) is wrapped:

```ts
async function runGateWithDriftCheck<C extends GateContext>(
  gate: Gate<C>,
  context: C,
  verifier: ClaimVerificationPort,
): Promise<GateResult> {
  const verification = await verifier.verify(context.identityClaims, gate.name);
  if (verification.kind === 'drift') {
    await context.runLedger.append({
      eventType: 'claim_drift_detected',
      runId: context.runId,
      nodeId: context.nodeId,
      gateName: gate.name,
      principalId: context.identityClaims.principalId,
      diff: verification.diff,
      carriedClaimsRef: context.identityClaims.ref,
      currentClaimsRef: verification.currentClaimsRef,
      emittedAt: context.runLedger.nextSeq(),
    });
    return { outcome: 'denied', denialCode: 'claim_drift_detected' };
  }
  return gate.evaluate(context);
}
```

Gate 01 (identity resolution) is the only gate where carried claims and current claims trivially match (Gate 01 IS the resolution). Gate 01 stores `currentClaimsRef` on context for downstream comparison.

### §3.2 NVG gate mirror

NVG classify-and-route + return-precheck both invoke the same wrapper pattern. Drift at NVG produces same `claim_drift_detected` event with `gateName` set to the NVG gate name.

### §3.3 Workspace receipt

On drift denial:
- Workspace receipt: "Your RBAC permissions changed mid-run (fields: `<fieldsChanged>`); the action could not proceed."
- Includes timestamp + which gate detected the drift.
- Does NOT include carried/current claim values (those live in ledger).

### §3.4 Three-mode behavior

| Mode      | Gate behavior                                                                                          | Run continues? | Ledger writes? |
|-----------|--------------------------------------------------------------------------------------------------------|----------------|----------------|
| observe   | wrapper calls verifier; on drift, log `would_deny_claim_drift`; gate evaluation proceeds with carried  | yes            | always         |
| advisory  | same as observe + workspace warning ("claim drift detected, run continuing in advisory mode")          | yes            | always         |
| enforcing | wrapper denies on drift before gate evaluation; `claim_drift_detected` written; NXS/NVG fails closed   | no on drift    | always         |

### §3.5 BAKED vs plug-in

- **BAKED (floor):** `ClaimVerificationPort` invocation inside NXS/NVG gate runners; canonical comparison; ledger writes; failure to call verifier is a CI gate violation (Spec F4.19 GOV-15).
- **PLUG-IN (defense in depth):** RBAC plug-in implements `ClaimVerificationPort.verify` by re-resolving from its own datastore; a customer RBAC that returned `match` always would still be detected by inverse cross-check tests.

---

## §4 Implementation sequence

1. Add `ClaimVerificationPort` + `ClaimVerificationResult` + `ClaimsDiff` to `packages/contracts/`.
2. Implement reference verifier in `packages/core/src/identity/claim-verifier.ts`.
3. Wrap each NXS gate in `packages/core/src/gates/runner.ts`.
4. Wrap each NVG gate.
5. Add `claim_drift_detected` ledger event type.
6. Wire workspace receipt rendering for drift denials.
7. Tests + CI gates per §5.

---

## §5 Tests (acceptance gates)

| Gate | Purpose | Type |
|---|---|---|
| CDV-01 | Gate 01 stores `currentClaimsRef` on context; Gate 02 callback returns match → gate proceeds | Unit |
| CDV-02 | RBAC capability removed between Gate 01 and Gate 04 → Gate 04 wrapper detects drift; denies; `claim_drift_detected` emitted | Integration |
| CDV-03 | OCT raised mid-run between Gate 02 and Gate 05 → drift detected; deny with diff `['octLevel']` | Integration |
| CDV-04 | NVG return-precheck detects drift on inbound payload → fail closed | Integration |
| CDV-05 | observe mode: drift logs `would_deny_claim_drift`; gate proceeds | Integration |
| CDV-06 | enforcing mode: drift denies, run terminates, workspace receipt explains | Integration |
| CDV-07 | Verifier not called for a gate → static AST gate (GOV-15) fails CI | Static |
| CDV-08 | Plug-in RBAC always returning match: inverse cross-check (a known-drift scenario detects via canonical hash) | Integration |

**CI static gates (Spec F4.19):**
- `GOV-15 claim drift verification` — verifies every NXS gate + NVG gate is wrapped; verifies `claim_drift_detected` event type exists.

---

## §6 Audit closure mapping

| Finding | How closed |
|---|---|
| P0-011 | `ClaimVerificationPort` invoked at every NXS gate (01-07) and NVG gate; canonical comparison; ledger event; tests CDV-02/-03 |
| P0-037 | CI gate GOV-15 in Spec F4.19 verifies every gate wraps verifier; CDV-07 static |

---

*End of v0.1.0.*

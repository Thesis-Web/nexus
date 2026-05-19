# AMEND — Nexus Runtime Delegation Mint Fail-Closed

**Version:** v0.1.0
**Status:** RATIFIED (kill fabricated-UUID; Hard Law #15 symmetric intersection at mint)
**Date:** 2026-05-19
**Owner:** James Huson / Lake Area LLC
**Author:** Claude (dangerous-mode spec rework session)
**Base commit:** 3ae197d
**Outline pin:** docs/alignment/nexus-component-outline-v0-1-0.md §4 O Identity/OCT/Delegation, §3 H NXS, Hard Laws #10/#13/#15
**Audit packet:** Turn 3 P0-017, P0-018, Turn 4 P0-028, P0-029

---

## §0 Disposition

Two coupled defects in runtime delegation:

1. **Fabricated UUID on mint failure (P0-017):** `scripts/nexus-main.ts:1394-1450` catches delegation mint errors and returns `crypto.randomUUID()` as the delegation id. The run continues with a fake reference; downstream Gate 01/03 may deny but the original governance failure is obscured.

2. **Asymmetric intersection (P0-018):** `scripts/nexus-main.ts:1404-1415` intersects agent/principal systems but sets effective capabilities from `agent.allowedCapabilities` only, with a comment "Principal has no allowedCapabilities" and unused `_scope` argument. Run effective permissions are not `(user current RBAC) ∩ (agent RBAC) ∩ (explicit delegated scope)`.

This spec ratifies the canonical mint behavior: fail closed on mint failure; compute true three-way symmetric intersection across every dimension (systems, capabilities, OCT, firewall rights, run types, risk tier). Empty intersection = callback/fail closed.

**Hard Laws this spec enforces:**
- **#10** Every delegation envelope is Ed25519-signed; failure is fail-closed; ledger logged.
- **#13** Default-secure — no fabricated identifiers; no permissions granted absent positive intersection.
- **#15** Run effective permissions = symmetric intersection; lesser wins in every dimension.

**Q-rulings applied:**
- **Q2** Registration is the auth gate — delegation mint operates over a registered actor + signed delegation envelope, not a fabricated identity.
- **Q3** BAKED enforcement — delegation mint lives in the baked layer; orch (plug-in) cannot bypass.

**Audit findings closed:** P0-017, P0-018 (Turn 3), P0-028, P0-029 (Turn 4).

---

## §1 Scope

In scope (V1):
- `DelegationMintPort` baked service with strict three-way intersection.
- `DelegationMintResult` discriminated union: `success | empty_intersection | mint_error`.
- Removal of fabricated-UUID return path.
- Ledger events for every mint outcome.
- CI gates per Spec F4.19.

Out of scope:
- Cross-tenant delegation (V2).
- Time-of-use vs time-of-issue effective scope (V2).

---

## §2 Contract types

### §2.1 `IdentityClaimsCapabilityCeiling`

```ts
interface IdentityClaimsCapabilityCeiling {
  readonly principalId: PrincipalId;
  readonly permittedTargetSystems: readonly TargetSystemId[];
  readonly permittedCapabilities: readonly Capability[];     // NEW — user side of intersection
  readonly firewallTransitRights: FirewallTransitMap;
  readonly permittedRunTypes: readonly RunType[];
  readonly capabilityCeiling: CapabilityCeiling;
  readonly octLevel: OctLevel;
  readonly riskTier: RiskTier;
}
```

The `permittedCapabilities` field is mandatory. The comment "Principal has no allowedCapabilities" (P0-018 evidence) is retired.

### §2.2 `DelegationMintPort` (baked)

```ts
interface DelegationMintPort {
  mint(input: DelegationMintInput): Promise<DelegationMintResult>;
}

interface DelegationMintInput {
  readonly runId: RunId;
  readonly nodeId: NodeId;
  readonly userClaims: IdentityClaimsCapabilityCeiling;
  readonly agentDeclaration: AgentDeclaration;             // agent side of intersection
  readonly explicitDelegatedScope: DelegationScope;        // explicit run-bound delegation scope
  readonly issuedAt: WallClockISO;
}

type DelegationMintResult =
  | { kind: 'success'; delegation: SignedDelegation }
  | { kind: 'empty_intersection'; dimension: IntersectionDimension; userValues: readonly unknown[]; agentValues: readonly unknown[]; explicitValues: readonly unknown[] }
  | { kind: 'mint_error'; reason: MintErrorReason; errorRef: ErrorRef };

type IntersectionDimension =
  | 'target_systems'
  | 'capabilities'
  | 'oct_level'
  | 'firewall_rights'
  | 'run_types'
  | 'risk_tier';
```

`mint` never returns a fabricated UUID. The only success path returns a `SignedDelegation`. Empty intersection or mint error returns an explicit discriminated result.

### §2.3 `SignedDelegation`

```ts
interface SignedDelegation {
  readonly delegationId: DelegationId;
  readonly runId: RunId;
  readonly principalId: PrincipalId;
  readonly agentId: AgentId;
  readonly effectiveScope: DelegationScope;        // intersection result
  readonly issuedAt: WallClockISO;
  readonly expiresAt: WallClockISO;
  readonly issuerSignature: Ed25519Signature;       // signed by orch's signing key
}
```

`effectiveScope` is the intersection computed in §3.1.

---

## §3 Runtime behavior

### §3.1 Symmetric intersection computation

Per dimension:
- `target_systems` = `userClaims.permittedTargetSystems ∩ agentDeclaration.visibleTargetSystems ∩ explicitDelegatedScope.targetSystems`.
- `capabilities` = `userClaims.permittedCapabilities ∩ agentDeclaration.allowedCapabilities ∩ explicitDelegatedScope.capabilities`.
- `oct_level` = `min(userClaims.octLevel, agentDeclaration.maxOctLevel, explicitDelegatedScope.maxOctLevel)` by OCT_RANK.
- `firewall_rights` = `userClaims.firewallTransitRights ∩ agentDeclaration.firewallTransitRights ∩ explicitDelegatedScope.firewallTransitRights`.
- `run_types` = `userClaims.permittedRunTypes ∩ agentDeclaration.permittedRunTypes ∩ explicitDelegatedScope.runTypes`.
- `risk_tier` = `min(userClaims.riskTier, agentDeclaration.maxRiskTier, explicitDelegatedScope.maxRiskTier)` by tier rank.

If ANY dimension is empty: return `{ kind: 'empty_intersection', dimension, userValues, agentValues, explicitValues }`. Do NOT mint.

### §3.2 Mint failure handling

If signing key unavailable / signature error / persistence error: return `{ kind: 'mint_error', reason, errorRef }`. Do NOT fabricate `delegationId`. Do NOT continue with dispatch.

### §3.3 Caller behavior (orch)

```ts
const result = await delegationMint.mint(input);
switch (result.kind) {
  case 'success':
    // dispatch with result.delegation
    break;
  case 'empty_intersection':
    await ledger.append({ eventType: 'delegation_empty_intersection', ...result });
    await workspaceCallback({ type: 'empty_intersection', dimension: result.dimension });
    // run does not dispatch; user must adjust or restart
    return;
  case 'mint_error':
    await ledger.append({ eventType: 'delegation_mint_error', reason: result.reason });
    await workspaceReceipt({ type: 'delegation_failed', reason: result.reason });
    // run terminates with mint-attributed failure
    return;
}
```

### §3.4 Three-mode behavior

| Mode      | Gate behavior                                                                                       | Run continues? | Ledger writes? |
|-----------|-----------------------------------------------------------------------------------------------------|----------------|----------------|
| observe   | mint runs; on empty/error, log `would_fail_delegation`; dispatch with best-guess identity (does not block) | yes        | always         |
| advisory  | mint runs; on empty/error, callback to user + warning; user can adjust                              | yes            | always         |
| enforcing | mint runs; on empty → callback (Hard Law #15); on error → terminate per Hard Law #10                | no on fail     | always         |

### §3.5 BAKED vs plug-in

- **BAKED (floor):** `DelegationMintPort` impl; intersection arithmetic; ledger writes; CI gates that ban fabricated UUID returns + assert symmetric intersection.
- **PLUG-IN (defense in depth):** orch reference impl uses the baked port; alternate orch implementations must also.

---

## §4 Implementation sequence

1. Add `permittedCapabilities` to `IdentityClaimsCapabilityCeiling` in contracts.
2. Add `DelegationMintPort` + `DelegationMintInput` + `DelegationMintResult` types.
3. Implement baked `DelegationMint` in `packages/core/src/identity/delegation-mint.ts`.
4. Refactor `scripts/nexus-main.ts:1394-1450` to use the baked mint port; remove fabricated-UUID path.
5. Add `delegation_empty_intersection` + `delegation_mint_error` ledger events.
6. CI gates per Spec F4.19 (`GOV-03 delegation mint fail-closed`, `GOV-04 effective-scope intersection`).
7. Tests per §5.

---

## §5 Tests (acceptance gates)

| Gate | Purpose | Type |
|---|---|---|
| DMF-01 | mint success: returns `SignedDelegation` with `effectiveScope` matching three-way intersection | Unit |
| DMF-02 | User permits read+write; agent permits read; explicit delegation read → `effectiveScope.capabilities = ['read']` | Unit |
| DMF-03 | User permits read inventory; agent permits write-only sales → `{ kind: 'empty_intersection', dimension: 'capabilities' }`; no `SignedDelegation` | Unit |
| DMF-04 | Signing key unavailable → `{ kind: 'mint_error', reason: 'signing_unavailable' }`; no fabricated UUID | Unit |
| DMF-05 | OCT intersection: user OCT_OPEN, agent maxOCT_CONFIDENTIAL → `effectiveScope.octLevel = OCT_OPEN` (lesser wins) | Unit |
| DMF-06 | Empty intersection result → orch ledger writes `delegation_empty_intersection`; no NXS dispatch | Integration |
| DMF-07 | Mint error result → orch ledger writes `delegation_mint_error`; run terminates with mint-attributed failure | Integration |
| DMF-08 | Static gate detects fabricated `delegationId = crypto.randomUUID()` after catch → CI fails | Static |
| DMF-09 | observe mode: empty intersection logs `would_fail_delegation`; dispatch continues with best-guess (does not block) | Integration |
| DMF-10 | enforcing mode: empty intersection → callback; no dispatch | Integration |

**CI static gates (Spec F4.19):**
- `GOV-03 delegation mint fail-closed` — bans `crypto.randomUUID()` in delegation-mint catch blocks.
- `GOV-04 effective-scope intersection` — verifies mint impl reads all three sources (userClaims, agentDeclaration, explicitDelegatedScope) for each dimension.

---

## §6 Audit closure mapping

| Finding | How closed |
|---|---|
| P0-017 | Fabricated UUID path retired; `DelegationMintResult` discriminator; tests DMF-04/-08 |
| P0-018 | Three-way intersection across all six dimensions; `permittedCapabilities` mandatory on user claims; tests DMF-02/-05 |
| P0-028 | CI gate GOV-03 + tests DMF-06/-07 prove mint failure stops dispatch |
| P0-029 | CI gate GOV-04 + tests DMF-02/-03/-05 prove three-way intersection |

---

*End of v0.1.0.*

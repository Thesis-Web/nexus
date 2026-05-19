# AMEND — Nexus Admin: NXS Policy Bundle Editing

**Version:** v0.1.0
**Status:** RATIFIED (outline-aligned, OCT axis mandatory in V1)
**Date:** 2026-05-19
**Owner:** James Huson / Lake Area LLC
**Author:** Claude (dangerous-mode spec rework session)
**Base commit:** 3ae197d
**Outline pin:** docs/alignment/nexus-component-outline-v0-1-0.md §4 Q (mode + signing thresholds), §3 K (admin dashboard policy writer), §3 H (NXS Gate 04 consumer)
**Audit packet:** Turn 1 P0-002, Turn 2 P0-009, Turn 5 P0-041

---

## §0 Disposition

Outline §4 Q states signed policy thresholds are keyed by `(target_system, action, OCT_level)`. The repo's `PolicyCondition` and `PolicyEvalEnvelope` currently lack an OCT axis (Turn 2 P0-009), so the admin policy editor cannot author thresholds that vary by OCT classification. This spec makes the OCT axis **mandatory in V1** — not "recommended", not "optional", not "V2".

**Why mandatory:** the prior pattern of "octOverrides? optional, defer to V2" lets builders ship a policy authoring surface that cannot represent runtime law. NXS Gate 02 already computes an effective ceiling using OCT, but Gate 04 cannot distinguish per-OCT thresholds without the axis present. The asymmetry is incoherent.

**Hard Laws this spec preserves:**
- **#5** NXS is sole action-governance authority — Gate 04 consumes policy with OCT axis.
- **#10** Every signed envelope (mode/policy/etc.) is Ed25519-signed by an admin-registered key.
- **#13** Default-secure — author must explicitly state which OCT levels each rule applies to.

**Q-rulings applied:**
- **Q3** BAKED enforcement first (NXS Gate 04 evaluates OCT axis) + plug-in defense in depth (admin-writer rejects malformed policy at write time).
- **Q5** Plug-ins SUGGEST/CALLBACK/LOG — the policy bundle editor is plug-in; baked NXS evaluates.
- **Q4 + federation:** policy_bundle_replace uses SigningCouncil with strict-2 threshold (Spec F4.1).

**Audit findings closed:** P0-002 (Turn 1), P0-009 (Turn 2), P0-041 (Turn 5).

---

## §1 Scope

In scope (V1):
- Make `octLevels` a required field of `PolicyCondition`.
- Add `octLevel` to `PolicyEvalEnvelope`.
- Add matcher branch in `packages/core/src/policy/evaluator.ts`.
- Add Gate 04 evaluation tests proving identical action/system resolves differently by OCT.
- Admin dashboard policy editor surfaces OCT axis explicitly with required selection.
- Policy bundle replace requires SigningCouncil 2-signature flow (Spec F4.1).
- Migration plan for existing policy entries.

Out of scope:
- OCT-conditional approval channels (separate; see Spec F4.3).
- Per-OCT signing key rotation (V2).

---

## §2 Contract types

### §2.1 `PolicyCondition` (V1, OCT axis mandatory)

```ts
interface PolicyCondition {
  readonly actorClasses?: readonly ActorClass[];
  readonly capabilities?: readonly Capability[];
  readonly actionVerbs?: readonly ActionVerb[];
  readonly riskTiers?: readonly RiskTier[];
  readonly dataClasses?: readonly DataClass[];
  readonly environments?: readonly Environment[];
  readonly externalFacing?: boolean;
  readonly maxChainDepth?: number;
  readonly targetSystems?: readonly TargetSystemId[];
  readonly octLevels: readonly OctLevel[];   // MANDATORY — at least one entry
}
```

`octLevels` is NOT optional. NOT a fallback. Empty array is rejected at schema validation. The author MUST state which OCT levels the rule applies to. To cover all OCT levels, the author lists them explicitly (`[OCT_OPEN, OCT_INTERNAL, OCT_CONFIDENTIAL, OCT_SECURE]`).

**Rationale:** explicit-list-required is the default-secure form. A missing/empty field cannot accidentally apply universally.

### §2.2 `PolicyEvalEnvelope`

```ts
interface PolicyEvalEnvelope {
  readonly actor: {
    readonly principalId: PrincipalId;
    readonly actorClasses: readonly ActorClass[];
    readonly capabilities: readonly Capability[];
    readonly octLevel: OctLevel;          // NEW — sourced from context.identityClaims
  };
  readonly action: {
    readonly verb: ActionVerb;
    readonly targetSystem: TargetSystemId;
    readonly riskTier: RiskTier;
    readonly dataClasses: readonly DataClass[];
    readonly environment: Environment;
  };
  // ... existing fields
}
```

### §2.3 Matcher branch

```ts
function conditionMatches(cond: PolicyCondition, env: PolicyEvalEnvelope): boolean {
  if (cond.actorClasses && !overlaps(cond.actorClasses, env.actor.actorClasses)) return false;
  if (cond.capabilities && !overlaps(cond.capabilities, env.actor.capabilities)) return false;
  if (cond.actionVerbs && !cond.actionVerbs.includes(env.action.verb)) return false;
  if (cond.targetSystems && !cond.targetSystems.includes(env.action.targetSystem)) return false;
  // ... existing branches
  if (!cond.octLevels.includes(env.actor.octLevel)) return false;  // NEW — required
  return true;
}
```

The `octLevels` check is unconditional because the field is mandatory; no `if (cond.octLevels)` guard.

---

## §3 Runtime behavior

### §3.1 NXS Gate 04

`packages/core/src/gates/04-policy.gate.ts` builds `PolicyEvalEnvelope` with `actor.octLevel = context.identityClaims.octLevel`. If `identityClaims.octLevel` is undefined, Gate 04 fails closed with `policy_envelope_missing_oct` ledger event.

Per Hard Law #14 (claim drift), `identityClaims.octLevel` was already verified at Gate 01 / Gate 02 callback; Gate 04 does not re-resolve, it reads.

### §3.2 Bundle replace flow

1. Admin authors policy edits in dashboard.
2. Submit creates `SigningRequest(operation='policy_bundle_replace', payload=<canonicalized bundle>)` via SigningCouncil (Spec F4.1).
3. Second admin reviews + signs.
4. Threshold met → `policyBundleWriter.replace(payload, signatures)` runs:
   - Validates every `PolicyCondition.octLevels` is non-empty.
   - Signs the new bundle envelope with the signing council signature chain.
   - Persists, emits `policy_bundle_replaced` ledger event.
   - Cache-busts in-flight policy evaluators.
5. On schema validation failure: request marked denied, no replace.

### §3.3 Three-mode behavior

| Mode      | Gate behavior                                                                                          | Run continues? | Ledger writes? |
|-----------|--------------------------------------------------------------------------------------------------------|----------------|----------------|
| observe   | Gate 04 evaluates with OCT axis; if rule matches and outcome would deny, log `would_deny_policy`       | yes            | always         |
| advisory  | same as observe + workspace warning                                                                    | yes            | always         |
| enforcing | Gate 04 evaluates; deny fails closed; missing octLevel on actor → `policy_envelope_missing_oct` deny   | no on deny     | always         |

### §3.4 BAKED vs plug-in

- **BAKED (floor):** NXS Gate 04 evaluator reading OCT axis; policy bundle signature verification; ledger writes.
- **PLUG-IN (defense in depth):** policy-bundle-writer schema validation rejecting empty `octLevels`; dashboard form requiring OCT selection.

---

## §4 Admin dashboard surface

- Policy rule editor exposes OCT axis as a required multi-select with all OCT levels listed.
- Form-level validation: at least one OCT level must be selected.
- Preview pane shows "applies to OCT: [list]" prominently next to action/system.
- Submit button initiates SigningCouncil request; modal shows "Awaiting second signer."

---

## §5 Implementation sequence

1. Add `octLevels` (mandatory) to `PolicyCondition` in `packages/contracts/src/interfaces/index.ts`.
2. Add `octLevel` to `PolicyEvalEnvelope` in `packages/core/src/policy/evaluator.ts`.
3. Add matcher branch.
4. Update Gate 04 to populate `actor.octLevel` and fail-closed on absence.
5. Update `policyBundleWriter.replace` to validate `octLevels` non-empty in every condition.
6. Wire policy_bundle_replace through SigningCouncil (Spec F4.1).
7. Update admin dashboard editor.
8. Migration: one-time script (owner-ratified before run) backfills existing policies with `octLevels: ALL_OCT_LEVELS` and re-signs through SigningCouncil. Migration is its own arc.
9. Tests + CI gates per §6.

---

## §6 Tests (acceptance gates)

| Gate | Purpose | Type |
|---|---|---|
| POL-OCT-01 | `PolicyCondition` without `octLevels` fails contract type check | TS-build |
| POL-OCT-02 | `PolicyCondition` with empty `octLevels` array rejected at runtime schema validation | Unit |
| POL-OCT-03 | Same action+system+capability resolves DIFFERENTLY for OCT_OPEN vs OCT_SECURE (two rules, distinct outcomes) | Unit |
| POL-OCT-04 | Gate 04 with missing `identityClaims.octLevel` fails closed with `policy_envelope_missing_oct` | Unit |
| POL-OCT-05 | Bundle replace via SigningCouncil with malformed condition (empty octLevels) → request denied | Integration |
| POL-OCT-06 | observe mode: would-deny policy logs `would_deny_policy`, run continues | Integration |
| POL-OCT-07 | enforcing mode: deny on Gate 04 fails closed, no NXS dispatch | Integration |
| POL-OCT-08 | Migration backfill produces a re-signed bundle whose every condition has non-empty `octLevels` | Migration |

**CI static gates (added to Spec F4.19 GOV-* suite):**
- `GOV-13 policy OCT-axis` — scans `PolicyCondition` literal/schema and verifies `octLevels` is required; scans evaluator for the OCT matcher branch.

---

## §7 Backwards compatibility

There is no in-tree policy bundle at 3ae197d that meets the new schema. Migration (§5 step 8) is a one-time arc owner ratifies separately. Until migration runs, the policy bundle is empty and Gate 04 falls through to default-secure (deny on no matching rule).

---

## §8 Audit closure mapping

| Finding | How closed |
|---|---|
| P0-002 | `octLevels` mandatory in §2.1; matcher unconditional; tests POL-OCT-03 + POL-OCT-04 |
| P0-009 | Same; plus `actor.octLevel` in PolicyEvalEnvelope and Gate 04 reading it |
| P0-041 | Body rewrites the optional/V2 framing; OCT axis is V1 mandatory, no escape hatch |

---

*End of v0.1.0.*

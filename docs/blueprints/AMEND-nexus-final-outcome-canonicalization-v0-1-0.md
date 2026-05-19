# AMEND — Nexus Final Outcome Canonicalization

**Version:** v0.1.0
**Status:** RATIFIED (Q1 canonical vocabulary; literal-union type)
**Date:** 2026-05-19
**Owner:** James Huson / Lake Area LLC
**Author:** Claude (dangerous-mode spec rework session)
**Base commit:** 3ae197d
**Outline pin:** docs/alignment/nexus-component-outline-v0-1-0.md §3 H NXS, §4 P Run Ledger, Hard Law #10
**Audit packet:** Turn 3 P0-015, Turn 4 P0-026

---

## §0 Disposition

Per Q1, canonical `finalOutcome` vocabulary is the **longer form**: `executed_successfully` / `denied_*`. The current `packages/contracts/src/constants/index.ts` FINAL_OUTCOME enum uses `executed` (shorter) while orchestration code at `scripts/nexus-main.ts:722` checks `executed_successfully` (longer) — divergent vocabularies cause successful NXS actions to be treated as failures. This spec ratifies the longer form as canonical, tightens `FinalOutcome` from `string` to a literal union, and mandates a full upstream-downstream sweep before commit.

**Spec scope:** this is a spec; code touches are deferred to the next session per §C-Q1. The next builder session does the full sweep as a single atomic patch (no partial migration).

**Q1 ruling (verbatim):** canonical = `executed_successfully` / `denied_*` (longer forms). Update `packages/contracts/src/constants` FINAL_OUTCOME enum to match what evidence records emit. Tighten `FinalOutcome` type from `string` to a literal union so future drift compile-errors. Full upstream-downstream sweep required before commit.

**Audit findings closed (spec side):** P0-015 (Turn 3), P0-026 (Turn 4).

---

## §1 Scope

In scope (V1):
- Canonical `FINAL_OUTCOME` constant set.
- `FinalOutcome` type tightened to a literal union.
- Sweep plan for every reference site.
- CI static gate forbidding stale literals outside contracts/migration-test fixtures.

Out of scope:
- The code patch itself (executed in next session as one atomic sweep).
- Backwards-compatibility shims (Q1 says single sweep, no transitional aliases).

---

## §2 Canonical vocabulary

### §2.1 `FINAL_OUTCOME` constant

```ts
export const FINAL_OUTCOME = {
  EXECUTED:                'executed_successfully',
  DENIED_AUTH:             'denied_auth',
  DENIED_RBAC:             'denied_rbac',
  DENIED_OCT:              'denied_oct',
  DENIED_POLICY:           'denied_policy',
  DENIED_APPROVAL:         'denied_approval',
  DENIED_DELEGATION:       'denied_delegation',
  DENIED_CLAIM_DRIFT:      'denied_claim_drift',
  DENIED_WILDCARD:         'denied_wildcard',
  DENIED_LEXICON:          'denied_lexicon',
  DENIED_OTHER:            'denied_other',
  ERROR_DISPATCH:          'error_dispatch',
  ERROR_TIMEOUT:           'error_timeout',
  EXPIRED:                 'expired',
} as const;

export type FinalOutcome = (typeof FINAL_OUTCOME)[keyof typeof FINAL_OUTCOME];
```

`FinalOutcome` is now a literal union of 14 specific string literals. The previous `string` typing is replaced. Code passing any unknown string fails type check.

**Forbidden:**
- `executed` (shorter form) — RETIRED-INCORRECT.
- `denied_execution` — RETIRED-INCORRECT (audit P0-026 evidence).
- Arbitrary `string` values.

### §2.2 Discriminator helpers

```ts
export function isExecuted(o: FinalOutcome): boolean {
  return o === FINAL_OUTCOME.EXECUTED;
}

export function isDenied(o: FinalOutcome): boolean {
  return o.startsWith('denied_');
}

export function isError(o: FinalOutcome): boolean {
  return o.startsWith('error_');
}
```

Use these helpers, not literal string compares.

---

## §3 Sweep plan (for next session)

The next builder session performs the full upstream-downstream sweep as a single atomic patch. Sequence:

1. **Update the contract** — `packages/contracts/src/constants/index.ts` adopts the §2.1 shape; `FinalOutcome` becomes literal union.
2. **Update emitters** — every code path that emits a final outcome value:
   - NXS gate runners (`packages/core/src/gates/`)
   - NXS dispatch result construction (`scripts/nexus-main.ts` and packages/interfaces/api/src/server.ts)
   - Mailbox bridges (`scripts/nxs-result-mailbox-bridge.ts`)
   - Compile return (`packages/core/src/compile/`)
3. **Update consumers** — every code path that compares against final outcome:
   - Orchestration control flow (`scripts/nexus-main.ts`)
   - Workspace receipt rendering
   - Ledger projections
4. **Update tests** — every test file that asserts these values:
   - `scripts/nxs-result-mailbox-bridge.test.ts`
   - `scripts/dispatch-round-trip.test.ts`
   - Any other consumer test
5. **Update fixtures** — any fixture JSON containing `finalOutcome` strings.
6. **Add CI static gate** — `GOV-01 final outcome literal gate` (Spec F4.19).

The sweep is **atomic**: a single PR containing the contract change + all consumer updates. No mid-sweep states; no transitional aliases.

---

## §4 CI static gate (added in Spec F4.19)

`GOV-01 final outcome literal gate`:
- Scan `packages/**`, `scripts/**`, `tests/**`.
- Fail on any occurrence of `'executed'` (as string literal in finalOutcome context), `'denied_execution'`, or any string starting with `'denied_'` or `'error_'` not sourced from `FINAL_OUTCOME` constants.
- Exemptions: contracts file itself; one negative-migration test asserting the old strings are rejected.

---

## §5 Tests (acceptance gates, validated post-sweep)

| Gate | Purpose | Type |
|---|---|---|
| FOC-01 | `FinalOutcome` type is a literal union (any other string fails TS compile) | TS-build |
| FOC-02 | EvidenceRecord with `outcome=FINAL_OUTCOME.EXECUTED` → bridge result `ok` | Unit |
| FOC-03 | EvidenceRecord with `outcome=FINAL_OUTCOME.DENIED_POLICY` → bridge result `denied` with denial code | Unit |
| FOC-04 | EvidenceRecord with unknown finalOutcome (synthetic test) → fails closed at consumer with `unknown_final_outcome` error | Unit |
| FOC-05 | Static gate detects `executed_successfully` literal outside contracts → CI fails | Static |
| FOC-06 | Static gate detects `denied_execution` literal anywhere → CI fails | Static |
| FOC-07 | All emitter sites use `FINAL_OUTCOME.*` constants, not string literals (AST scan) | Static |

---

## §6 BAKED vs plug-in

- **BAKED (floor):** the FINAL_OUTCOME constants + literal-union type live in `@nexus/contracts` (consumed by both baked NXS/NVG and plug-in components); type safety enforced at compile time.
- **PLUG-IN (defense in depth):** plug-in implementations of NXS gate evaluators must import from contracts; CI static gate enforces.

---

## §7 Backwards compatibility

None. Per Q1, the sweep is atomic; transitional aliases are not allowed. Pre-sweep evidence records that used `executed` (older form) are rare in tree (test fixtures only) and rewritten in the sweep.

---

## §8 Audit closure mapping

| Finding | How closed |
|---|---|
| P0-015 | Canonical longer-form vocabulary in §2.1; literal union forces compile error on drift |
| P0-026 | CI static gate GOV-01 in Spec F4.19 forbids stale literals; tests FOC-05/-06 |

---

## §9 Open questions

None ratified open. Q1 explicitly defers the code touch to the next session as an atomic sweep, not as ongoing spec ambiguity.

---

*End of v0.1.0.*

# AMEND — Nexus CI Gate Suite (GOV-*)

**Version:** v0.1.0
**Status:** RATIFIED (16 GOV-* gates from Turn 4 as one coherent CI arc)
**Date:** 2026-05-19
**Owner:** James Huson / Lake Area LLC
**Author:** Claude (dangerous-mode spec rework session)
**Base commit:** 3ae197d
**Outline pin:** docs/alignment/nexus-component-outline-v0-1-0.md (all 16 Hard Laws)
**Audit packet:** Turn 1 P0-006, P1-005, Turn 4 P0-026 through P0-038 (CI side)

---

## §0 Disposition

Audit Turn 4 produced a CI/test closure matrix mapping each alignment-law defect to a required executable gate. This spec collects those 16 gates as one coherent arc: `GOV-01` through `GOV-16`, plus auxiliary gates added by sibling specs (federation FED-* / approval APP-* / OCT-* / lexicon LEX-MUT-* / etc.). The GOV-* gates are the **named contract** between this rework and the eventual code patch.

**Audit findings closed (CI side):** P0-006 (Turn 1), P0-026 through P0-038 (Turn 4), P1-005 (Turn 2).

---

## §1 Scope

In scope (V1):
- 16 GOV-* gates added to `scripts/ci-gate.ts` under a new `GOV-*` section.
- Each gate has a stable name, a short description, and a closure mapping to one or more sibling specs.
- Existing gates (planner-lexicon, admin-cleanup, chat-tier, compile-signing) preserved; not replaced.
- Gate runner reports both legacy + GOV-* gates in CI output.

Out of scope:
- Performance gate suite (PERF-*).
- Multi-tenant gate suite (TENANT-*).
- Real Postgres CI workflow wiring (P1-016 — separate fix).

---

## §2 GOV-* gate list

| Gate | Purpose | Sibling spec | Gate type |
|---|---|---|---|
| GOV-01 | finalOutcome literal ban; only canonical longer-form via FINAL_OUTCOME constant | F4.10 | Static |
| GOV-02 | No unsolicited model tool-call → NXS dispatch; only planner-authored nxs_dispatch may invoke NXS | F4.7 / F4.20 | Static + runtime unit |
| GOV-03 | Delegation mint fail-closed; no fabricated UUID on mint catch | F4.15 | Static + runtime integration |
| GOV-04 | Effective-scope intersection across user ∩ agent ∩ delegation in 6 dimensions | F4.15 | Unit/integration |
| GOV-05 | NVG payload label propagation; no production `dataLabels: []` for real payloads | F4.11 | Static + NVG unit |
| GOV-06 | Compile no-contract pass-through; multi-item ALSO pass-through (bundle/manifest), not default template | F4.12 | Unit |
| GOV-07 | Compile pass-through digest/provenance verification before artifact assembly | F4.12 | Unit |
| GOV-08 | Signed admin mutation envelope on every admin-writer route | F4.13 | API integration + static |
| GOV-09 | Enforcing-lock multi-admin: dashboard unlock requires ≥2 distinct registered admin signatures | F4.17 | API integration + static |
| GOV-10 | Credential lifecycle fail-closed; no silent-no-op on missing ledger writer | F4.13 | API integration |
| GOV-11 | Orch callback timeout no-kill; timeout never authors `decision: 'deny'` | F4.14 | Runtime/workspace unit + static |
| GOV-12 | OCT mutation single lawful path; generic actor update cannot mutate octLevel; downward lower denied | F4.5 / F4.16 | API + OCT manager unit |
| GOV-13 | Policy OCT-axis evaluator; `PolicyCondition.octLevels` mandatory + Gate 04 reads it | F4.2 | Unit/integration |
| GOV-14 | Lexicon mutation double-admin; `lexicon_mutation` operation requires 2-of-2 distinct admin signatures | F4.1 / F4.8 | API/unit |
| GOV-15 | Claim drift verification at every NXS/NVG gate; `claim_drift_detected` emitted on mismatch | F4.9 | Unit/integration |
| GOV-16 | Resolved relative import law; resolver-based scanner enforces package boundaries including tests | F4.18 | Static |

---

## §3 Auxiliary gates from sibling specs

Sibling specs introduce their own gate-suites that should be merged into the CI runner alongside GOV-*. These are listed for traceability:

| Suite | Spec | Count |
|---|---|---|
| FED-* | F4.1 federation | 12 |
| POL-OCT-* | F4.2 policy | 8 |
| APP-* | F4.3 approval | 10 |
| T-* | F4.4 E2E (consolidated law-first) | ~30 |
| OCT-UI-* | F4.5 OCT UI | 13 |
| ATT-* | F4.6 attachments | 12 |
| PDC-* | F4.7 planner dispatch | 15 |
| LEX-MUT-* | F4.8 lexicon | 12 |
| CDV-* | F4.9 claim drift | 8 |
| FOC-* | F4.10 final outcome | 7 |
| NPL-* | F4.11 NVG labels | 9 |
| CMP-PT-* | F4.12 compile pass-through | 9 |
| SAM-* | F4.13 signed admin mutation | 11 |
| OCT-TO-* | F4.14 orch timeout | 7 |
| DMF-* | F4.15 mint fail-closed | 10 |
| OCT-BP-* | F4.16 OCT bypass removal | 8 |
| ELM-* | F4.17 enforcing-lock | 8 |
| PIL-* | F4.18 import-law | 6 |
| CHAT-MT-* | F3a chat multi-turn | 7 |
| LIT-* | F4.20 LLM tools | (see F4.20) |

Total: ~200 acceptance gates across the alignment rework.

---

## §4 Implementation sequence

1. Add `GOV-*` section to `scripts/ci-gate.ts` with one function per gate.
2. Each gate function uses the resolver (Spec F4.18) where applicable.
3. Gate runner aggregates results into per-suite summary + overall pass/fail.
4. CI workflow runs `pnpm ci:gate` and exits non-zero on any GOV-* failure.
5. Sibling specs' acceptance gates ship in the sibling test files; the GOV-* gates are the static / contract-level invariants that prevent drift.

---

## §5 BAKED vs plug-in (gate-suite design)

- **BAKED (floor):** GOV-* gates run unconditionally; they are the executable expression of Hard Laws + outline invariants. A failed GOV-* gate fails CI.
- **PLUG-IN (defense in depth):** sibling suite-specific gates (FED-*, APP-*, etc.) cover plug-in implementations; if a customer swaps a plug-in, those suites may need extension, but GOV-* invariants must still hold.

---

## §6 Audit closure mapping

| Finding | How closed |
|---|---|
| P0-006 | GOV-01 through GOV-16 added; sibling suites listed |
| P0-026 | GOV-01 (literal final outcome ban) |
| P0-027 | GOV-02 (unsolicited tool-call no-dispatch) |
| P0-028 | GOV-03 (delegation mint fail-closed) |
| P0-029 | GOV-04 (effective-scope intersection) |
| P0-030 | GOV-05 (NVG payload labels) |
| P0-031 | GOV-06 (compile pass-through law) |
| P0-032 | GOV-07 (compile pass-through digest) |
| P0-033 | GOV-08 + GOV-10 (signed admin mutation + credential fail-closed) |
| P0-034 | GOV-09 (enforcing-lock multi-admin) |
| P0-035 | GOV-12 (OCT mutation single lawful path) |
| P0-036 | GOV-14 (lexicon mutation double-admin) |
| P0-037 | GOV-15 (claim drift) |
| P0-038 | GOV-16 (resolved relative import law) |
| P1-005 | All sibling suites listed; gate count is now meaningful |

---

## §7 Acceptance criterion for "CI gate suite GOV-* landed"

`pnpm ci:gate` reports a `GOV-* SECTION` block with all 16 named gates present (passing or failing). A green build requires all 16 GOV-* to pass plus all sibling suite assertions.

---

*End of v0.1.0.*

# Nexus E2E Smoke Suite — v0.3.0 (F4.4)

This directory hosts the 30 law-first end-to-end tests defined by
[AMEND-nexus-workspace-e2e-smoke-tests v0.3.0](../../docs/blueprints/AMEND-nexus-workspace-e2e-smoke-tests-v0-3-0.md).

The suite anchors against the 16 outline hard laws + the Phase B
spec arc. Each test exercises a single end-to-end path through the
real composition (no mocks) and asserts a specific governance
invariant.

## Status (2026-05-20 Phase B)

This directory is scaffolded. The 30 tests are staged for the
`Phase B follow-on` arc; the GOV-E2E-COVERAGE category-presence gate
in `scripts/ci-gate.ts` (see Patch 20 ci-gate addition) verifies
every mandatory category is represented once the tests land.

## Mandatory categories (per F4.4 §3)

1. Run open + run close (HL #2, #4)
2. NXS gate denials (HL #5)
3. NVG firewall transit (HL #6)
4. Mailbox isolation (HL #8)
5. Compile pass-through (HL #11)
6. Run Ledger continuity (HL #12)
7. OCT mutation (HL #10 / Spec F4.5)
8. SigningCouncil federation (Spec F4.1)
9. Enforcing-lock unlock (Spec F4.17)
10. Lexicon mutation (Spec F4.8 Phase 1)
11. Claim drift (HL #14 / Spec F4.9)
12. Final outcome canonicalization (Spec F4.10)
13. NVG payload labels (Spec F4.11)
14. Delegation mint fail-closed (HL #15 / Spec F4.15)
15. LLM internal vs targeted tools (HL #5/#7 / Spec F4.20)
16. Orch callback timeout no-kill (HL #4 / Spec F4.14)

# Nexus — Canonized Spec Deviation Memo
# Date: 2026-04-14
# Authority: Owner-approved audit resolution. Under Nexus governing precedence, approved
#            audit logs and owner-approved reference files sit above builder implementation
#            details, and a best-solve is not canonical until owner approval is explicit.
# Status: CANONICAL UNTIL DOCS ARE UPDATED
# Effect: Do not unwind the below behaviors in code, tests, or scripts/ci-gate.ts. These
#         resolutions are approved law for the current build and are the reason ci:gate is
#         green end-to-end.
# Companion doc: Owner Approval Sheet (CONTRA-601/602, HOLE-403/404/405, STUB-004) — separate document.

---

## HOLE-406 — CLOSED / OWNER-APPROVED / PATH A

Spec pins: §7.4 Step 6, §27.6, §14.4
Problem: Full raw CCV object equality across independent reruns is structurally incompatible
with runtime-minted identifiers and timestamps. This was previously logged as HOLE-406,
with Path A defined as the preferred resolution.

Approved resolution:
Deterministic replay law for scenarios 01, 02, and 03 is not full raw compilerView object
equality. It is:

  areComparable(r1.compilerView, r2.compilerView) === true
  the serialized comparable CCV fields used by §14.4 are byte-identical across independent reruns

This is canonical because the blueprint defines CCV as a stable semantic comparison surface
and states that runs are logically comparable under the comparability law, while the prior
full-object equality requirement was the contradictory part.

Implementation consequence:
The following are canonical and must remain wired as-is unless superseded by a newer
owner-approved doc revision:

  packages/core/src/integration/scenarios.integration.test.ts
    replay test uses the comparable-field / areComparable standard

  scripts/ci-gate.ts
    Step 6 validates byte-identical comparable fields, not full raw CCV object equality

Do not revert to:
  - expect(r1.evidenceRecord.compilerView).toEqual(r2.evidenceRecord.compilerView)
  - any Step 6 logic that hashes or compares full raw CCV objects across independent runs

Downstream affected:
packages/core/src/integration/scenarios.integration.test.ts, scripts/ci-gate.ts,
GitHub Actions, release trust, replay artifacts.

Observed passing state:
ci:gate now reports:
"Step 6: deterministic replay — scenarios 01, 02, 03 areComparable fields (§14.4) byte-identical."

---

---

## ADD-021 — OWNER-APPROVED NEGATIVE-FIXTURE EXEMPTION FOR STEP 10

Spec pins: §7.4 Step 10, §27.2(7), §27.3 scenario 08
Problem: Step 10 text says all fixture policy files must have valid Ed25519 signatures,
but scenario-08-policy-unsigned is a deliberate negative fixture whose purpose is to prove
unsigned policy is rejected at load with PolicySignatureError. Running Step 10 across that
negative fixture as though it were a positive signed fixture creates a self-contradiction.

Approved resolution:
Step 10 policy-signature gate validates positive fixture policy files only. The following
deliberate negative fixture is exempt from Step 10 signature validation:

  fixtures/scenario-08-policy-unsigned/unsigned-policy.json

This fixture remains mandatory in threat and integration testing and must continue to fail
load with PolicySignatureError. It is excluded from Step 10 only because Step 10 is a
positive-signature validation gate, while scenario 08 is a negative rejection fixture.

Implementation consequence:
The following is canonical and must remain wired as-is unless superseded by a newer
owner-approved doc revision:

  scripts/ci-gate.ts
    Step 10 excludes fixtures/scenario-08-policy-unsigned/unsigned-policy.json
    from the positive signature gate

Do not revert to:
  - scanning every fixture policy file indiscriminately in Step 10
  - treating scenario 08's unsigned policy as a Step 10 build failure
  - deleting or signing the scenario 08 negative fixture to "make Step 10 pass"

Downstream affected:
scripts/ci-gate.ts, fixture corpus, threat tests, integration tests, GitHub Actions.

Observed passing state:
After applying the exemption, ci:gate reports:
"Step 10: policy signature gate — 1 fixture policy file(s) have signatures" and then
passes all 11 steps.

---

---

## BUILDER INSTRUCTION

Until the canonical docs are updated, treat this deviation memo as binding law under the
approved-audit / owner-approved-reference layer of precedence. Do not "clean up,"
"generalize," or "restore" the old Step 6 or Step 10 behavior. Doing so would reintroduce
resolved contradictions and break a currently green ci:gate.

---

## REQUIRED FUTURE DOC UPDATE TARGETS

Update the canonical docs at the next law-edit pass so this memo can collapse back into /docs:

  nexus-engineering-spec-v0-4-6.md
    §7.4 Step 6
    §7.4 Step 10
    §27.6
    any completion-criteria wording that still implies full raw CCV equality or
    universal fixture-policy signature validation

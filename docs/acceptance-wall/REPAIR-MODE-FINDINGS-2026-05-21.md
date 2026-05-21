# Repair-mode out-of-scope findings — 2026-05-21

During the repair-mode session that fixed `NXS-DISPATCH-BRIDGE-RETURNS-NULL`,
several adjacent issues surfaced that are explicitly OUT OF SCOPE for this
patch (per the directive: "log any findings that are out of scope for this
fix"). They are recorded here so the next repair-mode pass can pick them up
in priority order.

## In-scope (LANDED in this patch)

These are documented here only to set context for the out-of-scope notes
below.

- `config/policy/dev-warehouse.policy.json` — added required
  `conditions.octLevels` to both rules (F4.2 §2.3). Re-signed.
- `packages/core/src/policy/rule-loader.ts` — added `validatePolicyRuleStructure`
  pass that throws `PolicyRuleValidationError` at load time when any rule
  lacks `octLevels`. Mirrors the F4.2 §2.3 spec invariant.
- `packages/contracts/src/interfaces/index.ts` — new `PolicyRuleValidationError`
  class re-exported through `@nexus/core` types.
- `scripts/nxs-result-mailbox-bridge.ts` — new required `targetDataClass` dep;
  the bridge writes `resultClassifications: [targetDataClass]` so the mailbox
  eligibility check passes for `classificationRequired: true` mailboxes.
- `scripts/nexus-main.ts` — new `resolveTargetDataClass(systemType)` helper
  using the connector-registry lookup pattern; called at the planner-nxs-
  dispatch bridge call site to thread the dataClass through.
- `scripts/nexus-bootstrap.ts` — added `NEXUS_COMPILE_RETURN_BASE_URL` env
  override so dev/test harnesses can relocate the signed manifest's self-
  callback URL host/port without re-signing the manifest. Production-default
  behavior is unchanged when the env var is unset.
- `tests/e2e/harness.ts` — sets `NEXUS_COMPILE_RETURN_BASE_URL` to the
  harness's dynamic port so the self-callback after `compile_assembly_complete`
  reaches the same server the run was opened on.
- `vitest.e2e.config.ts` — added `@nexus/contracts` / `@nexus/core` /
  `@nexus/runtime-utils` aliases so E2E tests can assert against canonical
  constants (`FINAL_OUTCOME.EXECUTED`, etc.).
- `tests/e2e/03-nxs-single.e2e.test.ts` E2E-23 — corrected assertion from the
  literal `'executed'` (which is `SIGNING_REQUEST_STATUS.EXECUTED`, a
  different constant) to `FINAL_OUTCOME.EXECUTED` (canonical value
  `'executed_successfully'`).

## Out-of-scope findings

### F-1 [SPEC_DRIFT, planner classification] — Gate 02 resolves to `read:record:single` when the action template asks for `read:record:bulk`

**Severity**: low. The dev-warehouse policy rule includes BOTH
`read:record:single` and `read:record:bulk` in its capability list, so this
mismatch doesn't block E2E-23 in practice — but it IS drift between the
action template the test supplies and the capability the pipeline classifies.

**Evidence**:
- Test posts `actionTemplate.capability = 'read:record:bulk'` (also
  `target.resourceScope = 'bulk'`).
- Gate 02 (`packages/core/src/gates/02-classification.gate.ts`) calls
  `resolveCapability(verb, target, dataClasses)` from
  `packages/core/src/classification/capability-registry.ts:175`.
- `resolveCapability` branches on `target.resourceScope === 'bulk'`. With a
  proper `target.resourceScope = 'bulk'` it should return
  `CAPABILITY_IDS.READ_RECORD_BULK`.
- Diagnostic showed Gate 02 emitted `"classified: read:record:single @ low"`.

**Likely cause**: the orchestrator-built `AgentAction` at
`scripts/nexus-main.ts:654-683` synthesizes `rawVerb` + `rawTarget` from
`tmpl.capability.split(':')` but does NOT thread the action template's
`target.resourceScope` into the action — `target` is reconstructed implicitly
elsewhere, and the resourceScope may be lost.

**Why out of scope**: doesn't block E2E-23 (policy rule covers both
capability variants) and would require touching the planner-nxs-dispatch
classification path (a different module than the bridge fix scope). Should
be a follow-on `F-CLASSIFICATION-DRIFT` patch.

---

### F-2 [SPEC_DRIFT, naming] — `FINAL_OUTCOME.EXECUTED = 'executed_successfully'`, but ledger event `nxs_action.detail.finalOutcome` is emitted by an unrelated emitter that may use a different label

**Severity**: low. The diagnostic showed `nxs_action.detail.finalOutcome =
"executed_successfully"` which matches the constant. But the prior session's
audit specifically flagged this as drift target ("retire stale
`executed_successfully` per Q1/F4.10 canonicalization") — and the current
constant value IS the long-form. There's an open question about whether
F4.10 ratified the short or long form as canonical.

**Evidence**:
- `packages/contracts/src/constants/index.ts:161` — `EXECUTED: 'executed_successfully'`.
- `packages/contracts/src/constants/index.ts:234` — `SIGNING_REQUEST_STATUS.EXECUTED: 'executed'`.
- Two constants both named `EXECUTED` with different values is itself a
  drift hazard for callers using the literal vs the constant.

**Why out of scope**: requires owner/architecture ratification on which
literal is canonical for `FINAL_OUTCOME`. The patch uses
`FINAL_OUTCOME.EXECUTED` symbolically — whichever value the spec lands on,
the test stays correct.

---

### F-3 [UNIMPLEMENTED_SURFACE / manifest-manifold] — compile-return URL is signed manifest config, but the host/port portion is environment-relocatable

**Severity**: medium. The patch added `NEXUS_COMPILE_RETURN_BASE_URL` env
override as a minimal fix. The cleaner production design — per the owner's
"anything that is part of a plug and play module must pass through the
manifest manifold" directive — is to make compile-return-endpoint URL
authoring carry an explicit host/port resolution mode (e.g.
`urlMode: "absolute" | "self_relative"` on the endpoint record). A
self_relative endpoint resolves against the server's own listening address
at dispatch time and never needs an env override.

**Evidence**:
- `config/output/compile-return.v1.yaml` — endpoint `url:
  http://127.0.0.1:7701/compile-return/reference-workspace-return` is a
  hardcoded self-callback. The "7701" baked into a signed manifest is what
  forced the env-override workaround.
- `scripts/nexus-bootstrap.ts` — the `httpCallbackTransport.send` now
  rewrites the URL origin via env; this is a pragmatic patch, not the
  manifest-manifold-clean answer.

**Why out of scope**: the manifest-manifold endpoint-record extension
requires schema changes (`packages/contracts/src/externals/manifests.ts`
adds a new field), admin-writer support (the dashboard's compile-return
form needs the new field), and a migration of the existing manifest. That
is a multi-file architectural patch; the env override is the minimum that
unblocks E2E-23 without spreading scope.

**Owner directive ties**: "plug and play modules must pass through the
manifest manifold." Compile-return endpoints ARE such a module. The
self_relative URL mode is the manifest-manifold-clean closure of this
finding.

---

### F-4 [UNIMPLEMENTED_SURFACE / admin writer gap] — no admin-writer surface exists to update a policy rule's `octLevels`

**Severity**: medium. The data fix to `config/policy/dev-warehouse.policy.json`
was performed manually (edit JSON + run `scripts/sign-policy.ts`). An admin
operating the dashboard cannot today open the dev-warehouse policy, add an
`octLevels` list, and re-sign — there's no editable-form route for policy
rules' OCT axis.

**Evidence**:
- `packages/interfaces/api/src/routes/admin-writer.ts` — has writers for
  actors, principals, agents, connectors, OCT, mode, lexicon (per
  `packages/interfaces/api/src/routes/admin-writer.ts:449,462` for mailbox
  classification), but NOT for policy-rule fields.
- The owner directive says "if the action requires admin dashboard control,
  it must have a writer behind it." Policy-rule authoring is admin work
  that needs a writer.

**Why out of scope**: the patch fixed the policy rule with a one-shot CLI
sign. Building the admin-writer surface for policy-rule editing is a
separate F4.* arc (policy-author admin) that touches admin UI + writer
route + signed mutation envelope.

---

### F-5 [SPEC_DRIFT, eligibility] — empty `octLevels: []` array is documented as "no actor matches; default-secure" but production rules typically don't intend that

**Severity**: low (informational).

**Evidence**:
- `packages/core/src/policy/evaluator.ts:52-54`:
  > F4.2 §2.3 — unconditional OCT check. Empty `octLevels` means no actor
  > matches (default-secure); to apply the rule to every level the author
  > lists them explicitly.
- Risk: an author who interprets `octLevels: []` as "applies to all OCT
  levels" (the natural-language reading) accidentally writes a default-deny
  rule that never matches. The validation in this patch catches
  MISSING/`undefined` but does NOT catch empty array.

**Why out of scope**: this is a policy-authoring UX concern. The runtime
behavior is spec-correct (per the F4.2 §2.3 comment). A separate
PolicyLint surface could warn (not error) on empty `octLevels` arrays.

---

### F-6 [HARNESS_BUG, observability] — `harness.waitForRunClosed.finalOutcome` returns `null` instead of the canonical FINAL_OUTCOME value

**Severity**: low. The diag run showed
`{"closeReason":"completed","finalOutcome":null}` even when the run did
finish via `executed_successfully`. The harness reads `finalOutcome` from
the `run_closed` event's detail, but the event's detail field is not
`finalOutcome` — it's per-event-specific (e.g. `acceptedAt`,
`returnEndpointId`, `artifactId`).

**Evidence**:
- `tests/e2e/harness.ts:325-330` — `finalOutcome = closeEvent ?
  (closeEvent.detail['finalOutcome'] as string | undefined) ?? null : null;`
- The `run_closed` ledger event has `closeReason` and `acceptedAt` but no
  `finalOutcome`. The canonical `finalOutcome` lives on the `nxs_action`
  event (and on each EvidenceRecord).

**Why out of scope**: doesn't block E2E-23 — the test reads `finalOutcome`
from `ledgerEvents.filter(nxs_action)` directly, not from
`snap.finalOutcome`. The harness field is currently unused and benign.
Could be fixed in a small harness patch.

---

### F-7 [PRODUCT_RUNTIME / blocker chain] — 23 catalog tests transitively blocked on NXS-DISPATCH-BRIDGE-RETURNS-NULL should re-evaluate after this patch

**Severity**: action item, not a defect.

**Evidence**:
- `docs/acceptance-wall/FAILURE-LEDGER-baseline-2026-05-21.md` listed 24
  tests blocked by `NXS-DISPATCH-BRIDGE-RETURNS-NULL`. E2E-23 has flipped
  to green; the other 23 are catalog slots whose blocker is now resolved
  but bodies still need writing.

**Why out of scope**: per the directive, "Do not start downstream blocked
tests until E2E-23 is green." E2E-23 is now green. The next repair-mode
pass should promote the 23 still-red slots from
`UNIMPLEMENTED_TEST_BODY/PRODUCT_RUNTIME` to real test bodies and
re-classify any remaining failures.

The next-up candidates (no external dependency, body sketches already in
the wall): E2E-21, E2E-22, E2E-24, E2E-27, E2E-29.

---

## Forensic summary of the fix

**Root cause**:
1. `config/policy/dev-warehouse.policy.json` had two rules with `conditions`
   missing the F4.2 §2.3 required `octLevels` field.
2. `packages/core/src/policy/evaluator.ts:55` called
   `cond.octLevels.includes(env.octLevel)` without a null guard (correctly,
   per the spec contract that octLevels is required).
3. Gate 04 invocation threw `TypeError: Cannot read properties of undefined
   (reading 'includes')` instead of producing a clean decision.
4. The pipeline's catch wrapper at `packages/core/src/engine/pipeline.ts:327-352`
   converted the TypeError into a synthetic `pipeline_runtime` decision
   with `outcome: 'error'`.
5. Gate 07 (`packages/core/src/gates/07-evidence.gate.ts:100-128`) saw
   `outcome: 'error'` and emitted `FINAL_OUTCOME.ERROR_DISPATCH`.
6. The Evidence Record was written with `executionResult: null` (because
   Gate 06 never ran).
7. The bridge (`scripts/nxs-result-mailbox-bridge.ts:117-118`) correctly
   returned null on `executionResult: null`.
8. The orchestrator's dispatch wrapper at `scripts/nexus-main.ts:733-744`
   converted the null bridge result into `nxs_dispatch_bridge_returned_null`
   on the node failure.

**Secondary cause** (surfaced after the policy fix):
- Gate 06 then executed_successfully and the bridge produced a mailbox
  item, but with `resultClassifications: []`. The mailbox manifest has
  `classificationRequired: true` (`config/mailbox/mailboxes.v1.yaml:15`).
  The mailbox eligibility check at
  `packages/core/src/mailbox/mailbox-eligibility.ts:35-42` correctly
  refused the unclassified item, returning `compileEligible: false`.
- Compile then found `mailboxItemCount: 0` and threw
  `DENIAL_CODE.OUTPUT_CONTRACT_EMPTY`.

**Tertiary cause** (surfaced after the classification fix):
- Compile produced a signed artifact correctly, but the compile-return
  dispatcher's `fetch(endpoint.url)` failed because the signed manifest
  URL is `http://127.0.0.1:7701/...` and the harness binds a dynamic port.

**Three production-correct fixes, in order**:
1. **Data + load-time validation**: fix the dev-warehouse policy bundle
   AND add `validatePolicyRuleStructure` to `rule-loader.ts` so future
   bundles drift-fail at load time (fail-closed at composition, not
   eval-time crash).
2. **Bridge dataClass propagation**: add `targetDataClass` required dep
   to `BridgeDeps`, resolved from the same connector-manifest lookup the
   orchestrator already uses, written into `resultClassifications`.
3. **Compile-return URL env override**: add `NEXUS_COMPILE_RETURN_BASE_URL`
   env var so dev/test harnesses can relocate the signed manifest URL
   without re-signing. Manifest auth + signature unchanged; only network
   origin rewritten.

**No widening, no wildcards, no fail-open, no null-as-allow**. Every fix
is explicit and minimal against the spec.

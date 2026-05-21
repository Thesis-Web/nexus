# Nexus E2E Acceptance Wall

Owner directive 2026-05-21:

> we stop "faking green" we log every failure, and build the wall of end to
> end tests. The facts are that all these should work by now, but they
> don't because you and audit and arch keep falling in the same trap "find
> bug and 'fix' bug" but instead of "fixing" correct, we fix fake — it.skip,
> console log, `*`, ifany, acceptany, fail open, other wildcards, other
> pass throughs, bypasses. So today we stop. Today we bleed. The wall of
> tests will never let us commit push trash code anymore.

The wall is the truth surface of the Nexus E2E catalog. Every test in
`tests/e2e/*.e2e.test.ts` is a real `it()` that either:

1. **Passes** — the surface it covers is wired end-to-end through the
   real composition root (workspace → orch → NVG/NXS → connector →
   mailbox → compile → workspace return) and asserts the full forensic
   envelope.
2. **Fails red with `AcceptanceWallFailure`** — the surface is not yet
   built, the body is not yet written, or a known production bug
   blocks it. The failure carries structured metadata (testId,
   failureClass, reason, blockedBy, owner, lawPins, suspectedRootCause,
   nextRecommendedAction).
3. **Fails red as UNCLASSIFIED** — a real assertion failure on a
   real-bodied test. These are the highest-priority repair targets;
   they are exposing genuine product bugs.

There are no `it.skip`, no `it.todo`, no `xit`, no `describe.skip` in
the wall — the `GOV-E2E-SKIP-GATE` CI gate (`scripts/gates/no-e2e-skip.ts`)
hard-fails any re-introduction.

## How the wall runs

```
pnpm test:e2e
```

The `AcceptanceWallReporter` (wired into `vitest.e2e.config.ts`) walks
every test result and writes:

- `runs/acceptance-wall-<DATE>/FAILURE-LEDGER.md`   — human-readable
- `runs/acceptance-wall-<DATE>/FAILURE-LEDGER.jsonl` — machine-readable

`runs/` is gitignored. The ledger is ephemeral per-run output.

## The baseline (committed)

The first wall run is preserved here as the locked-in baseline:

- [`FAILURE-LEDGER-baseline-2026-05-21.md`](./FAILURE-LEDGER-baseline-2026-05-21.md)
- [`FAILURE-LEDGER-baseline-2026-05-21.jsonl`](./FAILURE-LEDGER-baseline-2026-05-21.jsonl)

The baseline is the canonical "where we started" snapshot. Future
patches that fix failures (or — heaven forbid — introduce new ones)
should be evaluated against this baseline. Repair mode is a one-way
ratchet:

- **failures going down**: expected and desired
- **failures going up**: requires explicit owner ratification and a
  classified explanation
- **failures becoming UNCLASSIFIED**: a real product bug was just
  surfaced — that is the wall doing its job
- **passing tests going red**: regression — investigate the underlying
  cause, do not weaken the test, do not skip it

## Failure-class taxonomy

| class | meaning |
| --- | --- |
| `UNIMPLEMENTED_TEST_BODY` | The catalog slot exists, the body was never written. |
| `HARNESS_BUG` | The measurement infrastructure is broken. Fix IN-WALL. |
| `INFRA_MISSING` | Docker / target system / required local service unavailable. |
| `CONNECTOR_MISSING` | Connector not built, not wired through admin, or not seeded. |
| `EXTERNAL_DEPENDENCY` | Gmail OAuth, frontier model, third-party SaaS not configured. |
| `PRODUCT_RUNTIME` | Nexus runtime path is broken. Fail-closed bug, dispatch null, etc. |
| `LAW_VIOLATION` | Fail-open / wildcard / bypass that the gates didn't catch. |
| `SPEC_DRIFT` | test/spec/code disagree on names, shapes, or contracts. |
| `UNIMPLEMENTED_SURFACE` | Product feature does not yet exist. |
| `FLAKE` | Non-deterministic timing/race; needs reproduction. |
| `UNCLASSIFIED` | A real failure that did not throw `AcceptanceWallFailure`. Triage. |

## Top blockers in the 2026-05-21 baseline

| blocker | tests blocked |
| --- | --- |
| `NXS-DISPATCH-BRIDGE-RETURNS-NULL` | 24 |
| `FRONTIER-LIVE-OR-FIXTURE-V1` | 21 |
| `OUTPUT-CONTRACT-TEMPLATE-LIBRARY-V1` | ~10 |
| `E2E-HARD-LAW-CATALOG` | 8 |
| `GMAIL-CONNECTOR-V1` | 10 |
| `E2E-MULTI-NO-CONTRACT-CATALOG` | 8 |
| `E2E-RBAC-DIFFERENTIALS-CATALOG` | 8 |
| `ADMIN-REVOKE-ENDPOINT-V1` | 2 |

Resolving a top blocker unblocks every test below it. Repair-mode
priority follows owner ratification — typically `PRODUCT_RUNTIME` and
`UNCLASSIFIED` first.

## Adding new tests

1. Pick a `testId` in the existing range or a new one.
2. Write a real `it(<name>, () => { ... })` block.
3. If the surface is wired, write the body and assert the forensic
   envelope (`runId`, `run_opened`, gate events, `run_closed`,
   `final_response`).
4. If the surface is not wired, throw `AcceptanceWallFailure({...})`
   from `tests/e2e/_acceptance/failure.ts` with structured metadata.
5. Do **not** use `it.skip`, `it.todo`, `xit`, or `describe.skip`.
   The gate will reject it.

# Nexus E2E Acceptance Wall — Failure Ledger

Generated: 2026-05-22T10:18:37.139Z

## Summary

- total tests: **138**
- passing: **35**
- failing: **103**

## Failure breakdown by class

| class | count |
| --- | --- |
| UNIMPLEMENTED_SURFACE | 44 |
| EXTERNAL_DEPENDENCY | 31 |
| UNIMPLEMENTED_TEST_BODY | 16 |
| UNCLASSIFIED | 9 |
| PRODUCT_RUNTIME | 3 |

## Blocker graph

Tests blocked on the same upstream blocker are grouped here. Resolving a top blocker unblocks every test below it.

### `FRONTIER-LIVE-OR-FIXTURE-V1` — blocks 21 tests

- E2E-11
- E2E-12
- E2E-13
- E2E-14
- E2E-15
- E2E-16
- E2E-17
- E2E-18
- E2E-19
- E2E-20
- E2E-51
- E2E-52
- E2E-53
- E2E-54
- E2E-57
- E2E-58
- E2E-59
- E2E-61
- E2E-62
- E2E-63
- E2E-86

### `OUTPUT-CONTRACT-TEMPLATE-LIBRARY-V1` — blocks 15 tests

- E2E-41
- E2E-42
- E2E-43
- E2E-44
- E2E-45
- E2E-46
- E2E-47
- E2E-48
- E2E-49
- E2E-50
- E2E-56
- E2E-65
- E2E-70
- E2E-76
- E2E-90

### `GMAIL-CONNECTOR-V1` — blocks 10 tests

- E2E-91
- E2E-92
- E2E-93
- E2E-94
- E2E-95
- E2E-96
- E2E-97
- E2E-98
- E2E-99
- E2E-100

### `MULTI-AGENT-CHAT-FANOUT-AGENT-SEEDS` — blocks 9 tests

- E2E-31
- E2E-32
- E2E-33
- E2E-34
- E2E-35
- E2E-36
- E2E-38
- E2E-39
- E2E-40

### `F4.12-COMPILE-MULTI-ITEM-PASSTHROUGH` — blocks 9 tests

- E2E-78
- E2E-81
- E2E-82
- E2E-83
- E2E-84
- E2E-85
- E2E-87
- E2E-88
- E2E-89

### `E2E-RBAC-DIFFERENTIALS-CATALOG` — blocks 7 tests

- E2E-101
- E2E-103
- E2E-104
- E2E-105
- E2E-106
- E2E-107
- E2E-108

### `CHAT-AGENT-LADDER-INTERSECTION-EMPTY` — blocks 6 tests

- E2E-71
- E2E-72
- E2E-73
- E2E-74
- E2E-75
- E2E-77

### `NXS-DISPATCH-BRIDGE-RETURNS-NULL` — blocks 3 tests

- E2E-37
- E2E-55
- E2E-102

### `E2E-CALLBACK-FLOW` — blocks 3 tests

- E2E-66
- E2E-79
- E2E-112

### `E2E-APPROVAL-FLOW-V1` — blocks 2 tests

- E2E-30
- E2E-109

### `E2E-MULTI-NO-CONTRACT-CATALOG` — blocks 2 tests

- E2E-64
- E2E-68

### `E2E-OCT-SURFACE` — blocks 2 tests

- E2E-67
- E2E-80

### `ADMIN-REVOKE-ENDPOINT-V1` — blocks 2 tests

- E2E-110
- E2E-118

### `CHAT-AGENT-AND-WRITE-CAPABILITY-SEED-DRIFT` — blocks 1 test

- E2E-29

### `E2E-MIXED-TIER-CATALOG` — blocks 1 test

- E2E-60

### `E2E-SECOND-RUN-CHAIN` — blocks 1 test

- E2E-69

## Failures (per test)

### `tests/e2e/01-chat-onprem.e2e.test.ts`

#### [UNCLASSIFIED] — — `E2E-02-chat-time: intern → "what time is it where you are?"`

- state: `fail`
- raw error (needs triage):
  ```
  expected 'error' not to be 'error' // Object.is equality
  ```

#### [UNCLASSIFIED] — — `E2E-03-chat-math: intern → "what is 17 times 23?"`

- state: `fail`
- raw error (needs triage):
  ```
  expected 'error' not to be 'error' // Object.is equality
  ```

#### [UNCLASSIFIED] — — `E2E-04-chat-summarize: analyst → summarize the prompt`

- state: `fail`
- raw error (needs triage):
  ```
  expected 'error' not to be 'error' // Object.is equality
  ```

#### [UNCLASSIFIED] — — `E2E-05-chat-translate: analyst → translate hello world`

- state: `fail`
- raw error (needs triage):
  ```
  expected 'error' not to be 'error' // Object.is equality
  ```

#### [UNCLASSIFIED] — — `E2E-06-chat-poem: sr_analyst → quarterly-reports haiku`

- state: `fail`
- raw error (needs triage):
  ```
  expected 'error' not to be 'error' // Object.is equality
  ```

#### [UNCLASSIFIED] — — `E2E-07-chat-explain: manager → bills receivable vs payable`

- state: `fail`
- raw error (needs triage):
  ```
  expected 'error' not to be 'error' // Object.is equality
  ```

#### [UNCLASSIFIED] — — `E2E-08-chat-list: manager → ops manager qualities list`

- state: `fail`
- raw error (needs triage):
  ```
  expected 'error' not to be 'error' // Object.is equality
  ```

#### [UNCLASSIFIED] — — `E2E-09-chat-define: sr_manager → inventory turnover definition`

- state: `fail`
- raw error (needs triage):
  ```
  expected 'error' not to be 'error' // Object.is equality
  ```

#### [UNCLASSIFIED] — — `E2E-10-chat-followup-pretrained-knowledge: director → PO lifecycle`

- state: `fail`
- raw error (needs triage):
  ```
  expected 'error' not to be 'error' // Object.is equality
  ```

### `tests/e2e/02-chat-frontier.e2e.test.ts`

#### [EXTERNAL_DEPENDENCY] E2E-11 — `E2E-11-frontier-search-news: analyst → Bitcoin price`

- state: `fail`
- reason: Frontier path not wired for deterministic CI; live frontier is excluded and the frontier-fixture adapter is not built. Scenario: analyst frontier search — current Bitcoin price.
- blockedBy: `FRONTIER-LIVE-OR-FIXTURE-V1`
- owner: arch
- lawPins: `HL#6`, `HL#11`
- nextRecommendedAction: Ratify split: 02a-frontier-fixture.e2e.test.ts (deterministic, CI-required) vs 02b-frontier-live.e2e.test.ts (env-gated, manual). Build the fixture adapter so audit/assertion shape is testable without live network.

#### [EXTERNAL_DEPENDENCY] E2E-12 — `E2E-12-frontier-yahoo-biggest-movers: analyst → S&P movers`

- state: `fail`
- reason: Frontier path not wired for deterministic CI; live frontier is excluded and the frontier-fixture adapter is not built. Scenario: analyst frontier finance — S&P biggest movers.
- blockedBy: `FRONTIER-LIVE-OR-FIXTURE-V1`
- owner: arch
- lawPins: `HL#6`, `HL#11`
- nextRecommendedAction: Ratify split: 02a-frontier-fixture.e2e.test.ts (deterministic, CI-required) vs 02b-frontier-live.e2e.test.ts (env-gated, manual). Build the fixture adapter so audit/assertion shape is testable without live network.

#### [EXTERNAL_DEPENDENCY] E2E-13 — `E2E-13-frontier-current-events: manager → tech news this week`

- state: `fail`
- reason: Frontier path not wired for deterministic CI; live frontier is excluded and the frontier-fixture adapter is not built. Scenario: manager frontier news — tech this week.
- blockedBy: `FRONTIER-LIVE-OR-FIXTURE-V1`
- owner: arch
- lawPins: `HL#6`, `HL#11`
- nextRecommendedAction: Ratify split: 02a-frontier-fixture.e2e.test.ts (deterministic, CI-required) vs 02b-frontier-live.e2e.test.ts (env-gated, manual). Build the fixture adapter so audit/assertion shape is testable without live network.

#### [EXTERNAL_DEPENDENCY] E2E-14 — `E2E-14-frontier-weather: sr_manager → SF weather right now`

- state: `fail`
- reason: Frontier path not wired for deterministic CI; live frontier is excluded and the frontier-fixture adapter is not built. Scenario: sr_manager frontier weather.
- blockedBy: `FRONTIER-LIVE-OR-FIXTURE-V1`
- owner: arch
- lawPins: `HL#6`, `HL#11`
- nextRecommendedAction: Ratify split: 02a-frontier-fixture.e2e.test.ts (deterministic, CI-required) vs 02b-frontier-live.e2e.test.ts (env-gated, manual). Build the fixture adapter so audit/assertion shape is testable without live network.

#### [EXTERNAL_DEPENDENCY] E2E-15 — `E2E-15-frontier-stock-quote: director → AAPL day change`

- state: `fail`
- reason: Frontier path not wired for deterministic CI; live frontier is excluded and the frontier-fixture adapter is not built. Scenario: director frontier stock quote.
- blockedBy: `FRONTIER-LIVE-OR-FIXTURE-V1`
- owner: arch
- lawPins: `HL#6`, `HL#11`
- nextRecommendedAction: Ratify split: 02a-frontier-fixture.e2e.test.ts (deterministic, CI-required) vs 02b-frontier-live.e2e.test.ts (env-gated, manual). Build the fixture adapter so audit/assertion shape is testable without live network.

#### [EXTERNAL_DEPENDENCY] E2E-16 — `E2E-16-frontier-research: vp → IMF outlook top three findings`

- state: `fail`
- reason: Frontier path not wired for deterministic CI; live frontier is excluded and the frontier-fixture adapter is not built. Scenario: vp frontier research — IMF outlook.
- blockedBy: `FRONTIER-LIVE-OR-FIXTURE-V1`
- owner: arch
- lawPins: `HL#6`, `HL#11`
- nextRecommendedAction: Ratify split: 02a-frontier-fixture.e2e.test.ts (deterministic, CI-required) vs 02b-frontier-live.e2e.test.ts (env-gated, manual). Build the fixture adapter so audit/assertion shape is testable without live network.

#### [EXTERNAL_DEPENDENCY] E2E-17 — `E2E-17-frontier-citation: vp → peer-reviewed inventory papers`

- state: `fail`
- reason: Frontier path not wired for deterministic CI; live frontier is excluded and the frontier-fixture adapter is not built. Scenario: vp frontier citation — academic search.
- blockedBy: `FRONTIER-LIVE-OR-FIXTURE-V1`
- owner: arch
- lawPins: `HL#6`, `HL#11`
- nextRecommendedAction: Ratify split: 02a-frontier-fixture.e2e.test.ts (deterministic, CI-required) vs 02b-frontier-live.e2e.test.ts (env-gated, manual). Build the fixture adapter so audit/assertion shape is testable without live network.

#### [EXTERNAL_DEPENDENCY] E2E-18 — `E2E-18-frontier-compare-models: executive → GPT-4 vs Claude business analytics`

- state: `fail`
- reason: Frontier path not wired for deterministic CI; live frontier is excluded and the frontier-fixture adapter is not built. Scenario: executive frontier compare-models.
- blockedBy: `FRONTIER-LIVE-OR-FIXTURE-V1`
- owner: arch
- lawPins: `HL#6`, `HL#11`
- nextRecommendedAction: Ratify split: 02a-frontier-fixture.e2e.test.ts (deterministic, CI-required) vs 02b-frontier-live.e2e.test.ts (env-gated, manual). Build the fixture adapter so audit/assertion shape is testable without live network.

#### [EXTERNAL_DEPENDENCY] E2E-19 — `E2E-19-frontier-fact-check: executive → Tesla Q3 2024 deliveries`

- state: `fail`
- reason: Frontier path not wired for deterministic CI; live frontier is excluded and the frontier-fixture adapter is not built. Scenario: executive frontier fact-check.
- blockedBy: `FRONTIER-LIVE-OR-FIXTURE-V1`
- owner: arch
- lawPins: `HL#6`, `HL#11`
- nextRecommendedAction: Ratify split: 02a-frontier-fixture.e2e.test.ts (deterministic, CI-required) vs 02b-frontier-live.e2e.test.ts (env-gated, manual). Build the fixture adapter so audit/assertion shape is testable without live network.

#### [EXTERNAL_DEPENDENCY] E2E-20 — `E2E-20-frontier-deep-dive: ceo → semiconductor supply chain briefing`

- state: `fail`
- reason: Frontier path not wired for deterministic CI; live frontier is excluded and the frontier-fixture adapter is not built. Scenario: ceo frontier deep-dive.
- blockedBy: `FRONTIER-LIVE-OR-FIXTURE-V1`
- owner: arch
- lawPins: `HL#6`, `HL#11`
- nextRecommendedAction: Ratify split: 02a-frontier-fixture.e2e.test.ts (deterministic, CI-required) vs 02b-frontier-live.e2e.test.ts (env-gated, manual). Build the fixture adapter so audit/assertion shape is testable without live network.

### `tests/e2e/03-nxs-single.e2e.test.ts`

#### [UNIMPLEMENTED_SURFACE] E2E-29 — `E2E-29-nxs-warehouse-update-bulk-allowed-for-manager: manager → mark batch shipped`

- state: `fail`
- reason: Bridge fix landed (43e5ed3) but the catalog's `bulk update on warehouse` framing is not buildable against the current seeds: neither manager nor warehouse-agent carries `update:record:bulk`. HL#15 intersection on the bulk-update capability dimension is empty regardless of persona substitution.
- blockedBy: `CHAT-AGENT-AND-WRITE-CAPABILITY-SEED-DRIFT`
- owner: owner
- lawPins: `HL#5`, `HL#11`, `HL#15`
- suspectedRootCause: Seed↔catalog drift: catalog row assumes `update:record:bulk` exists on at least one ladder user × business agent intersection; no such pair is seeded today.
- nextRecommendedAction: Owner ratification: either widen warehouse-agent allowedCapabilities + lift manager to match, OR amend catalog row E2E-29 to use `update:record:internal` (single-record adjustment, which warehouse-agent supports today) and document the persona-deviation per the F-10 pattern.

#### [UNIMPLEMENTED_SURFACE] E2E-30 — `E2E-30-nxs-sales-delete-allowed-for-vp: vp → delete duplicate order → Gate 05 approval`

- state: `fail`
- reason: Gate 05 approval flow not exercised end-to-end via HTTP. Needs approval harness helper.
- blockedBy: `E2E-APPROVAL-FLOW-V1`
- owner: builder
- lawPins: `HL#5`, `HL#15`

### `tests/e2e/04-multi-no-contract.e2e.test.ts`

#### [UNIMPLEMENTED_SURFACE] E2E-31 — `E2E-31-multi-chat-fan-out: sr_analyst → analyst-bot + summary-bot`

- state: `fail`
- reason: Multi-agent chat fan-out (sr_analyst fans out chat to two on-prem chat agents) names chat-style agents that don't exist in the seed (only the default chat agent + NXS read agents are seeded). Building new chat-agent seeds is out of scope per the 2026-05-22 session §11.
- blockedBy: `MULTI-AGENT-CHAT-FANOUT-AGENT-SEEDS`
- owner: owner
- lawPins: `HL#8`, `HL#11`
- nextRecommendedAction: Owner ratification: seed the catalog's named fan-out agents (analyst-bot, summary-bot, finance-bot, ops-bot, etc.) with allowedSystems that intersect ladder personas (NOT 'stub'), THEN body each scenario with a 2-node subTasks DAG. Both prerequisites must land first.

#### [UNIMPLEMENTED_SURFACE] E2E-32 — `E2E-32-multi-domain-experts: manager → finance-bot + ops-bot`

- state: `fail`
- reason: Multi-agent chat fan-out (manager fan-out to two domain-expert agents) names chat-style agents that don't exist in the seed (only the default chat agent + NXS read agents are seeded). Building new chat-agent seeds is out of scope per the 2026-05-22 session §11.
- blockedBy: `MULTI-AGENT-CHAT-FANOUT-AGENT-SEEDS`
- owner: owner
- lawPins: `HL#8`, `HL#11`
- nextRecommendedAction: Owner ratification: seed the catalog's named fan-out agents (analyst-bot, summary-bot, finance-bot, ops-bot, etc.) with allowedSystems that intersect ladder personas (NOT 'stub'), THEN body each scenario with a 2-node subTasks DAG. Both prerequisites must land first.

#### [UNIMPLEMENTED_SURFACE] E2E-33 — `E2E-33-multi-language-pair: sr_manager → english-bot + french-bot`

- state: `fail`
- reason: Multi-agent chat fan-out (sr_manager fan-out to two language-pair agents) names chat-style agents that don't exist in the seed (only the default chat agent + NXS read agents are seeded). Building new chat-agent seeds is out of scope per the 2026-05-22 session §11.
- blockedBy: `MULTI-AGENT-CHAT-FANOUT-AGENT-SEEDS`
- owner: owner
- lawPins: `HL#8`, `HL#11`
- nextRecommendedAction: Owner ratification: seed the catalog's named fan-out agents (analyst-bot, summary-bot, finance-bot, ops-bot, etc.) with allowedSystems that intersect ladder personas (NOT 'stub'), THEN body each scenario with a 2-node subTasks DAG. Both prerequisites must land first.

#### [UNIMPLEMENTED_SURFACE] E2E-34 — `E2E-34-multi-tone: director → formal-bot + casual-bot`

- state: `fail`
- reason: Multi-agent chat fan-out (director fan-out — tone differential) names chat-style agents that don't exist in the seed (only the default chat agent + NXS read agents are seeded). Building new chat-agent seeds is out of scope per the 2026-05-22 session §11.
- blockedBy: `MULTI-AGENT-CHAT-FANOUT-AGENT-SEEDS`
- owner: owner
- lawPins: `HL#8`, `HL#11`
- nextRecommendedAction: Owner ratification: seed the catalog's named fan-out agents (analyst-bot, summary-bot, finance-bot, ops-bot, etc.) with allowedSystems that intersect ladder personas (NOT 'stub'), THEN body each scenario with a 2-node subTasks DAG. Both prerequisites must land first.

#### [UNIMPLEMENTED_SURFACE] E2E-35 — `E2E-35-multi-judge-format: director → response-bot + judge-bot`

- state: `fail`
- reason: Multi-agent chat fan-out (director response + judge) names chat-style agents that don't exist in the seed (only the default chat agent + NXS read agents are seeded). Building new chat-agent seeds is out of scope per the 2026-05-22 session §11.
- blockedBy: `MULTI-AGENT-CHAT-FANOUT-AGENT-SEEDS`
- owner: owner
- lawPins: `HL#8`, `HL#11`
- nextRecommendedAction: Owner ratification: seed the catalog's named fan-out agents (analyst-bot, summary-bot, finance-bot, ops-bot, etc.) with allowedSystems that intersect ladder personas (NOT 'stub'), THEN body each scenario with a 2-node subTasks DAG. Both prerequisites must land first.

#### [UNIMPLEMENTED_SURFACE] E2E-36 — `E2E-36-multi-fact-fact-judge: vp → fact1-bot + fact2-bot + judge-bot`

- state: `fail`
- reason: Multi-agent chat fan-out (vp three-agent fact + fact + judge) names chat-style agents that don't exist in the seed (only the default chat agent + NXS read agents are seeded). Building new chat-agent seeds is out of scope per the 2026-05-22 session §11.
- blockedBy: `MULTI-AGENT-CHAT-FANOUT-AGENT-SEEDS`
- owner: owner
- lawPins: `HL#8`, `HL#11`
- nextRecommendedAction: Owner ratification: seed the catalog's named fan-out agents (analyst-bot, summary-bot, finance-bot, ops-bot, etc.) with allowedSystems that intersect ladder personas (NOT 'stub'), THEN body each scenario with a 2-node subTasks DAG. Both prerequisites must land first.

#### [PRODUCT_RUNTIME] E2E-37 — `E2E-37-multi-2x-parallel-pull: manager → sales-pull + warehouse-pull`

- state: `fail`
- reason: NXS dispatch bridge returns null on the connector path (see E2E-23 failure). Two parallel NXS pulls cannot complete until the bridge is fixed.
- blockedBy: `NXS-DISPATCH-BRIDGE-RETURNS-NULL`
- owner: arch
- lawPins: `HL#5`, `HL#8`, `HL#11`
- suspectedRootCause: scripts/nexus-main.ts NXS dispatch bridge — finalOutcome=error_dispatch, evidence had no executionResult
- nextRecommendedAction: Fix the bridge (see E2E-23 ledger detail) before this test can pass.

#### [UNIMPLEMENTED_SURFACE] E2E-38 — `E2E-38-multi-translate-pair: sr_manager → en-fr + en-es`

- state: `fail`
- reason: Multi-agent chat fan-out (sr_manager translate pair) names chat-style agents that don't exist in the seed (only the default chat agent + NXS read agents are seeded). Building new chat-agent seeds is out of scope per the 2026-05-22 session §11.
- blockedBy: `MULTI-AGENT-CHAT-FANOUT-AGENT-SEEDS`
- owner: owner
- lawPins: `HL#8`, `HL#11`
- nextRecommendedAction: Owner ratification: seed the catalog's named fan-out agents (analyst-bot, summary-bot, finance-bot, ops-bot, etc.) with allowedSystems that intersect ladder personas (NOT 'stub'), THEN body each scenario with a 2-node subTasks DAG. Both prerequisites must land first.

#### [UNIMPLEMENTED_SURFACE] E2E-39 — `E2E-39-multi-perspective-shootout: vp → exec/analyst/intern perspectives`

- state: `fail`
- reason: Multi-agent chat fan-out (vp three-agent perspective shootout) names chat-style agents that don't exist in the seed (only the default chat agent + NXS read agents are seeded). Building new chat-agent seeds is out of scope per the 2026-05-22 session §11.
- blockedBy: `MULTI-AGENT-CHAT-FANOUT-AGENT-SEEDS`
- owner: owner
- lawPins: `HL#8`, `HL#11`
- nextRecommendedAction: Owner ratification: seed the catalog's named fan-out agents (analyst-bot, summary-bot, finance-bot, ops-bot, etc.) with allowedSystems that intersect ladder personas (NOT 'stub'), THEN body each scenario with a 2-node subTasks DAG. Both prerequisites must land first.

#### [UNIMPLEMENTED_SURFACE] E2E-40 — `E2E-40-multi-no-contract-bundle-shape: executive → bundle FinalResponseArtifact carries both items`

- state: `fail`
- reason: Multi-agent chat fan-out (executive bundle-shape assertion — two mailbox items → one multi-item artifact) names chat-style agents that don't exist in the seed (only the default chat agent + NXS read agents are seeded). Building new chat-agent seeds is out of scope per the 2026-05-22 session §11.
- blockedBy: `MULTI-AGENT-CHAT-FANOUT-AGENT-SEEDS`
- owner: owner
- lawPins: `HL#11`, `F4.12`
- nextRecommendedAction: Owner ratification: seed the catalog's named fan-out agents (analyst-bot, summary-bot, finance-bot, ops-bot, etc.) with allowedSystems that intersect ladder personas (NOT 'stub'), THEN body each scenario with a 2-node subTasks DAG. Both prerequisites must land first.

### `tests/e2e/05-multi-with-contract.e2e.test.ts`

#### [UNIMPLEMENTED_SURFACE] E2E-41 — `E2E-41-table-monthly-sales: analyst → monthly_sales_table_v1`

- state: `fail`
- reason: Output-contract template 'monthly_sales_table_v1' not built; compile assembler cannot run with-contract paths.
- blockedBy: `OUTPUT-CONTRACT-TEMPLATE-LIBRARY-V1`
- owner: arch
- lawPins: `HL#11`
- nextRecommendedAction: Build output-contract template registry and seed the named templates. Then this test posts a multi-agent DAG with outputContractTemplateId and asserts compile slot match / guard eval / format render fire.

#### [UNIMPLEMENTED_SURFACE] E2E-42 — `E2E-42-prose-quarterly-review: manager → quarterly_review_prose_v1`

- state: `fail`
- reason: Output-contract template 'quarterly_review_prose_v1' not built; compile assembler cannot run with-contract paths.
- blockedBy: `OUTPUT-CONTRACT-TEMPLATE-LIBRARY-V1`
- owner: arch
- lawPins: `HL#11`
- nextRecommendedAction: Build output-contract template registry and seed the named templates. Then this test posts a multi-agent DAG with outputContractTemplateId and asserts compile slot match / guard eval / format render fire.

#### [UNIMPLEMENTED_SURFACE] E2E-43 — `E2E-43-mixed-prose-table: sr_manager → exec_report_mixed_v1`

- state: `fail`
- reason: Output-contract template 'exec_report_mixed_v1' not built; compile assembler cannot run with-contract paths.
- blockedBy: `OUTPUT-CONTRACT-TEMPLATE-LIBRARY-V1`
- owner: arch
- lawPins: `HL#11`
- nextRecommendedAction: Build output-contract template registry and seed the named templates. Then this test posts a multi-agent DAG with outputContractTemplateId and asserts compile slot match / guard eval / format render fire.

#### [UNIMPLEMENTED_SURFACE] E2E-44 — `E2E-44-file-bundle: director → monthly_files_bundle_v1`

- state: `fail`
- reason: Output-contract template 'monthly_files_bundle_v1' not built; compile assembler cannot run with-contract paths.
- blockedBy: `OUTPUT-CONTRACT-TEMPLATE-LIBRARY-V1`
- owner: arch
- lawPins: `HL#11`
- nextRecommendedAction: Build output-contract template registry and seed the named templates. Then this test posts a multi-agent DAG with outputContractTemplateId and asserts compile slot match / guard eval / format render fire.

#### [UNIMPLEMENTED_SURFACE] E2E-45 — `E2E-45-guarded-confidential: vp → secure_report_v1 with OCT-guards`

- state: `fail`
- reason: Output-contract template 'secure_report_v1' not built; compile assembler cannot run with-contract paths.
- blockedBy: `OUTPUT-CONTRACT-TEMPLATE-LIBRARY-V1`
- owner: arch
- lawPins: `HL#10`, `HL#11`
- nextRecommendedAction: Build output-contract template registry and seed the named templates. Then this test posts a multi-agent DAG with outputContractTemplateId and asserts compile slot match / guard eval / format render fire.

#### [UNIMPLEMENTED_SURFACE] E2E-46 — `E2E-46-judge-decision-table: director → judge_decision_table_v1`

- state: `fail`
- reason: Output-contract template 'judge_decision_table_v1' not built; compile assembler cannot run with-contract paths.
- blockedBy: `OUTPUT-CONTRACT-TEMPLATE-LIBRARY-V1`
- owner: arch
- lawPins: `HL#11`
- nextRecommendedAction: Build output-contract template registry and seed the named templates. Then this test posts a multi-agent DAG with outputContractTemplateId and asserts compile slot match / guard eval / format render fire.

#### [UNIMPLEMENTED_SURFACE] E2E-47 — `E2E-47-multi-source-merge: sr_manager → multi_source_merge_v1`

- state: `fail`
- reason: Output-contract template 'multi_source_merge_v1' not built; compile assembler cannot run with-contract paths.
- blockedBy: `OUTPUT-CONTRACT-TEMPLATE-LIBRARY-V1`
- owner: arch
- lawPins: `HL#8`, `HL#11`
- nextRecommendedAction: Build output-contract template registry and seed the named templates. Then this test posts a multi-agent DAG with outputContractTemplateId and asserts compile slot match / guard eval / format render fire.

#### [UNIMPLEMENTED_SURFACE] E2E-48 — `E2E-48-citation-formatted: vp → cited_research_v1 APA format`

- state: `fail`
- reason: Output-contract template 'cited_research_v1' not built; compile assembler cannot run with-contract paths.
- blockedBy: `OUTPUT-CONTRACT-TEMPLATE-LIBRARY-V1`
- owner: arch
- lawPins: `HL#11`
- nextRecommendedAction: Build output-contract template registry and seed the named templates. Then this test posts a multi-agent DAG with outputContractTemplateId and asserts compile slot match / guard eval / format render fire.

#### [UNIMPLEMENTED_SURFACE] E2E-49 — `E2E-49-email-draft: sr_manager → email_draft_v1 with subjects`

- state: `fail`
- reason: Output-contract template 'email_draft_v1' not built; compile assembler cannot run with-contract paths.
- blockedBy: `OUTPUT-CONTRACT-TEMPLATE-LIBRARY-V1`
- owner: arch
- lawPins: `HL#11`
- nextRecommendedAction: Build output-contract template registry and seed the named templates. Then this test posts a multi-agent DAG with outputContractTemplateId and asserts compile slot match / guard eval / format render fire.

#### [UNIMPLEMENTED_SURFACE] E2E-50 — `E2E-50-financial-summary-template: executive → quarterly_financial_summary_v1`

- state: `fail`
- reason: Output-contract template 'quarterly_financial_summary_v1' not built; compile assembler cannot run with-contract paths.
- blockedBy: `OUTPUT-CONTRACT-TEMPLATE-LIBRARY-V1`
- owner: arch
- lawPins: `HL#11`
- nextRecommendedAction: Build output-contract template registry and seed the named templates. Then this test posts a multi-agent DAG with outputContractTemplateId and asserts compile slot match / guard eval / format render fire.

### `tests/e2e/06-mixed-tier.e2e.test.ts`

#### [EXTERNAL_DEPENDENCY] E2E-51 — `E2E-51-onprem-then-frontier: sr_analyst → summarize → elaborate`

- state: `fail`
- reason: Mixed on-prem + frontier flow requires frontier-fixture adapter (deterministic CI) before this slot can run. Scenario: sr_analyst on-prem summarize → frontier elaborate.
- blockedBy: `FRONTIER-LIVE-OR-FIXTURE-V1`
- owner: arch
- lawPins: `HL#6`, `HL#11`
- nextRecommendedAction: Build frontier-fixture adapter (Category 2 blocker). Then post a 2-node DAG with one chat node bound to on-prem + one chat node bound to frontier-fixture and assert NVG routes each node to the correct adapter.

#### [EXTERNAL_DEPENDENCY] E2E-52 — `E2E-52-frontier-then-onprem: sr_manager → research → summarize`

- state: `fail`
- reason: Mixed on-prem + frontier flow requires frontier-fixture adapter (deterministic CI) before this slot can run. Scenario: sr_manager frontier research → on-prem summarize.
- blockedBy: `FRONTIER-LIVE-OR-FIXTURE-V1`
- owner: arch
- lawPins: `HL#6`, `HL#11`
- nextRecommendedAction: Build frontier-fixture adapter (Category 2 blocker). Then post a 2-node DAG with one chat node bound to on-prem + one chat node bound to frontier-fixture and assert NVG routes each node to the correct adapter.

#### [EXTERNAL_DEPENDENCY] E2E-53 — `E2E-53-mixed-parallel: manager → onprem-A + frontier-B → judge`

- state: `fail`
- reason: Mixed on-prem + frontier flow requires frontier-fixture adapter (deterministic CI) before this slot can run. Scenario: manager parallel on-prem + frontier → judge.
- blockedBy: `FRONTIER-LIVE-OR-FIXTURE-V1`
- owner: arch
- lawPins: `HL#6`, `HL#11`
- nextRecommendedAction: Build frontier-fixture adapter (Category 2 blocker). Then post a 2-node DAG with one chat node bound to on-prem + one chat node bound to frontier-fixture and assert NVG routes each node to the correct adapter.

#### [EXTERNAL_DEPENDENCY] E2E-54 — `E2E-54-3-stage-mixed: director → onprem → frontier → onprem-format`

- state: `fail`
- reason: Mixed on-prem + frontier flow requires frontier-fixture adapter (deterministic CI) before this slot can run. Scenario: director 3-stage mixed pipeline.
- blockedBy: `FRONTIER-LIVE-OR-FIXTURE-V1`
- owner: arch
- lawPins: `HL#6`, `HL#11`
- nextRecommendedAction: Build frontier-fixture adapter (Category 2 blocker). Then post a 2-node DAG with one chat node bound to on-prem + one chat node bound to frontier-fixture and assert NVG routes each node to the correct adapter.

#### [PRODUCT_RUNTIME] E2E-55 — `E2E-55-mixed-with-nxs: sr_manager → nxs-pull → onprem-summarize → frontier-polish`

- state: `fail`
- reason: NXS dispatch bridge returns null (see E2E-23). Mixed-tier-with-NXS depends on NXS pull working first.
- blockedBy: `NXS-DISPATCH-BRIDGE-RETURNS-NULL`
- owner: arch
- lawPins: `HL#5`, `HL#6`, `HL#11`
- nextRecommendedAction: Fix NXS dispatch bridge then build out this scenario.

#### [UNIMPLEMENTED_SURFACE] E2E-56 — `E2E-56-mixed-with-output-contract: vp → board doc with frontier research`

- state: `fail`
- reason: Requires both frontier-fixture (Category 2 blocker) AND output-contract templates (Category 5 blocker).
- blockedBy: `OUTPUT-CONTRACT-TEMPLATE-LIBRARY-V1`
- owner: arch
- lawPins: `HL#6`, `HL#11`

#### [EXTERNAL_DEPENDENCY] E2E-57 — `E2E-57-mixed-translation-pair: vp → onprem-en-fr + frontier-en-zh`

- state: `fail`
- reason: Mixed on-prem + frontier flow requires frontier-fixture adapter (deterministic CI) before this slot can run. Scenario: vp parallel on-prem + frontier translations.
- blockedBy: `FRONTIER-LIVE-OR-FIXTURE-V1`
- owner: arch
- lawPins: `HL#6`, `HL#11`
- nextRecommendedAction: Build frontier-fixture adapter (Category 2 blocker). Then post a 2-node DAG with one chat node bound to on-prem + one chat node bound to frontier-fixture and assert NVG routes each node to the correct adapter.

#### [EXTERNAL_DEPENDENCY] E2E-58 — `E2E-58-mixed-cost-routing-check: executive → low-cost on-prem + high-cost frontier`

- state: `fail`
- reason: Mixed on-prem + frontier flow requires frontier-fixture adapter (deterministic CI) before this slot can run. Scenario: executive cost-aware routing check.
- blockedBy: `FRONTIER-LIVE-OR-FIXTURE-V1`
- owner: arch
- lawPins: `HL#6`, `HL#11`
- nextRecommendedAction: Build frontier-fixture adapter (Category 2 blocker). Then post a 2-node DAG with one chat node bound to on-prem + one chat node bound to frontier-fixture and assert NVG routes each node to the correct adapter.

#### [EXTERNAL_DEPENDENCY] E2E-59 — `E2E-59-mixed-fallback: director → frontier unhealthy → on-prem fallback`

- state: `fail`
- reason: Mixed on-prem + frontier flow requires frontier-fixture adapter (deterministic CI) before this slot can run. Scenario: director frontier-fallback.
- blockedBy: `FRONTIER-LIVE-OR-FIXTURE-V1`
- owner: arch
- lawPins: `HL#6`
- nextRecommendedAction: Build frontier-fixture adapter (Category 2 blocker). Then post a 2-node DAG with one chat node bound to on-prem + one chat node bound to frontier-fixture and assert NVG routes each node to the correct adapter.

#### [UNIMPLEMENTED_TEST_BODY] E2E-60 — `E2E-60-mixed-denied-by-tier-ceiling: analyst → frontier denied at NVG`

- state: `fail`
- reason: NVG tier-ceiling denial path is testable WITHOUT a frontier adapter — the denial fires BEFORE the adapter call. Body not yet written.
- blockedBy: `E2E-MIXED-TIER-CATALOG`
- owner: builder
- lawPins: `HL#6`, `HL#10`
- nextRecommendedAction: Post a chat run as `analyst` (low tier) targeting a frontier model; assert NVG denies with tier_ceiling_exceeded BEFORE any adapter call.

### `tests/e2e/07-branching.e2e.test.ts`

#### [EXTERNAL_DEPENDENCY] E2E-61 — `E2E-61-frontier-then-fan-out: sr_manager → frontier-survey → 3-agent fan-out`

- state: `fail`
- reason: Branching DAG requires frontier-fixture adapter + multi-agent harness helpers. Scenario: sr_manager frontier survey → 3-agent fan-out.
- blockedBy: `FRONTIER-LIVE-OR-FIXTURE-V1`
- owner: arch
- lawPins: `HL#6`, `HL#8`, `HL#11`
- nextRecommendedAction: Resolve Category 2 + Category 4 blockers, then build a 4-node DAG harness helper.

#### [EXTERNAL_DEPENDENCY] E2E-62 — `E2E-62-research-then-merge: director → frontier-news → extract+classify → merge`

- state: `fail`
- reason: Branching DAG requires frontier-fixture adapter + multi-agent harness helpers. Scenario: director research → extract+classify → merge.
- blockedBy: `FRONTIER-LIVE-OR-FIXTURE-V1`
- owner: arch
- lawPins: `HL#6`, `HL#8`, `HL#11`
- nextRecommendedAction: Resolve Category 2 + Category 4 blockers, then build a 4-node DAG harness helper.

#### [EXTERNAL_DEPENDENCY] E2E-63 — `E2E-63-trend-detect-then-action: vp → frontier-trend → validate → action-plan`

- state: `fail`
- reason: Branching DAG requires frontier-fixture adapter + multi-agent harness helpers. Scenario: vp trend-detect → validate → action-plan.
- blockedBy: `FRONTIER-LIVE-OR-FIXTURE-V1`
- owner: arch
- lawPins: `HL#6`, `HL#11`
- nextRecommendedAction: Resolve Category 2 + Category 4 blockers, then build a 4-node DAG harness helper.

#### [UNIMPLEMENTED_TEST_BODY] E2E-64 — `E2E-64-multi-loop-deep: executive → 4-deep on-prem chain`

- state: `fail`
- reason: Deep on-prem chain — no frontier dependency. Body not written; needs 4-node sequential DAG harness helper.
- blockedBy: `E2E-MULTI-NO-CONTRACT-CATALOG`
- owner: builder
- lawPins: `HL#4`, `HL#8`, `HL#11`
- nextRecommendedAction: Build deep-chain DAG harness helper, then assert chain-depth limit / per-node mailbox isolation.

#### [UNIMPLEMENTED_SURFACE] E2E-65 — `E2E-65-branching-with-output: ceo → 4-agent + executive_briefing_v1`

- state: `fail`
- reason: Requires output-contract template executive_briefing_v1 + multi-agent DAG harness.
- blockedBy: `OUTPUT-CONTRACT-TEMPLATE-LIBRARY-V1`
- owner: arch
- lawPins: `HL#8`, `HL#11`

#### [UNIMPLEMENTED_TEST_BODY] E2E-66 — `E2E-66-3-stage-with-callback: vp → ambiguous next-agent → callback (HL #4)`

- state: `fail`
- reason: HL#4 — orch never kills; emits callback to user. Body not written. No frontier dependency.
- blockedBy: `E2E-CALLBACK-FLOW`
- owner: builder
- lawPins: `HL#4`
- nextRecommendedAction: Force planner ambiguity (no eligible next agent), assert callback event + user-resolution endpoint.

#### [UNIMPLEMENTED_TEST_BODY] E2E-67 — `E2E-67-branching-with-secure-rail: ceo → OCT-SECURE branch merges back`

- state: `fail`
- reason: OCT-SECURE branch behavior under merge — body not written.
- blockedBy: `E2E-OCT-SURFACE`
- owner: builder
- lawPins: `HL#10`, `HL#11`

#### [UNIMPLEMENTED_TEST_BODY] E2E-68 — `E2E-68-conditional-branch: director → judge picks downstream agent`

- state: `fail`
- reason: Judge-driven conditional dispatch — body not written. No frontier dependency.
- blockedBy: `E2E-MULTI-NO-CONTRACT-CATALOG`
- owner: builder
- lawPins: `HL#4`, `HL#8`

#### [UNIMPLEMENTED_TEST_BODY] E2E-69 — `E2E-69-second-run-trigger: vp → checkbackSourceRunId chain (HL #12)`

- state: `fail`
- reason: Second-run chain via checkbackSourceRunId — body not written.
- blockedBy: `E2E-SECOND-RUN-CHAIN`
- owner: builder
- lawPins: `HL#12`

#### [UNIMPLEMENTED_SURFACE] E2E-70 — `E2E-70-branching-with-output-contract-and-mixed-tier: ceo → board_doc_v1`

- state: `fail`
- reason: Deepest happy path — requires output-contract templates, frontier-fixture, and multi-agent harness.
- blockedBy: `OUTPUT-CONTRACT-TEMPLATE-LIBRARY-V1`
- owner: arch
- lawPins: `HL#6`, `HL#8`, `HL#11`

### `tests/e2e/08-batch-summary.e2e.test.ts`

#### [UNIMPLEMENTED_SURFACE] E2E-71 — `E2E-71-batch-50-orders: analyst → 50 sales orders → one-paragraph summary`

- state: `fail`
- reason: Batch 50 sales-order rows requires an NXS bulk pull (bridge fix 43e5ed3 unblocks the pull) followed by an LLM summarize step; the summarize step needs a chat-tier delegation that no ladder persona currently mints because the default chat agent's allowedSystems=['stub'] is disjoint from every ladder persona's seeded systems.
- blockedBy: `CHAT-AGENT-LADDER-INTERSECTION-EMPTY`
- owner: owner
- lawPins: `HL#5`, `HL#11`
- suspectedRootCause: Seed↔catalog drift surfaced by E2E-02..10 (2026-05-22): default chat agent allowedSystems=[stub] vs ladder personas allowedSystems disjoint set. HL#15 intersection on target_systems empty → delegation mint fails.
- nextRecommendedAction: Owner ratification: EITHER chat-agent seed re-declares allowedSystems=[] (chat truly touches no system; delegation engine must treat empty-on-agent-side as 'no system gate'), OR the planner skips target_systems intersection when entryMode='free_chat'. Either path unblocks ALL batch summarize scenarios.

#### [UNIMPLEMENTED_SURFACE] E2E-72 — `E2E-72-batch-100-invoices: manager → 100 invoices → top 5 anomalies`

- state: `fail`
- reason: Batch 100 invoices requires an NXS bulk pull (bridge fix 43e5ed3 unblocks the pull) followed by an LLM summarize step; the summarize step needs a chat-tier delegation that no ladder persona currently mints because the default chat agent's allowedSystems=['stub'] is disjoint from every ladder persona's seeded systems.
- blockedBy: `CHAT-AGENT-LADDER-INTERSECTION-EMPTY`
- owner: owner
- lawPins: `HL#5`, `HL#11`
- suspectedRootCause: Seed↔catalog drift surfaced by E2E-02..10 (2026-05-22): default chat agent allowedSystems=[stub] vs ladder personas allowedSystems disjoint set. HL#15 intersection on target_systems empty → delegation mint fails.
- nextRecommendedAction: Owner ratification: EITHER chat-agent seed re-declares allowedSystems=[] (chat truly touches no system; delegation engine must treat empty-on-agent-side as 'no system gate'), OR the planner skips target_systems intersection when entryMode='free_chat'. Either path unblocks ALL batch summarize scenarios.

#### [UNIMPLEMENTED_SURFACE] E2E-73 — `E2E-73-batch-warehouse-receipts: sr_analyst → 30 days receipts → shortage forecast`

- state: `fail`
- reason: Batch 30 days warehouse receipts requires an NXS bulk pull (bridge fix 43e5ed3 unblocks the pull) followed by an LLM summarize step; the summarize step needs a chat-tier delegation that no ladder persona currently mints because the default chat agent's allowedSystems=['stub'] is disjoint from every ladder persona's seeded systems.
- blockedBy: `CHAT-AGENT-LADDER-INTERSECTION-EMPTY`
- owner: owner
- lawPins: `HL#5`, `HL#11`
- suspectedRootCause: Seed↔catalog drift surfaced by E2E-02..10 (2026-05-22): default chat agent allowedSystems=[stub] vs ladder personas allowedSystems disjoint set. HL#15 intersection on target_systems empty → delegation mint fails.
- nextRecommendedAction: Owner ratification: EITHER chat-agent seed re-declares allowedSystems=[] (chat truly touches no system; delegation engine must treat empty-on-agent-side as 'no system gate'), OR the planner skips target_systems intersection when entryMode='free_chat'. Either path unblocks ALL batch summarize scenarios.

#### [UNIMPLEMENTED_SURFACE] E2E-74 — `E2E-74-batch-customer-tickets: sr_manager → 200 tickets → category breakdown`

- state: `fail`
- reason: Batch 200 customer tickets requires an NXS bulk pull (bridge fix 43e5ed3 unblocks the pull) followed by an LLM summarize step; the summarize step needs a chat-tier delegation that no ladder persona currently mints because the default chat agent's allowedSystems=['stub'] is disjoint from every ladder persona's seeded systems.
- blockedBy: `CHAT-AGENT-LADDER-INTERSECTION-EMPTY`
- owner: owner
- lawPins: `HL#5`, `HL#11`
- suspectedRootCause: Seed↔catalog drift surfaced by E2E-02..10 (2026-05-22): default chat agent allowedSystems=[stub] vs ladder personas allowedSystems disjoint set. HL#15 intersection on target_systems empty → delegation mint fails.
- nextRecommendedAction: Owner ratification: EITHER chat-agent seed re-declares allowedSystems=[] (chat truly touches no system; delegation engine must treat empty-on-agent-side as 'no system gate'), OR the planner skips target_systems intersection when entryMode='free_chat'. Either path unblocks ALL batch summarize scenarios.

#### [UNIMPLEMENTED_SURFACE] E2E-75 — `E2E-75-batch-merged-files: director → sales(50)+warehouse(50) → merge → summary`

- state: `fail`
- reason: Batch sales+warehouse merge requires an NXS bulk pull (bridge fix 43e5ed3 unblocks the pull) followed by an LLM summarize step; the summarize step needs a chat-tier delegation that no ladder persona currently mints because the default chat agent's allowedSystems=['stub'] is disjoint from every ladder persona's seeded systems.
- blockedBy: `CHAT-AGENT-LADDER-INTERSECTION-EMPTY`
- owner: owner
- lawPins: `HL#5`, `HL#8`, `HL#11`
- suspectedRootCause: Seed↔catalog drift surfaced by E2E-02..10 (2026-05-22): default chat agent allowedSystems=[stub] vs ladder personas allowedSystems disjoint set. HL#15 intersection on target_systems empty → delegation mint fails.
- nextRecommendedAction: Owner ratification: EITHER chat-agent seed re-declares allowedSystems=[] (chat truly touches no system; delegation engine must treat empty-on-agent-side as 'no system gate'), OR the planner skips target_systems intersection when entryMode='free_chat'. Either path unblocks ALL batch summarize scenarios.

#### [UNIMPLEMENTED_SURFACE] E2E-76 — `E2E-76-batch-with-output-contract: vp → 100 rows → batch_summary_v1`

- state: `fail`
- reason: Requires output-contract template batch_summary_v1 AND bridge fix.
- blockedBy: `OUTPUT-CONTRACT-TEMPLATE-LIBRARY-V1`
- owner: arch
- lawPins: `HL#5`, `HL#11`

#### [UNIMPLEMENTED_SURFACE] E2E-77 — `E2E-77-batch-classified: director → 50 confidential + 50 internal → NVG case-split`

- state: `fail`
- reason: Batch mixed-classification batch requires an NXS bulk pull (bridge fix 43e5ed3 unblocks the pull) followed by an LLM summarize step; the summarize step needs a chat-tier delegation that no ladder persona currently mints because the default chat agent's allowedSystems=['stub'] is disjoint from every ladder persona's seeded systems.
- blockedBy: `CHAT-AGENT-LADDER-INTERSECTION-EMPTY`
- owner: owner
- lawPins: `HL#5`, `HL#6`, `HL#10`
- suspectedRootCause: Seed↔catalog drift surfaced by E2E-02..10 (2026-05-22): default chat agent allowedSystems=[stub] vs ladder personas allowedSystems disjoint set. HL#15 intersection on target_systems empty → delegation mint fails.
- nextRecommendedAction: Owner ratification: EITHER chat-agent seed re-declares allowedSystems=[] (chat truly touches no system; delegation engine must treat empty-on-agent-side as 'no system gate'), OR the planner skips target_systems intersection when entryMode='free_chat'. Either path unblocks ALL batch summarize scenarios.

#### [UNIMPLEMENTED_SURFACE] E2E-78 — `E2E-78-batch-with-tamper: sr_manager → 50 rows with tamper → F4.12 quarantine`

- state: `fail`
- reason: F4.12 multi-item digest/quarantine path not built (HANDOFF §F priority #6, structurally blocked on §C.3 test-migration ratification).
- blockedBy: `F4.12-COMPILE-MULTI-ITEM-PASSTHROUGH`
- owner: arch
- lawPins: `HL#11`, `F4.12`

#### [UNIMPLEMENTED_TEST_BODY] E2E-79 — `E2E-79-batch-with-callback: manager → batch too large → HL #4 callback`

- state: `fail`
- reason: HL#4 callback when batch exceeds limits — body not written. No NXS dependency (callback fires at planner).
- blockedBy: `E2E-CALLBACK-FLOW`
- owner: builder
- lawPins: `HL#4`

#### [UNIMPLEMENTED_TEST_BODY] E2E-80 — `E2E-80-batch-denied-by-oct: analyst → OCT-CONFIDENTIAL batch → Gate 02 denied`

- state: `fail`
- reason: Gate 02 (OCT classification) denial — fires BEFORE bridge dispatch, testable now. Body not written.
- blockedBy: `E2E-OCT-SURFACE`
- owner: builder
- lawPins: `HL#5`, `HL#10`
- nextRecommendedAction: Post analyst batch run against confidential resource; assert Gate 02 denial with oct_ceiling_exceeded BEFORE any connector call.

### `tests/e2e/09-multi-source-merge.e2e.test.ts`

#### [UNIMPLEMENTED_SURFACE] E2E-81 — `E2E-81-quarterly-coverage: sr_manager → can we cover Q2 orders?`

- state: `fail`
- reason: Multi-source merge sales orders + warehouse inventory now runs both upstream NXS pulls (bridge fix 43e5ed3 + per-actor mailbox isolation proven by E2E-116). The remaining gap is the compile-side multi-item assembly path (F4.12), which today proves single-item pass-through (E2E-117) but lacks the multi-mailbox merge surface this scenario requires.
- blockedBy: `F4.12-COMPILE-MULTI-ITEM-PASSTHROUGH`
- owner: arch
- lawPins: `HL#5`, `HL#8`, `HL#11`
- nextRecommendedAction: Owner-ratification path forward is §C.3 test-migration ratification by audit/arch (per HANDOFF-NEXT-SESSION.md §F priority #6); once that lands, compile assembles a deterministic merge artifact and these scenarios can be bodied as 2-node DAGs (pattern: E2E-116 multi-actor allocation + merged compile output).

#### [UNIMPLEMENTED_SURFACE] E2E-82 — `E2E-82-stockout-risk: manager → SKUs at risk this month`

- state: `fail`
- reason: Multi-source merge sales velocity + warehouse stock now runs both upstream NXS pulls (bridge fix 43e5ed3 + per-actor mailbox isolation proven by E2E-116). The remaining gap is the compile-side multi-item assembly path (F4.12), which today proves single-item pass-through (E2E-117) but lacks the multi-mailbox merge surface this scenario requires.
- blockedBy: `F4.12-COMPILE-MULTI-ITEM-PASSTHROUGH`
- owner: arch
- lawPins: `HL#5`, `HL#8`, `HL#11`
- nextRecommendedAction: Owner-ratification path forward is §C.3 test-migration ratification by audit/arch (per HANDOFF-NEXT-SESSION.md §F priority #6); once that lands, compile assembles a deterministic merge artifact and these scenarios can be bodied as 2-node DAGs (pattern: E2E-116 multi-actor allocation + merged compile output).

#### [UNIMPLEMENTED_SURFACE] E2E-83 — `E2E-83-reorder-recommendations: sr_manager → reorder plan`

- state: `fail`
- reason: Multi-source merge sales + warehouse + reorder thresholds now runs both upstream NXS pulls (bridge fix 43e5ed3 + per-actor mailbox isolation proven by E2E-116). The remaining gap is the compile-side multi-item assembly path (F4.12), which today proves single-item pass-through (E2E-117) but lacks the multi-mailbox merge surface this scenario requires.
- blockedBy: `F4.12-COMPILE-MULTI-ITEM-PASSTHROUGH`
- owner: arch
- lawPins: `HL#5`, `HL#8`, `HL#11`
- nextRecommendedAction: Owner-ratification path forward is §C.3 test-migration ratification by audit/arch (per HANDOFF-NEXT-SESSION.md §F priority #6); once that lands, compile assembles a deterministic merge artifact and these scenarios can be bodied as 2-node DAGs (pattern: E2E-116 multi-actor allocation + merged compile output).

#### [UNIMPLEMENTED_SURFACE] E2E-84 — `E2E-84-customer-shipping-perf: manager → on-time shipping report`

- state: `fail`
- reason: Multi-source merge sales orders + warehouse shipments now runs both upstream NXS pulls (bridge fix 43e5ed3 + per-actor mailbox isolation proven by E2E-116). The remaining gap is the compile-side multi-item assembly path (F4.12), which today proves single-item pass-through (E2E-117) but lacks the multi-mailbox merge surface this scenario requires.
- blockedBy: `F4.12-COMPILE-MULTI-ITEM-PASSTHROUGH`
- owner: arch
- lawPins: `HL#5`, `HL#8`, `HL#11`
- nextRecommendedAction: Owner-ratification path forward is §C.3 test-migration ratification by audit/arch (per HANDOFF-NEXT-SESSION.md §F priority #6); once that lands, compile assembles a deterministic merge artifact and these scenarios can be bodied as 2-node DAGs (pattern: E2E-116 multi-actor allocation + merged compile output).

#### [UNIMPLEMENTED_SURFACE] E2E-85 — `E2E-85-sku-margin-analysis: director → margin-by-SKU`

- state: `fail`
- reason: Multi-source merge sales prices + warehouse cost now runs both upstream NXS pulls (bridge fix 43e5ed3 + per-actor mailbox isolation proven by E2E-116). The remaining gap is the compile-side multi-item assembly path (F4.12), which today proves single-item pass-through (E2E-117) but lacks the multi-mailbox merge surface this scenario requires.
- blockedBy: `F4.12-COMPILE-MULTI-ITEM-PASSTHROUGH`
- owner: arch
- lawPins: `HL#5`, `HL#8`, `HL#11`
- nextRecommendedAction: Owner-ratification path forward is §C.3 test-migration ratification by audit/arch (per HANDOFF-NEXT-SESSION.md §F priority #6); once that lands, compile assembles a deterministic merge artifact and these scenarios can be bodied as 2-node DAGs (pattern: E2E-116 multi-actor allocation + merged compile output).

#### [EXTERNAL_DEPENDENCY] E2E-86 — `E2E-86-quarterly-forecast: vp → sales+warehouse+frontier-trends`

- state: `fail`
- reason: Needs frontier-fixture (Category 2 blocker) AND bridge fix.
- blockedBy: `FRONTIER-LIVE-OR-FIXTURE-V1`
- owner: arch
- lawPins: `HL#5`, `HL#6`, `HL#8`, `HL#11`

#### [UNIMPLEMENTED_SURFACE] E2E-87 — `E2E-87-anomaly-detect: sr_manager → refunds vs returns anomalies`

- state: `fail`
- reason: Multi-source merge refund returns anomaly join now runs both upstream NXS pulls (bridge fix 43e5ed3 + per-actor mailbox isolation proven by E2E-116). The remaining gap is the compile-side multi-item assembly path (F4.12), which today proves single-item pass-through (E2E-117) but lacks the multi-mailbox merge surface this scenario requires.
- blockedBy: `F4.12-COMPILE-MULTI-ITEM-PASSTHROUGH`
- owner: arch
- lawPins: `HL#5`, `HL#8`, `HL#11`
- nextRecommendedAction: Owner-ratification path forward is §C.3 test-migration ratification by audit/arch (per HANDOFF-NEXT-SESSION.md §F priority #6); once that lands, compile assembles a deterministic merge artifact and these scenarios can be bodied as 2-node DAGs (pattern: E2E-116 multi-actor allocation + merged compile output).

#### [UNIMPLEMENTED_SURFACE] E2E-88 — `E2E-88-supply-chain-snapshot: director → board snapshot`

- state: `fail`
- reason: Multi-source merge cross-system board snapshot now runs both upstream NXS pulls (bridge fix 43e5ed3 + per-actor mailbox isolation proven by E2E-116). The remaining gap is the compile-side multi-item assembly path (F4.12), which today proves single-item pass-through (E2E-117) but lacks the multi-mailbox merge surface this scenario requires.
- blockedBy: `F4.12-COMPILE-MULTI-ITEM-PASSTHROUGH`
- owner: arch
- lawPins: `HL#5`, `HL#8`, `HL#11`
- nextRecommendedAction: Owner-ratification path forward is §C.3 test-migration ratification by audit/arch (per HANDOFF-NEXT-SESSION.md §F priority #6); once that lands, compile assembles a deterministic merge artifact and these scenarios can be bodied as 2-node DAGs (pattern: E2E-116 multi-actor allocation + merged compile output).

#### [UNIMPLEMENTED_SURFACE] E2E-89 — `E2E-89-margin-by-region: vp → margin per region`

- state: `fail`
- reason: Multi-source merge sales + region tagging + cost now runs both upstream NXS pulls (bridge fix 43e5ed3 + per-actor mailbox isolation proven by E2E-116). The remaining gap is the compile-side multi-item assembly path (F4.12), which today proves single-item pass-through (E2E-117) but lacks the multi-mailbox merge surface this scenario requires.
- blockedBy: `F4.12-COMPILE-MULTI-ITEM-PASSTHROUGH`
- owner: arch
- lawPins: `HL#5`, `HL#8`, `HL#11`
- nextRecommendedAction: Owner-ratification path forward is §C.3 test-migration ratification by audit/arch (per HANDOFF-NEXT-SESSION.md §F priority #6); once that lands, compile assembles a deterministic merge artifact and these scenarios can be bodied as 2-node DAGs (pattern: E2E-116 multi-actor allocation + merged compile output).

#### [UNIMPLEMENTED_SURFACE] E2E-90 — `E2E-90-cross-system-audit: ceo → reconciliation report via secure_rails`

- state: `fail`
- reason: secure_rails promptMode + reconciliation contract — neither built.
- blockedBy: `OUTPUT-CONTRACT-TEMPLATE-LIBRARY-V1`
- owner: arch
- lawPins: `HL#10`, `HL#11`

### `tests/e2e/10-gmail.e2e.test.ts`

#### [EXTERNAL_DEPENDENCY] E2E-91 — `E2E-91-gmail-compose-draft: sr_manager → draft to ops@ about Q2`

- state: `fail`
- reason: Gmail connector not built. Scenario: compose draft.
- blockedBy: `GMAIL-CONNECTOR-V1`
- owner: arch
- lawPins: `HL#5`, `HL#11`
- nextRecommendedAction: Stage 1: build Mailpit connector + local docker container + 6 Mailpit tests (E2E-MAIL-001..006). Stage 2: build Gmail OAuth connector configured from admin dashboard. Stage 3: implement Gmail-specific scenarios here.

#### [EXTERNAL_DEPENDENCY] E2E-92 — `E2E-92-gmail-read-inbox: sr_manager → last 10 inbox threads`

- state: `fail`
- reason: Gmail connector not built. Scenario: read inbox.
- blockedBy: `GMAIL-CONNECTOR-V1`
- owner: arch
- lawPins: `HL#5`
- nextRecommendedAction: Stage 1: build Mailpit connector + local docker container + 6 Mailpit tests (E2E-MAIL-001..006). Stage 2: build Gmail OAuth connector configured from admin dashboard. Stage 3: implement Gmail-specific scenarios here.

#### [EXTERNAL_DEPENDENCY] E2E-93 — `E2E-93-gmail-compose-from-batch: director → customer follow-ups for order issues`

- state: `fail`
- reason: Gmail connector not built. Scenario: compose from batch — depends on NXS pull too.
- blockedBy: `GMAIL-CONNECTOR-V1`
- owner: arch
- lawPins: `HL#5`, `HL#8`
- nextRecommendedAction: Stage 1: build Mailpit connector + local docker container + 6 Mailpit tests (E2E-MAIL-001..006). Stage 2: build Gmail OAuth connector configured from admin dashboard. Stage 3: implement Gmail-specific scenarios here.

#### [EXTERNAL_DEPENDENCY] E2E-94 — `E2E-94-gmail-compose-multi-recipient: vp → board update to 5 recipients`

- state: `fail`
- reason: Gmail connector not built. Scenario: multi-recipient compose with approval.
- blockedBy: `GMAIL-CONNECTOR-V1`
- owner: arch
- lawPins: `HL#5`, `HL#10`
- nextRecommendedAction: Stage 1: build Mailpit connector + local docker container + 6 Mailpit tests (E2E-MAIL-001..006). Stage 2: build Gmail OAuth connector configured from admin dashboard. Stage 3: implement Gmail-specific scenarios here.

#### [EXTERNAL_DEPENDENCY] E2E-95 — `E2E-95-gmail-read-classify: director → classify inbox by topic`

- state: `fail`
- reason: Gmail connector not built. Scenario: inbox classification.
- blockedBy: `GMAIL-CONNECTOR-V1`
- owner: arch
- lawPins: `HL#5`
- nextRecommendedAction: Stage 1: build Mailpit connector + local docker container + 6 Mailpit tests (E2E-MAIL-001..006). Stage 2: build Gmail OAuth connector configured from admin dashboard. Stage 3: implement Gmail-specific scenarios here.

#### [EXTERNAL_DEPENDENCY] E2E-96 — `E2E-96-gmail-search: sr_manager → emails containing "invoice" last 30 days`

- state: `fail`
- reason: Gmail connector not built. Scenario: search inbox.
- blockedBy: `GMAIL-CONNECTOR-V1`
- owner: arch
- lawPins: `HL#5`
- nextRecommendedAction: Stage 1: build Mailpit connector + local docker container + 6 Mailpit tests (E2E-MAIL-001..006). Stage 2: build Gmail OAuth connector configured from admin dashboard. Stage 3: implement Gmail-specific scenarios here.

#### [EXTERNAL_DEPENDENCY] E2E-97 — `E2E-97-gmail-compose-with-attachment: director → email referencing sales PDF`

- state: `fail`
- reason: Gmail connector not built. Scenario: compose with attachment.
- blockedBy: `GMAIL-CONNECTOR-V1`
- owner: arch
- lawPins: `HL#5`
- nextRecommendedAction: Stage 1: build Mailpit connector + local docker container + 6 Mailpit tests (E2E-MAIL-001..006). Stage 2: build Gmail OAuth connector configured from admin dashboard. Stage 3: implement Gmail-specific scenarios here.

#### [EXTERNAL_DEPENDENCY] E2E-98 — `E2E-98-gmail-denied-low-clearance: intern lacks compose:email → Gate 03 denied`

- state: `fail`
- reason: Gmail connector not built. Scenario: denial differential at Gate 03.
- blockedBy: `GMAIL-CONNECTOR-V1`
- owner: arch
- lawPins: `HL#5`
- nextRecommendedAction: Stage 1: build Mailpit connector + local docker container + 6 Mailpit tests (E2E-MAIL-001..006). Stage 2: build Gmail OAuth connector configured from admin dashboard. Stage 3: implement Gmail-specific scenarios here.

#### [EXTERNAL_DEPENDENCY] E2E-99 — `E2E-99-gmail-compose-secure-data-denied: analyst → email OCT-CONFIDENTIAL → NVG denied`

- state: `fail`
- reason: Gmail connector not built. Scenario: NVG denial on OCT-CONFIDENTIAL outbound.
- blockedBy: `GMAIL-CONNECTOR-V1`
- owner: arch
- lawPins: `HL#6`, `HL#10`
- nextRecommendedAction: Stage 1: build Mailpit connector + local docker container + 6 Mailpit tests (E2E-MAIL-001..006). Stage 2: build Gmail OAuth connector configured from admin dashboard. Stage 3: implement Gmail-specific scenarios here.

#### [EXTERNAL_DEPENDENCY] E2E-100 — `E2E-100-gmail-multi-step-research-then-compose: ceo → research + classify + compose`

- state: `fail`
- reason: Gmail connector not built. Scenario: multi-step research+compose.
- blockedBy: `GMAIL-CONNECTOR-V1`
- owner: arch
- lawPins: `HL#5`, `HL#6`, `HL#11`
- nextRecommendedAction: Stage 1: build Mailpit connector + local docker container + 6 Mailpit tests (E2E-MAIL-001..006). Stage 2: build Gmail OAuth connector configured from admin dashboard. Stage 3: implement Gmail-specific scenarios here.

### `tests/e2e/11-rbac-differentials.e2e.test.ts`

#### [UNIMPLEMENTED_TEST_BODY] E2E-101 — `E2E-101-secret-data-access: janitor denied vs vp allowed`

- state: `fail`
- reason: RBAC differential body not written. Scenario: janitor denied vs vp allowed on secret data.
- blockedBy: `E2E-RBAC-DIFFERENTIALS-CATALOG`
- owner: builder
- lawPins: `HL#5`, `HL#10`
- nextRecommendedAction: Loop the same prompt across the relevant ladder roles; assert the lower role denial vs the higher role allowance. No external dependency.

#### [PRODUCT_RUNTIME] E2E-102 — `E2E-102-bulk-delete: analyst denied vs vp Gate 05 approval`

- state: `fail`
- reason: Bulk delete depends on NXS dispatch bridge (see E2E-23) + approval flow.
- blockedBy: `NXS-DISPATCH-BRIDGE-RETURNS-NULL`
- owner: arch
- lawPins: `HL#5`, `HL#15`

#### [UNIMPLEMENTED_TEST_BODY] E2E-103 — `E2E-103-policy-override-attempt: manager+ceo both denied without SigningCouncil 2-of-2`

- state: `fail`
- reason: RBAC differential body not written. Scenario: SigningCouncil 2-of-2 requirement.
- blockedBy: `E2E-RBAC-DIFFERENTIALS-CATALOG`
- owner: builder
- lawPins: `HL#15`
- nextRecommendedAction: Loop the same prompt across the relevant ladder roles; assert the lower role denial vs the higher role allowance. No external dependency.

#### [UNIMPLEMENTED_TEST_BODY] E2E-104 — `E2E-104-cross-system-confidential: intern denied vs sr_analyst allowed`

- state: `fail`
- reason: RBAC differential body not written. Scenario: cross-system OCT differential.
- blockedBy: `E2E-RBAC-DIFFERENTIALS-CATALOG`
- owner: builder
- lawPins: `HL#5`, `HL#10`
- nextRecommendedAction: Loop the same prompt across the relevant ladder roles; assert the lower role denial vs the higher role allowance. No external dependency.

#### [UNIMPLEMENTED_TEST_BODY] E2E-105 — `E2E-105-firewall-egress-denied-by-role: janitor → frontier denied at NVG`

- state: `fail`
- reason: RBAC differential body not written. Scenario: NVG firewall egress denial.
- blockedBy: `E2E-RBAC-DIFFERENTIALS-CATALOG`
- owner: builder
- lawPins: `HL#6`
- nextRecommendedAction: Loop the same prompt across the relevant ladder roles; assert the lower role denial vs the higher role allowance. No external dependency.

#### [UNIMPLEMENTED_TEST_BODY] E2E-106 — `E2E-106-bulk-pull-risk-ceiling: analyst → 10k row pull denied (medium < bulk:high)`

- state: `fail`
- reason: Risk-ceiling differential. Body not written. No external dependency — Gate 04 denies before connector.
- blockedBy: `E2E-RBAC-DIFFERENTIALS-CATALOG`
- owner: builder
- lawPins: `HL#5`, `HL#10`

#### [UNIMPLEMENTED_TEST_BODY] E2E-107 — `E2E-107-chain-depth-ceiling: sr_analyst → chain > maxChainDepth denied`

- state: `fail`
- reason: RBAC differential body not written. Scenario: chain-depth ceiling denial.
- blockedBy: `E2E-RBAC-DIFFERENTIALS-CATALOG`
- owner: builder
- lawPins: `HL#4`, `HL#5`
- nextRecommendedAction: Loop the same prompt across the relevant ladder roles; assert the lower role denial vs the higher role allowance. No external dependency.

#### [UNIMPLEMENTED_TEST_BODY] E2E-108 — `E2E-108-environment-mismatch: analyst dev → prod target denied`

- state: `fail`
- reason: RBAC differential body not written. Scenario: environment-tag mismatch.
- blockedBy: `E2E-RBAC-DIFFERENTIALS-CATALOG`
- owner: builder
- lawPins: `HL#5`
- nextRecommendedAction: Loop the same prompt across the relevant ladder roles; assert the lower role denial vs the higher role allowance. No external dependency.

#### [UNIMPLEMENTED_SURFACE] E2E-109 — `E2E-109-external-facing-action: vp → Gate 04 approval flow`

- state: `fail`
- reason: Approval flow surface (Gate 04 require_approval → Gate 05 approval → Gate 06 grant) not exercised end-to-end via HTTP. Body needs harness helper for approval.
- blockedBy: `E2E-APPROVAL-FLOW-V1`
- owner: builder
- lawPins: `HL#5`, `HL#15`
- nextRecommendedAction: Build harness.respondToApproval(runId, decision) helper. Then write the approval roundtrip body.

#### [UNIMPLEMENTED_SURFACE] E2E-110 — `E2E-110-revoked-mid-run: sr_analyst → mid-run RBAC revoke → claim drift`

- state: `fail`
- reason: No admin endpoint to revoke a capability mid-run. Three options open for owner ratification: (A) test-only harness route gated by NODE_ENV=test, (B) production POST /workspace/admin/principals/<id>/revoke signed mutation, (C) defer.
- blockedBy: `ADMIN-REVOKE-ENDPOINT-V1`
- owner: owner
- lawPins: `HL#14`, `HL#15`
- nextRecommendedAction: Owner ratification needed. Default proposal: (A) for the wall, (B) as a follow-on F4.9 patch.

### `tests/e2e/12-hard-law-surfaces.e2e.test.ts`

#### [UNIMPLEMENTED_TEST_BODY] E2E-112 — `E2E-112-hl4-orch-no-kill: planner unable to resolve → callback (not deny)`

- state: `fail`
- reason: HL#4 — orch never kills. Body not written.
- blockedBy: `E2E-CALLBACK-FLOW`
- owner: builder
- lawPins: `HL#4`

#### [UNIMPLEMENTED_SURFACE] E2E-118 — `E2E-118-hl14-claim-drift: mid-run RBAC change halts with claim_drift_detected`

- state: `fail`
- reason: Same blocker as E2E-110 — no admin endpoint to revoke a capability mid-run.
- blockedBy: `ADMIN-REVOKE-ENDPOINT-V1`
- owner: owner
- lawPins: `HL#14`

---

## Failure-class taxonomy reference

- `UNIMPLEMENTED_TEST_BODY`
- `HARNESS_BUG`
- `INFRA_MISSING`
- `CONNECTOR_MISSING`
- `EXTERNAL_DEPENDENCY`
- `PRODUCT_RUNTIME`
- `LAW_VIOLATION`
- `SPEC_DRIFT`
- `UNIMPLEMENTED_SURFACE`
- `FLAKE`

Source: `tests/e2e/_acceptance/failure.ts`. Repair-mode priority follows owner ratification — typically PRODUCT_RUNTIME and LAW_VIOLATION before UNIMPLEMENTED_*.

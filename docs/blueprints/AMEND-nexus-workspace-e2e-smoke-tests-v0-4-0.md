# AMEND — Nexus Workspace E2E Smoke Suite v0.4.0 (the Wall)

**Version:** v0.4.0
**Status:** RATIFIED — supersedes v0.3.0 scaffold; "the production-jump wall the next session inherits"
**Date:** 2026-05-20
**Owner:** James Huson / Lake Area LLC
**Author:** Claude (post-Phase-B audit fallout — 120-test rebuild)
**Base commit:** post-`8fef4e0` (Patch 37 reverted)
**Outline pin:** docs/alignment/nexus-component-outline-v0-1-0.md §1 Hard Laws (all 16), §3 every module, §5 Run Types, §6 End-to-End Flow
**Supersedes:** AMEND-nexus-workspace-e2e-smoke-tests-v0-3-0.md (30 stubs scaffolded, never implemented)

---

## §0 Disposition — the wall

v0.3.0 scaffolded 30 e2e tests as a "Phase B follow-on" deferral. No bodies landed. The audit-fallout pattern that motivated this rewrite: every Phase B governance patch shipped GREEN ci:gate while the actual run path crashed deterministically for the shipped dev-admin seed (Patch 28 firewall_rights empty default + Patch 31 turn-0 chat provenance, both of which a single live run would have caught).

**v0.4.0 raises the bar.** 120 tests. Every test runs against the real composition root with a fresh sqlite+jsonl per suite. Every run type, every Hard Law surface, every capability tier from janitor to CEO. No mocks of governance components (NXS pipeline, NVG service, SigningCouncil, BakedDelegationMint, ClaimVerifier, policy evaluator, mailbox, compile assembler all run for real).

**The wall is the production-jump precondition.** No further governance work lands before the wall is green. The wall sits in CI as `pnpm test:e2e` and gates every PR through `GOV-E2E-COVERAGE`.

**Hard Laws this spec preserves (all 16):** every test asserts at least one Hard Law invariant; the suite collectively covers all 16.

**Audit findings closed:** P0-046, P1-001, P1-006, P1-008, P1-014 (test-coverage-gap class); the Patch-37-class production-runtime gaps that prompted this rewrite are addressed by the wall existing (next session that ships a regression watches it die in CI before merge).

---

## §1 Scope

In scope (V1):
- 120 e2e tests organized in 12 categories of 10 each (§3).
- 10 user-capability seeds: janitor → intern → analyst → sr_analyst → manager → sr_manager → director → vp → executive → ceo (§2).
- Test harness that boots a real composition root per suite, supports user impersonation, run issuance, run-closed assertions, ledger projection reads (§4).
- `pnpm test:e2e` script + `vitest.e2e.config.ts` configuration.
- `GOV-E2E-COVERAGE` ci:gate step that fails if any of the 12 mandatory categories is missing a test.
- Gmail stub connector for the compose/read tests until a real OAuth wire lands.
- Postgres dataset extension — `infra/postgres-init/sales-finance/002_e2e_fixtures.sql` + `infra/postgres-init/warehouse/002_e2e_fixtures.sql` — rows the multi-source merge tests pull against.

Out of scope:
- Real OAuth-backed Gmail (stub only; ratification before production).
- Browser-driven UI tests (Playwright / Cypress) — the suite is API-level. UI tests are a separate arc.
- Performance / latency benchmarks (separate from correctness).
- Multi-tenant deployment (V1 is single-tenant).

---

## §2 The 10 user seeds (capability ladder)

Each seed registers (a) a Principal in PrincipalRegistry, (b) an Actor in ActorRegistry, (c) an associated API key in `keys/users/<role>.apikey`. Capabilities ladder upward: a higher-rank role's allowed-set is a strict superset of the rank below in every dimension. This makes RBAC denial differentials assertable.

| # | Role | actorClass | octLevel | maxRiskTier | allowedSystems | permittedRunTypes | firewallTransitRights | allowedCapabilities |
|---|---|---|---|---|---|---|---|---|
| 1 | **janitor** | HUMAN_OPERATOR | OCT-OPEN | low | (none) | chat | outbound: ['public'], inbound: ['public'] | search:public |
| 2 | **intern** | HUMAN_OPERATOR | OCT-OPEN | low | (none) | chat | outbound: ['public','internal'], inbound: ['public','internal'] | search:public, summarize:content |
| 3 | **analyst** | HUMAN_OPERATOR | OCT-OPEN | medium | sales-finance (read) | chat, sectioned | outbound: ['public','internal'], inbound: ['public','internal'] | + read:record:single, query:data |
| 4 | **sr_analyst** | HUMAN_OPERATOR | OCT-CONFIDENTIAL | medium | sales-finance, warehouse (read) | chat, sectioned | outbound: ['public','internal','confidential'], inbound: ['public','internal','confidential'] | + read:record:bulk, search:data, synthesize:content |
| 5 | **manager** | HUMAN_OPERATOR | OCT-CONFIDENTIAL | high | sales-finance, warehouse (read, write) | chat, sectioned, secure_rails | (same as sr_analyst) | + create:record:internal, update:record:single |
| 6 | **sr_manager** | HUMAN_OPERATOR | OCT-CONFIDENTIAL | high | + gmail (compose, read) | (same) | (same) | + compose:email, read:email |
| 7 | **director** | HUMAN_OPERATOR | OCT-CONFIDENTIAL | high | (same as sr_manager) | + autonomous | (same) | + update:record:bulk, delete:record:single |
| 8 | **vp** | HUMAN_OPERATOR | OCT-SECURE | critical | (all connectors, read+write+delete) | (all run types) | outbound: ['public','internal','confidential','secret'], inbound: ['public','internal','confidential','secret'] | + read:secret, query:secret_data |
| 9 | **executive** | HUMAN_OPERATOR | OCT-SECURE | critical | (all connectors, full CRUD + admin) | (all) | (same as vp) | + delete:record:bulk, admin:read |
| 10 | **ceo** | HUMAN_OPERATOR | OCT-SECURE | critical | (all + admin systems) | (all) | (same as vp) | + admin:write, admin:override (still gated by SigningCouncil 2-of-2 for governance mutations) |

**Notes:**
- The CEO's `admin:override` does NOT bypass SigningCouncil — admin mutations still require 2 distinct admin signatures per Q4. The override only widens the per-user gate scope, not the federation threshold.
- Every seed populates `Principal.firewallTransitRights` explicitly with real data-class arrays. Legacy widening (the Patch 28 / F4.15 pattern) is no longer needed for these principals — they're new seeds, all fields present. The widening pattern stays in nexus-main.ts as a transitional safety net for OLDER principals that may still exist in customer SQLite (audit event `delegation_user_claims_widened` still fires so RBAC migration sees them).
- API keys live at `keys/users/<role>.apikey` (0600 perms, gitignored). `pnpm nexus init` generates them; tests load from there.

**File: `packages/workspace-ref/src/bootstrap/user-seeds.ts`** — exports `register10UserSeeds(deps)`; called from workspace bootstrap. Idempotent.

---

## §3 The 120 tests — 12 categories of 10

Every test ID: `E2E-<NN>-<short_slug>`. Every test asserts:
1. **Final ledger event** matches expected `final_response` outcome (`executed`/`denied_*`/`callback_pending`).
2. **Run closure reason** matches expected.
3. **Gate trail** in `runs/<runId>/ledger.jsonl` contains the expected gate-by-gate decisions.
4. At least **one named Hard Law** invariant.

### §3.1 Chat on-prem (single agent, no contract) — 10 tests
Run shape: `WorkspacePromptInput{promptMode:'free_text', workspaceSocketId:'nexus-chat-default', prompt, agents:[chatAgent]}`. Expected: planner emits single-node plan, NVG routes to `on_prem_general` (Ollama qwen2.5:1.5b), agent synthesize, compile pass-through (HL #11), return.

| ID | Actor | Prompt | Hard Laws asserted |
|---|---|---|---|
| E2E-01-chat-baseline | intern | "who are you?" | HL #7 LLMs see only their slice; HL #11 compile pass-through |
| E2E-02-chat-time | intern | "what time is it where you are?" | HL #7; HL #11 |
| E2E-03-chat-math | intern | "what is 17 times 23?" | HL #7 |
| E2E-04-chat-summarize | analyst | "summarize the following in one sentence: the quick brown fox jumps over the lazy dog repeatedly" | HL #7; HL #11 |
| E2E-05-chat-translate | analyst | "translate 'hello world' to French" | HL #7 |
| E2E-06-chat-poem | sr_analyst | "write a short haiku about quarterly reports" | HL #7 |
| E2E-07-chat-explain | manager | "explain the difference between bills receivable and bills payable" | HL #7 |
| E2E-08-chat-list | manager | "list five qualities of a good operations manager" | HL #7 |
| E2E-09-chat-define | sr_manager | "define 'inventory turnover' in two sentences" | HL #7 |
| E2E-10-chat-followup-pretrained-knowledge | director | "describe the typical lifecycle of a purchase order" | HL #7 |

### §3.2 Chat frontier (single agent, no contract, requires online search) — 10 tests
Run shape: same as §3.1 but agent is paired with `frontier_general` adapter (Claude-3-5 or OpenAI). NVG should route based on policy + healthy-endpoint to a frontier tier. Tests assert `nvg_outbound` event's `modelTierSelected === 'frontier_general'`.

| ID | Actor | Prompt | Hard Laws |
|---|---|---|---|
| E2E-11-frontier-search-news | analyst | "what is the current price of Bitcoin?" (frontier knows; on-prem won't) | HL #6 NVG firewall transit |
| E2E-12-frontier-yahoo-biggest-movers | analyst | "search yahoo finance for today's biggest movers in the S&P 500 and list the top three" | HL #6 |
| E2E-13-frontier-current-events | manager | "what major tech news happened this week?" | HL #6 |
| E2E-14-frontier-weather | sr_manager | "what's the weather in San Francisco right now?" | HL #6 |
| E2E-15-frontier-stock-quote | director | "give me the current stock price of AAPL with day's change" | HL #6 |
| E2E-16-frontier-research | vp | "summarize the top three findings from this week's IMF economic outlook" | HL #6 |
| E2E-17-frontier-citation | vp | "cite three peer-reviewed papers on inventory optimization from the last five years" | HL #6 |
| E2E-18-frontier-compare-models | executive | "compare GPT-4 and Claude 3.5 Sonnet for business analytics use cases" | HL #6 |
| E2E-19-frontier-fact-check | executive | "is it true that Tesla's Q3 2024 deliveries beat estimates?" | HL #6 |
| E2E-20-frontier-deep-dive | ceo | "give me a five-paragraph briefing on the global semiconductor supply chain in 2026" | HL #6 |

### §3.3 Single-agent NXS dispatch (target system read) — 10 tests
Run shape: `WorkspacePromptInput` with prompt that maps to an NXS dispatch node (sales-finance or warehouse postgres). Planner emits `nxs_dispatch` node, NXS Gates 01-07 evaluate, connector pulls rows, mailbox holds result, compile pass-through wraps, return.

| ID | Actor | Prompt | Connector | Expected gate flow |
|---|---|---|---|---|
| E2E-21-nxs-sales-list-orders | analyst | "pull last 7 days of sales orders" | postgres-sales-finance | Gates 01-07 allow |
| E2E-22-nxs-sales-by-customer | analyst | "list sales orders for customer 'acme-corp' in the last month" | postgres-sales-finance | allow |
| E2E-23-nxs-warehouse-inventory-snapshot | sr_analyst | "what is the current quantity-on-hand for SKU 'WIDGET-100'?" | postgres-warehouse | allow |
| E2E-24-nxs-warehouse-low-stock | sr_analyst | "list every SKU with on-hand quantity less than 50" | postgres-warehouse | allow |
| E2E-25-nxs-sales-top-customers | manager | "list top 10 customers by revenue last quarter" | postgres-sales-finance | allow |
| E2E-26-nxs-sales-bulk-pull | sr_manager | "export all orders shipped between 2026-01-01 and 2026-03-31" (bulk → high risk) | postgres-sales-finance | Gate 02 risk OK for sr_manager, denied at lower role |
| E2E-27-nxs-warehouse-reorder-list | director | "list every SKU due for reorder this week based on velocity" | postgres-warehouse | allow |
| E2E-28-nxs-sales-delete-denied-for-analyst | analyst | "delete order ORD-12345" | (none — delete not in analyst capability) | Gate 03 denies — analyst lacks delete:record:single |
| E2E-29-nxs-warehouse-update-bulk-allowed-for-manager | manager | "mark every order in batch B-2026-04 as shipped" | postgres-warehouse | Gate 03 allows — manager has update:record:bulk; Gate 04 may require approval |
| E2E-30-nxs-sales-delete-allowed-for-vp | vp | "delete the duplicate order ORD-99999" | postgres-sales-finance | Gate 04 may require approval (Gate 05); approve → allow |

### §3.4 Multi-agent, no output contract — 10 tests
Run shape: `subTasks: [...]` declares 2+ nodes; each agent does its thing; results land in mailbox per actor; compile pass-through emits a bundle FinalResponseArtifact (HL #11 + multi-item per F4.12). No output contract template.

| ID | Actor | Subtasks (agents) | Hard Laws |
|---|---|---|---|
| E2E-31-multi-chat-fan-out | sr_analyst | analyst-bot, summary-bot: each writes a 1-line opinion on "what's the most important business metric?" | HL #8 mailbox isolation |
| E2E-32-multi-domain-experts | manager | finance-bot, ops-bot: each summarizes own area | HL #8 |
| E2E-33-multi-language-pair | sr_manager | english-bot, french-bot: same prompt different language outputs | HL #7 (agent gets only its slice) |
| E2E-34-multi-tone | director | formal-bot, casual-bot: same content different tones | HL #7 |
| E2E-35-multi-judge-format | director | response-bot, judge-bot: response writes, judge scores | HL #7 |
| E2E-36-multi-fact-fact-judge | vp | fact1-bot, fact2-bot, judge-bot: gather then evaluate | HL #11 multi-item pass-through |
| E2E-37-multi-2x-parallel-pull | manager | sales-pull-agent, warehouse-pull-agent: parallel NXS pulls, both into compile mailbox | HL #5 NXS sole action authority |
| E2E-38-multi-translate-pair | sr_manager | en-fr-bot, en-es-bot: parallel translations | HL #8 |
| E2E-39-multi-perspective-shootout | vp | exec-bot, analyst-bot, intern-bot: same prompt different audiences | HL #11 |
| E2E-40-multi-no-contract-bundle-shape | executive | chat-bot-a, chat-bot-b: bundle FinalResponseArtifact carries both items | HL #11 + F4.12 multi-item |

### §3.5 Multi-agent WITH output contract — 10 tests
Run shape: same multi-agent but with `outputContractTemplateId`. Compile assembles per template — slot matching, slot validation, guard evaluation, format renderer.

| ID | Actor | Template | Run shape | Hard Laws |
|---|---|---|---|---|
| E2E-41-table-monthly-sales | analyst | `monthly_sales_table_v1` | sales-pull + format-bot | outline §6.2 worked example |
| E2E-42-prose-quarterly-review | manager | `quarterly_review_prose_v1` | sales-pull + warehouse-pull + synthesis-bot | HL #11 |
| E2E-43-mixed-prose-table | sr_manager | `exec_report_mixed_v1` | 3 agents → prose + embedded table | HL #11 |
| E2E-44-file-bundle | director | `monthly_files_bundle_v1` | 2 NXS pulls → file bundle | HL #11 |
| E2E-45-guarded-confidential | vp | `secure_report_v1` (guards reject if any item has OCT-SECURE label without VP+) | mixed agents | HL #10 fail-closed |
| E2E-46-judge-decision-table | director | `judge_decision_table_v1` | response-bot + judge-bot → row of judgments | HL #11 |
| E2E-47-multi-source-merge | sr_manager | `multi_source_merge_v1` | sales-pull + warehouse-pull + merge-bot → unified table | HL #8 mailbox per actor |
| E2E-48-citation-formatted | vp | `cited_research_v1` | research-bot + cite-bot → APA-formatted citations | HL #11 |
| E2E-49-email-draft | sr_manager | `email_draft_v1` | composer-bot → email body + subject lines | HL #11 |
| E2E-50-financial-summary-template | executive | `quarterly_financial_summary_v1` | sales-pull + warehouse-pull + finance-bot → assembled board doc | HL #11 |

### §3.6 Multi-agent MIXED on-prem + frontier — 10 tests
Run shape: planner emits one node paired with `on_prem_general`, another paired with `frontier_general`. NVG routes per node. Mailbox carries between turns.

| ID | Actor | Layout | Hard Laws |
|---|---|---|---|
| E2E-51-onprem-then-frontier | sr_analyst | onprem-summarize → frontier-elaborate | HL #6 NVG tier-routing per node |
| E2E-52-frontier-then-onprem | sr_manager | frontier-research → onprem-summarize | HL #6 |
| E2E-53-mixed-parallel | manager | onprem-A + frontier-B → judge-bot | HL #6 |
| E2E-54-3-stage-mixed | director | onprem → frontier → onprem-format | HL #6 + HL #7 |
| E2E-55-mixed-with-nxs | sr_manager | nxs-pull → onprem-summarize → frontier-polish | HL #5 + #6 |
| E2E-56-mixed-with-output-contract | vp | frontier-research + onprem-pull → assembled board doc | HL #6 + #11 |
| E2E-57-mixed-translation-pair | vp | onprem-en-fr + frontier-en-zh → unified | HL #6 |
| E2E-58-mixed-cost-routing-check | executive | tier-pinned tests: low-cost path runs on-prem, high-cost path runs frontier per policy | HL #6 |
| E2E-59-mixed-fallback | director | frontier unhealthy → NVG falls back to on-prem within ceiling per policy | HL #6 |
| E2E-60-mixed-denied-by-tier-ceiling | analyst | analyst with no frontier rights → tries to invoke frontier agent → denied at NVG Gate | HL #6 |

### §3.7 Multi-agent BRANCHING (frontier → on-prem → multi → compile) — 10 tests
Run shape: most-complex layout. Frontier starts (research), on-prem branches into 2-3 parallel agents (domain work), then compile assembles with output contract.

| ID | Actor | Layout | Hard Laws |
|---|---|---|---|
| E2E-61-frontier-then-fan-out | sr_manager | frontier-survey → fan-out [sales-onprem, warehouse-onprem, ops-onprem] → judge → compile | HL #4 orch routes; HL #8 mailboxes |
| E2E-62-research-then-merge | director | frontier-news → onprem-extract + onprem-classify → merge-bot → compile | HL #4 |
| E2E-63-trend-detect-then-action | vp | frontier-trend → onprem-validate → onprem-action-plan → compile | HL #5 |
| E2E-64-multi-loop-deep | executive | frontier → onprem → onprem (deeper) → onprem (deepest) → compile | HL #4 |
| E2E-65-branching-with-output | ceo | 4-agent fan-out + output contract `executive_briefing_v1` | HL #4 + #11 |
| E2E-66-3-stage-with-callback | vp | first stage triggers planner callback (ambiguous next-agent set) → user picks → continue | HL #4 callback never kill |
| E2E-67-branching-with-secure-rail | ceo | one branch handles OCT-SECURE data via secure_rails run type, merges back | HL #10 |
| E2E-68-conditional-branch | director | judge-bot decides which downstream agent to run based on confidence | HL #4 |
| E2E-69-second-run-trigger | vp | first run produces a result that needs another target-system touch → orch opens new run with `checkbackSourceRunId` | HL #12 |
| E2E-70-branching-with-output-contract-and-mixed-tier | ceo | frontier survey + multi-onprem extract + frontier polish + compile template `board_doc_v1` | HL #11 |

### §3.8 Batch file pull + LLM summary — 10 tests
Run shape: NXS pulls a batch of N rows/files, mailbox holds them, agent summarizes, compile pass-through or template.

| ID | Actor | Batch | Output |
|---|---|---|---|
| E2E-71-batch-50-orders | analyst | 50 sales orders | one-paragraph summary |
| E2E-72-batch-100-invoices | manager | 100 invoices | top 5 anomalies report |
| E2E-73-batch-warehouse-receipts | sr_analyst | 30 days of receipts | shortage forecast |
| E2E-74-batch-customer-tickets | sr_manager | 200 support tickets | category breakdown |
| E2E-75-batch-merged-files | director | sales-pull(50) + warehouse-pull(50) → merge → summary | HL #11 |
| E2E-76-batch-with-output-contract | vp | 100 rows → template `batch_summary_v1` | HL #11 |
| E2E-77-batch-classified | director | 50 confidential rows + 50 internal rows → NVG case-split classification | F4.11 |
| E2E-78-batch-with-tamper | sr_manager | 50 rows, one item tampered → bypass partial (F4.12 quarantine) | F4.12 |
| E2E-79-batch-with-callback | manager | batch too large → callback "limit to N or proceed" | HL #4 callback |
| E2E-80-batch-denied-by-oct | analyst | tries to pull a batch of OCT-CONFIDENTIAL files → Gate 02 denies | HL #10 |

### §3.9 Multi-source merge + cross-system report — 10 tests
Run shape: 2+ NXS pulls from DIFFERENT connectors (sales-finance + warehouse), agent merges, output contract or pass-through.

| ID | Actor | Merge logic | Output |
|---|---|---|---|
| E2E-81-quarterly-coverage | sr_manager | sales(orders) + warehouse(inventory) → "can we cover Q2 orders?" | yes/no + justification |
| E2E-82-stockout-risk | manager | sales(velocity) + warehouse(qty-on-hand) → SKUs at risk this month | table |
| E2E-83-reorder-recommendations | sr_manager | sales(forecast) + warehouse(qty) → reorder plan | table |
| E2E-84-customer-shipping-perf | manager | sales(orders) + warehouse(ship_dates) → on-time-shipping report | prose |
| E2E-85-sku-margin-analysis | director | sales(prices) + warehouse(costs) → margin-by-SKU table | table |
| E2E-86-quarterly-forecast | vp | sales(history) + warehouse(capacity) + frontier-trends → Q2 forecast | mixed |
| E2E-87-anomaly-detect | sr_manager | sales(refunds) + warehouse(returns) → anomaly list | report |
| E2E-88-supply-chain-snapshot | director | sales(open) + warehouse(reserved) + warehouse(in_transit) → board snapshot | template |
| E2E-89-margin-by-region | vp | sales(by_region) + warehouse(costs_by_region) → margin table | template |
| E2E-90-cross-system-audit | ceo | sales(deltas) + warehouse(deltas) → reconciliation report | secure_rails |

### §3.10 Gmail compose / read — 10 tests
Run shape: gmail connector (stub for now, real-OAuth-ratified later). Compose builds a draft from prompt; read pulls recent threads with classification.

| ID | Actor | Verb | Behavior |
|---|---|---|---|
| E2E-91-gmail-compose-draft | sr_manager | compose | draft an email to ops@ about Q2 numbers; output = draft body + subject |
| E2E-92-gmail-read-inbox | sr_manager | read | pull last 10 inbox threads; output = subject + sender + snippet |
| E2E-93-gmail-compose-from-batch | director | compose | given a batch of order issues, draft customer follow-ups |
| E2E-94-gmail-compose-multi-recipient | vp | compose | draft a board update with 5 recipients |
| E2E-95-gmail-read-classify | director | read | pull recent inbox, classify each by topic |
| E2E-96-gmail-search | sr_manager | search | search for emails containing "invoice" in the last 30 days |
| E2E-97-gmail-compose-with-attachment | director | compose | draft email with reference to a sales PDF (attachment ID) |
| E2E-98-gmail-denied-low-clearance | intern | compose | intern lacks compose:email → Gate 03 denies |
| E2E-99-gmail-compose-secure-data-denied | analyst | compose | analyst tries to email an OCT-CONFIDENTIAL row → NVG firewall denies outbound |
| E2E-100-gmail-multi-step-research-then-compose | ceo | research+compose | frontier-research + onprem-classify + gmail-compose → board email with citations |

### §3.11 RBAC / OCT denial differentials — 10 tests
Same prompt across roles; assert higher-rank-allows, lower-rank-denies. Proves the capability ladder + signed gate path.

| ID | Roles tested | Prompt | Expected |
|---|---|---|---|
| E2E-101-secret-data-access | janitor vs vp | "show me the executive comp table" | janitor denied (no read:secret); vp allowed |
| E2E-102-bulk-delete | analyst vs vp | "delete all archived orders from Q1" | analyst denied at Gate 03; vp allowed but Gate 05 approval |
| E2E-103-policy-override-attempt | manager vs ceo | "modify the policy bundle to allow X" | both denied unless via SigningCouncil 2-of-2 (Q4) |
| E2E-104-cross-system-confidential | intern vs sr_analyst | "pull confidential warehouse audit log" | intern denied (no read:record + no OCT-CONFIDENTIAL); sr_analyst allowed |
| E2E-105-firewall-egress-denied-by-role | janitor | "send this to a frontier LLM" | janitor lacks outbound:['internal'+] → NVG Gate denies |
| E2E-106-bulk-pull-risk-ceiling | analyst | "pull 10000 rows from sales" | Gate 02 denies (riskCeiling: medium < bulk:high) |
| E2E-107-chain-depth-ceiling | sr_analyst | run that requires chainDepth > sr_analyst's maxChainDepth | Gate 03 denies |
| E2E-108-environment-mismatch | analyst (dev env) | targets system in prod env | Gate 01/03 mismatch denied |
| E2E-109-external-facing-action | vp | external-facing write requires Gate 04 approval | Gate 05 approval flow |
| E2E-110-revoked-mid-run | sr_analyst | mid-run RBAC revoke for sales-finance | Gate 03 detects claim drift → denial (HL #14) |

### §3.12 Hard Law surfaces (the explicit governance gates) — 10 tests
Each test targets one Hard Law's enforcement surface directly. Asserts the gate fires, the right denial code lands, the right ledger event is written.

| ID | Hard Law | Test |
|---|---|---|
| E2E-111-hl1-auth-first | HL #1 | request with no auth → 401 from IAM before any gate |
| E2E-112-hl4-orch-no-kill | HL #4 | planner can't resolve → callback (not denial); user accepts → run continues |
| E2E-113-hl5-nxs-only-action-auth | HL #5 | agent tries to invoke NXS bypass via mailbox-side-channel → blocked at agent runtime |
| E2E-114-hl6-nvg-sole-llm-auth | HL #6 | agent tries to invoke LLM directly without NVG → blocked at agent runtime |
| E2E-115-hl7-llm-no-tool-descriptors | HL #7 | NVG dispatch carries zero tool descriptors to LLM (verified in nvg_outbound payload) |
| E2E-116-hl8-mailbox-only-data-hub | HL #8 | actor A mailbox NOT readable by actor B in same run; cross-mailbox attempt fails |
| E2E-117-hl11-compile-passthrough | HL #11 | single-agent + no contract = compile forwards verbatim (digest check, no rendering) |
| E2E-118-hl14-claim-drift | HL #14 | mid-run RBAC change detected at Gate 02 → run halts with `claim_drift_detected` |
| E2E-119-hl15-symmetric-intersection | HL #15 | per-dimension intersection on a real differential: user reads sales+warehouse, agent reads sales only → effective is sales only |
| E2E-120-hl16-agent-touches-only-mailboxes | HL #16 | agent tries to call NXS/NVG/ledger directly → blocked at runtime |

---

## §4 Test harness

**Location:** `tests/e2e/harness.ts`

**Contract:**

```ts
export interface E2EHarness {
  readonly baseUrl: string;            // http://127.0.0.1:<dynamic port>
  readonly cwd: string;                // ledger/mailbox cwd (mode-dependent)
  shutdown(): Promise<void>;
  jwtFor(role: UserRole): Promise<string>;
  elevatedSessionFor(role: UserRole, jwt: string): Promise<string>;
  createRun(jwt: string, body: WorkspaceRunRequestBody): Promise<{ runId: Uuid; planPreview: OrchestratorPlanPreview }>;
  resolveCheckback(jwt: string, runId: Uuid, decision: boolean | { picked: NonEmpty }): Promise<void>;
  waitForRunClosed(jwt: string, runId: Uuid, opts?: { timeoutMs?: number }): Promise<RunClosedSnapshot>;
  readLedger(runId: Uuid): Promise<readonly RunLedgerEntry[]>;
  readMailboxItems(runId: Uuid): Promise<readonly MailboxItem[]>;
}

export async function bootHarness(opts?: {
  startupTimeoutMs?: number;
  verbose?: boolean;
  mode?: 'isolated' | 'shared'; // default: auto-detect from env
}): Promise<E2EHarness>;
```

### §4.1 Two execution modes (CANONICAL — both first-class designs)

The harness supports two modes. Test bodies are mode-agnostic — they call `bootHarness()` and the harness auto-detects which mode to run in based on the `NEXUS_E2E_BASE_URL` env variable.

#### Shared mode — production-shape default

**Slogan:** *one Nexus server, many users/personas/runs concurrently.*

This is how Nexus is actually deployed and used. A single long-lived server hosts every persona, every concurrent run, every NXS dispatch and NVG inference for the entire wall. Triggered by `vitest.e2e.shared.config.ts` (script: `pnpm test:e2e:shared`), which wires a globalSetup at `tests/e2e/_shared/global-setup.ts` to:

1. mkdtemp a fresh shared cwd
2. Symlink `keys/`, `config/`, `fixtures/` from the repo
3. Spawn ONE `pnpm nexus serve` subprocess
4. Wait for `/health`
5. Export `NEXUS_E2E_BASE_URL` + `NEXUS_E2E_SERVER_CWD` into the env
6. After the wall, SIGTERM the server and rm the tmpdir

Cross-test isolation is enforced by the **runtime**, not by the harness:

- Every run has a server-minted UUID (no collision)
- Per-(runId, actorId) mailbox storage (HL#8 — proven by E2E-116; per-runId JSONL files at `runs/mailbox/<runId>.jsonl`)
- Per-event `runId`-keyed ledger filtering (the infra run-ledger is one shared JSONL; `readRunEvents` filters by runId)
- HTTP run-status scope (a workspace JWT for user A cannot read user B's `/workspace/runs/:runId`)
- Symmetric delegation intersection (HL#15 — proven by E2E-119; agents scope independently of broader user claims)

`tests/e2e/14-shared-harness-concurrency.e2e.test.ts` is the canonical proof — 7 cases covering login parity, unique runIds, mailbox isolation, cross-user run scope, ledger runId filtering, per-run final_response, and per-principal NXS scopes under simultaneous dispatch.

#### Isolated mode — forensic-debug fallback

Each test file spawns its own `pnpm nexus serve` subprocess against a fresh tmpdir. Triggered by `vitest.e2e.config.ts` (script: `pnpm test:e2e`) — the env var is NOT set, the harness's auto-detect picks isolated.

Use this mode when investigating a single suite without any other test's state on disk. It is **not** the production-shaped default — do not confuse "isolated" with "correct." The runtime isolates concurrent users by construction; per-file spawn is a debugging convenience, not an isolation requirement.

`vitest.e2e.config.ts` excludes `tests/e2e/14-shared-harness-concurrency.e2e.test.ts` because that test's invariants only mean something against a shared server.

### §4.2 Behavior (mode-agnostic)

- `bootHarness()` returns a structured handle. In shared mode it connects to the existing server (env-supplied URL); in isolated mode it spawns one.
- `jwtFor(role)` posts to `/workspace/auth/login` with the API key from the seed; returns the workspace JWT.
- `elevatedSessionFor(role, jwt)` runs the challenge → verify cycle for admin operations.
- `createRun(jwt, body)` POSTs to `/workspace/runs` and returns the runId + planPreview from the response.
- `waitForRunClosed(jwt, runId)` polls `/workspace/runs/:runId` until `runClosed === true` OR a terminal `planner_infeasible` lands; default 90s timeout.
- `readLedger(runId)` reads `<cwd>/runs/infra.run-ledger.jsonl` directly off disk, filtered by runId.
- `readMailboxItems(runId)` reads `<cwd>/runs/mailbox/<runId>.jsonl` directly off disk.
- `shutdown()` in isolated mode SIGTERMs the subprocess + rms the tmpdir. In shared mode it is a NO-OP — the server is owned by the globalSetup, not the per-suite handle.

---

## §5 Acceptance gates (CI integration)

**`pnpm test:e2e`** — runs the 12 e2e files in tests/e2e/{01-chat-onprem,02-chat-frontier,...}/*.e2e.test.ts. Each file groups its 10 tests.

**ci:gate steps added:**

- **Step N: GOV-E2E-COVERAGE** — scans tests/e2e/ for one file per category (12 files total). Each file must contain ≥10 `it('E2E-NN-...')` test blocks. Fail if a category file is missing or has fewer than 10 tests.

- **Step N+1: GOV-E2E-PASS** — runs `pnpm test:e2e` and asserts zero failures. This is the production-jump gate.

The two new gates land in `scripts/ci-gate.ts` as `enforceGovE2eCoverage` + `enforceGovE2ePass`.

---

## §6 Phasing — what lands when

This is the WALL. Build order matters because earlier categories unblock later:

| Phase | Categories | Why first |
|---|---|---|
| **P1** | §3.12 Hard Law surfaces (E2E-111..120) | These are the structural invariants. If any fail, every other test is suspect. |
| **P2** | §3.1 Chat on-prem (E2E-01..10) | Baseline working chat — the simplest happy path. Validates harness + seeds + composition. |
| **P3** | §3.11 RBAC denial differentials (E2E-101..110) | Validates the 10-user capability ladder + Gate 02/03 path. |
| **P4** | §3.3 NXS dispatch (E2E-21..30) | Validates postgres connectors + Gate 04 policy + receipt path. |
| **P5** | §3.4 Multi-agent no-contract (E2E-31..40) | Multi-mailbox + multi-actor + compile bundle (HL #11). |
| **P6** | §3.5 Multi-agent with contract (E2E-41..50) | Template assembler + slot validator + format renderer. |
| **P7** | §3.8 Batch + summary (E2E-71..80) | Connects NXS scale path + classification. |
| **P8** | §3.9 Multi-source merge (E2E-81..90) | Cross-connector + cross-mailbox + cross-classification. |
| **P9** | §3.2 Chat frontier (E2E-11..20) | Requires frontier adapter wired with real API key — owner ratification. |
| **P10** | §3.6 Mixed tier (E2E-51..60) | Requires P9 to land. |
| **P11** | §3.7 Branching (E2E-61..70) | Requires P5-P10. |
| **P12** | §3.10 Gmail (E2E-91..100) | Requires gmail connector — stub for V1, real-OAuth post-wall ratification. |

---

## §7 Backwards compatibility

Replaces the v0.3.0 README scaffold. The scaffold directory is preserved; new test files land alongside it. No production code shape changes are required for V1 of the wall — every test runs against the existing composition root.

**Cross-spec dependencies:**
- F4.4 v0.3.0 (this spec supersedes it)
- F4.14 orch callback timeout — E2E-66 and E2E-112 assert HL #4
- F4.13 admin mutations — covered via §3.11 SigningCouncil path
- F4.15 delegation mint — E2E-119 asserts the symmetric intersection
- F4.11 NVG payload labels — E2E-77 asserts classification case-split
- F4.12 compile multi-item — E2E-40 + E2E-78 assert bundle shape + bypass-on-tamper

---

## §8 Audit closure mapping

| Finding | How closed |
|---|---|
| P0-046 | The wall is the test surface — every Hard Law has an explicit test (§3.12) |
| P1-001 | 120-test scope makes "no e2e coverage" unmappable to "future work" |
| Post-session audit failures (Patch 28 firewall_rights + Patch 31 turn-0 provenance) | E2E-01 + E2E-11 catch them in CI before any merge |
| The Patch 37 wildcard incident | The wall makes band-aid fixes impossible — every fix must keep all 120 green |

---

*End of v0.4.0. The wall starts here.*

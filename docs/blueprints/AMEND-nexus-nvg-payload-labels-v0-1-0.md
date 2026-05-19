# AMEND — Nexus NVG Payload Labels

**Version:** v0.1.0
**Status:** RATIFIED (classify-at-bind; propagate through mailbox; unknown → quarantine)
**Date:** 2026-05-19
**Owner:** James Huson / Lake Area LLC
**Author:** Claude (dangerous-mode spec rework session)
**Base commit:** 3ae197d
**Outline pin:** docs/alignment/nexus-component-outline-v0-1-0.md §3 G NVG, §3 I Mailbox, Hard Law #6
**Audit packet:** Turn 3 P0-019, Turn 4 P0-030

---

## §0 Disposition

Per Hard Law #6 and outline §3 G, NVG governs every payload crossing the firewall in either direction. Today, multiple runtime paths strip or never populate `dataLabels` at the exact point payloads cross the model wall (P0-019). Vanguard test code preserves a fail-open posture by asserting "empty labels classify as public" (P0-030). This spec ratifies the canonical label propagation law: classify-at-bind, propagate through mailbox, deny/quarantine on unknown provenance.

**Hard Laws this spec preserves:**
- **#6** NVG sole model-and-firewall governance authority.
- **#8** Mailbox is the only inter-module data hub; label propagates with item.
- **#13** Default-secure; empty labels with no trusted provenance fail closed.

**Q-rulings applied:**
- **Q3** BAKED enforcement — NVG label evaluation is baked; runtime construction of `dataLabels: []` for real payloads is a CI static gate violation.
- **Q5** Plug-ins never kill — but admin classifier plug-in is defense-in-depth at bind; baked NVG denies regardless.

**Audit findings closed:** P0-019 (Turn 3), P0-030 (Turn 4).

---

## §1 Scope

In scope (V1):
- `DataLabel` taxonomy expansion + binding semantics.
- `MailboxItem.dataLabels` mandatory population at write-time.
- NVG request body MUST carry aggregated labels from prompt slice + mailbox items + attachments.
- Empty-labels-with-trusted-binding cases enumerated and tested.
- Empty-labels-with-no-binding = deny/quarantine.
- CI static gate forbidding runtime `dataLabels: []` construction outside trusted constructors.

Out of scope:
- New data-label kinds (existing taxonomy used).
- Per-customer label DSL (V2).

---

## §2 Contract types

### §2.1 `DataLabel` (existing + binding tag)

```ts
type DataLabel =
  | { kind: 'oct'; level: OctLevel }
  | { kind: 'provenance'; source: ProvenanceSource; trusted: boolean }
  | { kind: 'pii'; category: PiiCategory }
  | { kind: 'compliance'; regime: ComplianceRegime }
  | { kind: 'arena'; arena: ArenaId };

type ProvenanceSource =
  | 'workspace_upload'    // attachment, classified at bind (Spec F4.6)
  | 'nxs_connector_result' // NXS-drop mailbox item; trusted=true
  | 'agent_output'         // agent compile-drop mailbox item; trusted=false unless agent declared trusted
  | 'planner_history'      // multi-turn chat history snippets (Spec F3a); trusted=true
  | 'unknown';             // forces quarantine
```

### §2.2 `MailboxItem.dataLabels`

```ts
interface MailboxItem {
  // ... existing fields
  readonly dataLabels: readonly DataLabel[];   // MANDATORY; empty array with non-trusted provenance => baked rejection
  readonly provenance: ProvenanceSource;
  readonly digest: HexDigest;
}
```

`dataLabels` is a required field on every mailbox item. The plug-in mailbox backend MUST reject writes with missing field; the baked NVG layer independently rejects requests built from items whose effective label set is empty AND provenance is `unknown` or `agent_output` (without trusted-agent declaration).

### §2.3 `NvgRequest.dataLabels` aggregation

```ts
interface NvgRequest {
  readonly nodeId: NodeId;
  readonly llmTier: ModelTier;
  readonly slices: readonly LlmSlice[];
  readonly dataLabels: readonly DataLabel[];    // aggregated from slices + mailbox items + attachments
  // ... existing fields
}
```

Aggregation rule: union of every `DataLabel` from every `MailboxItem` referenced by the slices, plus per-attachment labels (Spec F4.6 bind output), plus any labels the planner emitted on the prompt slice. Deduplicated by canonical comparison.

---

## §3 Runtime behavior

### §3.1 Construction (writers)

Every mailbox-item writer (NXS connector drop, NVG sandbox return, agent compile-drop, attachment materialization) MUST set `dataLabels` non-empty with provenance source. Helpers:

```ts
function nxsResultLabels(connectorResult: ConnectorResult): readonly DataLabel[] {
  // Source labels from connector metadata; never empty for real payloads.
}

function attachmentLabels(attachment: Attachment): readonly DataLabel[] {
  // From bind decision (Spec F4.6).
}

function agentOutputLabels(agentDecl: AgentDeclaration, output: AgentOutput): readonly DataLabel[] {
  // Inherit from input mailbox items + agent declaration; mark provenance=agent_output.
}
```

### §3.2 NVG classify-and-route gate

Per request:
1. Inspect aggregated `dataLabels`.
2. If labels include `oct_secure` and `llmTier` is in `frontier_*` bucket → deny with `oct_tier_mismatch`.
3. If labels include `pii.<category>` and target LLM not in compliance regime → deny.
4. If `dataLabels` is empty AND no item has provenance in `{nxs_connector_result, workspace_upload, planner_history}` (i.e., only `agent_output` with untrusted agent or `unknown`) → deny/quarantine with `unknown_provenance_payload`.
5. If `dataLabels` is empty AND all items have trusted provenance (nxs_connector_result or workspace_upload with trusted bind) → allow with floor classification `internal`.

### §3.3 Empty-labels case split (P0-030 fix)

| Case | Trusted provenance? | dataLabels | Outcome |
|------|--------------------|-----------|---------|
| Workspace upload bound to public per arena policy | yes (workspace_upload, trusted=true) | empty (no further classification) | allow with floor `internal`; log `data_label_floored_internal` |
| NXS connector result with empty server response | yes (nxs_connector_result) | empty | allow with floor `internal`; log |
| Agent output, agent declared trusted | yes (agent_output, agent.declaredTrusted=true) | empty | allow with floor `internal`; log |
| Agent output, agent not declared trusted | no | empty | deny/quarantine with `unknown_provenance_payload` |
| `provenance='unknown'` | no | any | deny/quarantine |

`public` classification is NEVER granted to empty `dataLabels` without explicit trusted-source workspace_upload AND arena policy allowing public default — that is the failure mode P0-030 documents.

### §3.4 Three-mode behavior

| Mode      | Gate behavior                                                                                       | Run continues? | Ledger writes? |
|-----------|-----------------------------------------------------------------------------------------------------|----------------|----------------|
| observe   | NVG evaluates labels; on would-deny, log `would_deny_data_labels`; payload still goes through (with caveat in receipt) | yes        | always         |
| advisory  | same as observe + workspace warning                                                                 | yes            | always         |
| enforcing | NVG denies on tier mismatch / unknown provenance; payload does not cross firewall                   | no on deny     | always         |

### §3.5 BAKED vs plug-in

- **BAKED (floor):** NVG classify-and-route gate reads `dataLabels`; aggregation rule + empty-labels case split enforced; ledger writes; CI gate ensures no runtime construction of `dataLabels: []`.
- **PLUG-IN (defense in depth):** mailbox backend rejects missing field; attachment classifier plug-in (per arena) populates labels at bind.

---

## §4 Implementation sequence

1. Add `provenance` + tightened `dataLabels` requirement to `MailboxItem` contract.
2. Update every mailbox writer to populate labels (NXS connector bridge, NVG sandbox return, agent runtime, attachment materializer).
3. Update NVG `classify-and-route` to apply §3.3 case split.
4. Update existing tests to remove fail-open assertions (P0-030 evidence: `nvg-classify-and-route.test.ts:552-560`); add the four case-split tests.
5. Add CI static gate (Spec F4.19 GOV-05).
6. Tests per §5.

---

## §5 Tests (acceptance gates)

| Gate | Purpose | Type |
|---|---|---|
| NPL-01 | Mailbox write with missing `dataLabels` field → contract type fails at compile | TS-build |
| NPL-02 | Mailbox write with empty `dataLabels` + `provenance='unknown'` → backend rejects with `provenance_required` | Unit |
| NPL-03 | NVG request with aggregated `oct_secure` + frontier tier → deny with `oct_tier_mismatch` | Integration |
| NPL-04 | NVG request with empty labels + trusted nxs_connector_result provenance → allow with floor `internal` | Integration |
| NPL-05 | NVG request with empty labels + agent_output untrusted → deny/quarantine `unknown_provenance_payload` | Integration |
| NPL-06 | NVG request with empty labels + workspace_upload trusted, arena policy `public_default=false` → floor `internal` | Integration |
| NPL-07 | observe mode: would-deny logs, payload proceeds with caveat receipt | Integration |
| NPL-08 | enforcing mode: deny → no LLM call; no payload crosses firewall | Integration |
| NPL-09 | Static gate detects production code constructing `dataLabels: []` without trusted-source helper → CI fails | Static |

**CI static gates (Spec F4.19):**
- `GOV-05 NVG payload label propagation` — no production code constructs `dataLabels: []` for real workspace/mailbox/compile/agent paths; empty arrays only in typed "trusted public/no payload" constructors.

---

## §6 Audit closure mapping

| Finding | How closed |
|---|---|
| P0-019 | Every mailbox writer populates labels; aggregation rule in NVG; empty-labels case split; tests NPL-04/-05 |
| P0-030 | Stale empty-labels-public assertion replaced by case split (§3.3); test NPL-05 explicitly denies; CI gate GOV-05 |

---

*End of v0.1.0.*

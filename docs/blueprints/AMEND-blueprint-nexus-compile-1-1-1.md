# COMPILE-REF — Blueprint Amendment v1.1.1
# Filename: AMEND-blueprint-nexus-compile-1-1-1.md
# Owner: James Huson / Lake Area LLC
# Date: 2026-05-01
# Status: OWNER-RATIFIED
# Ratified by: James Huson, Session 21
# Subordinate to: nexus-blueprint-v1-5-13.md (under the §Governing Precedence
#   chain in docs/alignment/nexus-component-outline-v0-1-0.md)
# This document is compile-ref implementation law within that precedence chain.
# (Older header banner "This document is canonical compile-ref implementation
# law." was softened 2026-05-23 — fix-spec post-consolidation, §11 Document
# Hygiene Law — to avoid header-as-law drift.)

---

## 0. Precedence

This AMEND is subordinate compile-ref law under the governing precedence chain
ratified 2026-05-23. The chain is owned by the component outline at
`docs/alignment/nexus-component-outline-v0-1-0.md §Governing Precedence`:

```
1. nexus-complete-end-to-end-flow-v4.8.md (LOCKED)
2. nexus-owner-ratification-v1-4-12.md (LOCKED)
3. docs/alignment/nexus-component-outline-v0-1-0.md
4. nexus-blueprint-v1-5-13.md
5. nexus-engineering-spec-v1-8-26.md
6. Owner-approved AMENDs (this AMEND lives here)
7. Implementation
```

Where this AMEND touches existing law (OCT-COMPILE, compile modes,
FinalResponseArtifact signing, Run Ledger events), it inherits that law
exactly. This document adds compile-ref implementation detail — it does not
redefine or weaken upstream law. (The previous §0 enumerated a partial,
pre-outline chain; replaced 2026-05-23 with a pointer to the outline's
canonical chain per §11 Document Hygiene Law.)

### 0.1 Naming Clarity

Two compile-related "contract" concepts exist. They are different things.

| Name | What It Is | Package | Mutable at Runtime |
|---|---|---|---|
| OutputContract | Audit metadata — what is in the mailbox for a run | @nexus/contracts | YES (built per run) |
| CompileTemplate | Layout manifest — how to assemble the output | @nexus/contracts | NO (pre-loaded, immutable, signed) |

OutputContract is built by OutputCollector after agents finish. It records
which mailbox items exist, their data classes, and compile eligibility.

CompileTemplate is pre-loaded by an operator into the template registry.
It defines sections, locations, slots, and guards. The assembler reads the
CompileTemplate to know where to place each mailbox item.

---

## 1. What It Is

Compile-ref is the reference governed compile implementation for Nexus.

It is the governed assembly surface between agent mailbox results and the final
response delivered to workspace.

It ships with a default deterministic assembler so the reference system works
out of the box.

The assembler is swappable. The compile infrastructure is not.

### 1.1 Agent-Agnostic

Compile-ref is not bound to any specific agent type, domain, or industry.
The template system works with ANY agent for ANY domain. Sales, shipping,
and inventory agents are examples only. A healthcare deployment uses
patient-record-agent and lab-results-agent. A legal firm uses discovery-agent
and case-law-agent. A financial institution uses compliance-agent and
risk-assessment-agent.

The template does not care what the agents do. It cares about slot types,
positions, and guards. Any agent that writes typed fills to its mailbox slot
can participate in any template. New domains require new templates — not
engine changes.

---

## 2. Container vs Assembler

### 2.1 Compile Container (baked — already built)

The compile container is baked core infrastructure. Already exists:

- CompileServiceImpl — selects compile mode, enforces OCT-COMPILE inheritance,
  invokes the configured compiler, writes Run Ledger events
- CompileReturnDispatcherImpl — builds signed compile-return requests, dispatches
  through configured transport
- FinalResponseSigner — signs compiled artifacts with Ed25519
- OutputCollector — writes engine results into mailbox through output references
- MailboxServiceImpl — manages eligibility, transitions, digest verification
- PayloadResolver — resolves resultRef to raw bytes for verification

The container does not need to be smart. It is the governed pipe.

### 2.2 Default Assembler (compile-ref — what we build)

The default assembler is the shipped deterministic compile implementation.

It implements the `Compiler` interface from `@nexus/contracts`.

It can be removed and replaced via manifest/factory switch.

A replacement compiler must still honor:

- Compiler interface contract
- CompileMode selection by CompileServiceImpl (not self-authorized)
- OCT-COMPILE inheritance ceiling
- No mutation of source mailbox items
- Signed FinalResponseArtifact output
- Run Ledger event emission via container

### 2.3 What Can Replace It

| Implementation | Repo | Registration |
|---|---|---|
| Default deterministic assembler | nexus (ships in-repo) | exempt — no model, no action |
| On-prem synthesis agent | separate repo | registered OCT-COMPILE actor |
| Frontier synthesis agent | separate repo | registered OCT-COMPILE actor |
| MCP wrapper compile agent | separate repo | registered OCT-COMPILE actor |
| Full agentic compile agent | separate repo | registered OCT-COMPILE actor |

The manifest/factory switch selects which compiler is active.
Dev UI and workspace credentials control which implementation runs.

### 2.4 Non-Replaceable Constraints

The following are not optional regardless of compiler choice:

- OCT-COMPILE inheritance ceiling (hard rule — not configurable)
- CompileMode selection by CompileServiceImpl
- Signed FinalResponseArtifact law
- Run Ledger event emission
- No mutation of mailbox items, Evidence Ledger, Routing Trail, or Run Ledger
- Final response returns to workspace only
- Guard evaluation (§7) — guards fire regardless of compiler implementation

---

## 3. Trust Model

The compile container is governed infrastructure.

The assembler is a governed actor (or exempt utility for deterministic mode).

The assembler is not exempt from governance because it is infrastructure —
unless it is the reference deterministic renderer, which is explicitly exempt
per blueprint §21.4.

Any assembler that calls a model, third-party service, or action surface must be
a registered OCT-COMPILE actor with:

- actorId
- actorClass
- OCT-COMPILE assignment
- delegation (if needed — OCT-COMPILE has zero action scope)
- audit trail

The assembler does not make governance decisions. NXS/NVG/policy already decided.
The assembler assembles.

---

## 4. Two-Zone Architecture

### 4.1 Zone 1 — The Registry (persistent, grows on command)

The contract template registry is the persistent store. It contains:

- Compile templates (sections, locations, slot definitions)
- Slot type definitions (the governed type taxonomy)
- Guard rules (when/then constraints)

The registry only changes when an operator explicitly ingests a new contract
template or modifies an existing one. Template ingestion is an admin action,
not a runtime action.

The registry is the "capability set." Adding a new contract template is
equivalent to teaching the system a new output shape — no retraining, no
weight updates, just a new set of paths.

Storage: SQLite in the existing Nexus DB for V1. No separate database.
Later migration to Postgres happens with the whole persistence layer together.

### 4.2 Zone 2 — The Session (ephemeral, dies after assembly)

The compile session is ephemeral state. It contains:

- The compile request (runId, templateId, mailboxId)
- MailboxItems (the fills — typed payloads from agents)
- Slot-to-location matching results
- Guard evaluation results
- The assembled output
- Validation results

Once assembly completes and the FinalResponseArtifact is emitted, the session
is discarded. Audit records go to the Run Ledger. Fills are NOT written back
to the registry.

### 4.3 The Prompt Firewall

Prompts never enter the registry. Ever.

The boundary between zones is a one-way valve:

```
Prompt → [workspace] → orchestrator plans tasks
                      → agents execute tasks
                      → agents write fills to mailbox (Zone 2)
                      → compile assembler reads Zone 1 template
                      → resolves Zone 2 fills against Zone 1 slots
                      → output emitted
                      → Zone 2 discarded

Zone 1 (Registry) ← ONLY written to by explicit operator ingestion
                     NEVER by prompt processing, agent output, or runtime
```

The assembler reads the registry (template structure) and reads the session
(fills from mailbox). It never writes to the registry. The registry does not
accumulate user-specific noise, prompt content, or agent output. It stays
clean, governed, curated.

### 4.4 Registry Growth

Every time an operator ingests a new compile template, the system gains
new capability. Structural patterns deduplicate naturally — a "header" section
with date and author slots appears across many templates but resolves to the
same slot type definitions.

Growth loop:

```
operator designs new contract template
→ operator signs template with Ed25519
→ operator ingests signed template into registry
→ paths indexed, version recorded
→ system can now assemble that output type
→ done
```

No retraining. No fine-tuning. New capability = new signed template.

---

## 5. Compile-as-Assembler — Core Architecture

### 5.1 The Principle

Compile is opaque-to-understanding, not blind to payload bytes.

The assembler reads payload bytes via resultRef for deterministic placement.
It does not interpret, analyze, or derive meaning from content. It places
typed fills by position per the compile template.

Each agent wrote to its own mailbox slot. Each slot has a resultRef (a pointer
to payload) and metadata (slotId, taskId, agentId, classifications).

The assembler knows:
- where each block goes (from the template)
- what type each block is (from slot type definition)
- which agent produced it (from agentId)
- what classification it carries (from resultClassifications)
- the raw bytes of the fill (required for placement and digest verification)

The assembler does NOT:
- interpret what the content means
- analyze content across agents
- derive relationships between fills
- retain or store content after assembly
- have access to raw prompt content

### 5.2 Opacity Modes

**Mode: opaque assembly (default, V1)**

Assembler receives MailboxItems. Each item has a resultRef pointing to stored
payload. Assembler reads resultRef and places the raw bytes/text at the
template-specified position. No interpretation, no transformation, no synthesis.

The assembler is a postal worker sorting sealed envelopes by address.

**Mode: transparent synthesis (on-prem or frontier, future)**

A registered OCT-COMPILE actor receives MailboxItems and reads content to
synthesize a unified response. This actor CAN see content — it is authorized
via OCT-COMPILE registration and constrained by the inherited data class ceiling.

The mode switch is CompileMode. CompileServiceImpl selects the mode. The
assembler does not self-authorize.

---

## 6. Compile Template System

### 6.1 What a Compile Template Is

An compile template is a tree, not a flat string:

```
Contract: "quarterly_ops_report"
├── Section: "executive_summary" (position: 1)
│   ├── Location: "revenue_line" → slot(type: prose, granularity: inline)
│   │   ├── fill: sales-agent → "Revenue was ${L1.1}"
│   │   ├── fill: inventory-agent → "with ${L1.2} units in stock"
│   │   └── fill: shipping-agent → "and ${L1.3} orders shipped."
│   └── Location: "outlook" → slot(type: prose, granularity: paragraph)
├── Section: "sales_detail" (position: 2)
│   ├── Location: "summary" → slot(type: prose, granularity: block)
│   └── Location: "data_table" → slot(type: table, required: true)
├── Section: "inventory_status" (position: 3)
│   ├── Location: "on_hand" → slot(type: prose, granularity: paragraph)
│   └── Location: "lead_times" → slot(type: repeating_group)
│       ├── Location: "item_name" → slot(type: string)
│       ├── Location: "days" → slot(type: number)
│       └── Location: "risk" → slot(type: enum, values: ["ok","warning","critical"])
└── Section: "shipping_overview" (position: 4)
    ├── Location: "status" → slot(type: prose, granularity: block)
    └── Location: "tracking_problems" → slot(type: repeating_group)
        ├── Location: "order_id" → slot(type: string)
        └── Location: "issue" → slot(type: prose, granularity: sentence)
```

### 6.2 Template Sources

**Source 1: default (no template provided)**

No output contract from user → assembler uses default layout:
sections ordered by agent, one section per agent, prose format.
Default template generator is a baked utility, exposed through a small
interface/factory seam for future replacement.

**Source 2: user-provided (Work Order Mode)**

User specifies output preferences. Workspace translates to structured template
or passes `outputPreferences` to the orchestrator for template selection.

**Source 3: orchestrator-generated**

Orchestrator generates a template during planning. It knows which agents are
selected and what tasks they perform. Maps agents to sections.

**Source 4: Nexus Contract Designer (future, separate socket)**

A dedicated stateless agent that sees agent prompts and designs the layout.
See §9. Not V1.

### 6.3 Template Schema

Spec seed / illustrative contract shape. Engineering spec owns exact fields.

```typescript
interface CompileTemplate {
  templateId: Uuid;
  templateVersion: NonEmpty;
  runId: Uuid;
  format: CompileFormat;
  sections: CompileSection[];
  guards: CompileGuard[];
  denialHandling: 'inline' | 'separate_section' | 'omit';
  createdAt: IsoTimestamp;
  createdBy: 'user' | 'orchestrator' | 'contract_designer' | 'default';
  templateDigest: Sha256Hex;
  signature: Base64Url;
}

type CompileFormat = 'prose' | 'table' | 'raw' | 'mixed' | 'file_bundle';

interface CompileSection {
  sectionId: Uuid;
  position: number;
  title: string;
  assignedAgentId: Uuid;
  expectedContentType: 'prose' | 'table' | 'data' | 'file' | 'mixed';
  locations: CompileLocation[];
  formatHint?: string;
}

interface CompileLocation {
  locationId: NonEmpty;
  position: number;
  assignedAgentId: Uuid;
  expectedSlotId: NonEmpty;
  slotType: SlotType;
  required: boolean;
  placeholder?: string;
  defaultValue?: string;
}
```

### 6.4 Slot Type Taxonomy

| Type | Description | Validation |
|---|---|---|
| string | Free text, length-bounded | non-empty, max length |
| number | Numeric value | parseable, optional min/max |
| date | ISO timestamp | valid ISO 8601 |
| enum | Pick from closed set | value in set |
| entity_ref | Pointer to known entity (agent, user, system) | resolvable against owning registry |
| prose | Text with granularity constraint | see §6.5 |
| table | Structured tabular data | column schema match |
| repeating_group | Container that repeats 0..N times | child slots validate per instance |
| asset_ref | Pointer to file/image/document | resultRef resolvable |
| computed | Derived from other slots (same_agent scope only V1) | compute function valid |

Entity refs resolve against governed registries defined by the owning domain
(e.g., actor registry for agents, principal registry for users). Compile-ref
does not invent a new identity or system registry — it validates entity_ref
slots against existing registries via injected dependencies.

### 6.5 Content Granularity (prose slots)

**block** — full section or multi-paragraph unit. Agent fills an entire area.

**paragraph** — single paragraph within a section. Multiple agents can contribute
different paragraphs to one section.

**sentence** — single sentence within a paragraph. Three agents' data can appear
in one paragraph as separate sentences.

**inline** — word or phrase level. Three agents' data can appear in ONE sentence.
The template defines the sentence frame with placeholder positions. Agents
fill data fragments. The assembled sentence reads as one voice.

V1 includes `inline` in the schema and supports structural placement. Grammar
validation is deferred — V1 validates structurally only (all slots filled and
non-empty = valid). Grammar/spelling suggestions belong in workspace tooling.

```typescript
type ContentGranularity = 'block' | 'paragraph' | 'sentence' | 'inline';
```

### 6.6 Repeating Groups

A repeating_group slot contains child locations and expands dynamically.

The template defines the child schema. The agent determines how many instances.
The assembler expands 0..N on encounter — no pre-allocation needed.

If the agent returns 12 line items, the assembler creates 12 instances of the
repeating_group child locations.

### 6.7 Computed Slots

A computed slot derives its value from other filled slots.

**V1 scope constraint:** computed slots operate within a single agent's scope
only (`computeScope: 'same_agent'`). Cross-agent computation would break
opacity by requiring the assembler to read fills from multiple agents.

Cross-agent computed slots are deferred. If needed, they require an explicit
orchestrator-mediated data exchange through NXS (the agentic loop).

---

## 7. Guard System

### 7.1 What Guards Are

Guards are when/then constraints that fire during assembly. They are not
suggestions — they are hard stops. The assembler will not produce output
that violates a guard.

Guards are defined in the contract template and stored in the registry.
They cannot be overridden by agents, prompts, or runtime configuration.
Violating a guard requires changing the template — an operator action
requiring a new signed template version.

### 7.2 Guard Schema

Spec seed / illustrative contract shape. Engineering spec owns exact fields.

```typescript
interface CompileGuard {
  guardId: NonEmpty;
  name: string;
  when: GuardCondition;
  then: GuardAction;
  severity: 'halt' | 'warn_and_mark' | 'auto_fix';
}

interface GuardCondition {
  locationPath: string;
  operator: '==' | '!=' | '>' | '<' | '>=' | '<='
          | 'is_empty' | 'is_filled' | 'count_gt' | 'count_lt';
  value?: string | number | boolean;
}

interface GuardAction {
  targetLocationPath: string;
  effect: 'set_required' | 'set_value' | 'block_section' | 'add_warning';
  value?: string | number | boolean;
}
```

### 7.3 Guard Examples

```
guard: "risk_escalation"
  when: shipping_overview.tracking_problems.count_gt(5)
  then: executive_summary.outlook.set_required = true
  severity: halt

guard: "sensitive_data_notice"
  when: any_location.classification == "pii"
  then: that_location.add_warning("[Contains PII — review before distribution]")
  severity: warn_and_mark
```

### 7.4 Guards and Agent Opacity

Guards operate on fill METADATA, not fill CONTENT.

A guard checking `risk_level == "high"` reads the typed enum value from the
fill — not prose content. Slot types are metadata. The guard system never
reads the body of a prose slot to evaluate a condition.

Guards MAY reference cross-section fill metadata in V1. This does not violate
opacity because Agent B never sees Agent A's content — the guard reads only
typed metadata (enum values, counts, classification labels). Example: "if
shipping section has risk == critical, require executive summary revision."
This crosses section/agent boundary at the metadata level only.

Content-aware guards (reading prose to evaluate) are NOT permitted in V1.
Content-aware guards require transparent synthesis mode (Mode 2 or 3).

### 7.5 Guard Evaluation Timing

Guards fire after all available fills are matched to slots, before final
assembly. The evaluation order:

1. Match fills to locations
2. Evaluate all guards (metadata only)
3. If any guard with severity `halt` fires and its condition is unmet → fail
4. Apply `auto_fix` guard actions
5. Apply `warn_and_mark` annotations
6. Assemble final output

---

## 8. Assembly Runtime

### 8.1 The Assembler Algorithm

```
for each section in template.sections (by position):
    for each location in section.locations (by position):
        slot = location.slotType
        fill = matchFill(location, mailboxItems)

        if fill exists:
            validate(fill, slot)  → hard fail if type mismatch
            if slot.type == 'repeating_group':
                expand(fill, slot.childLocations)
            else:
                emit(fill, slot.granularity)
        else if location.required:
            applyDenialHandling(location, template.denialHandling)
        else if location.defaultValue:
            emit(location.defaultValue)
        else:
            skip
```

The assembler either resolves every required slot and produces valid output,
or it halts and reports exactly what is missing and where. It cannot drift
because there is no generative step — it is resolution, not generation.

### 8.2 Fill Matching

Each MailboxItem has a slotId. Each CompileLocation has an expectedSlotId.
Matching is by slotId equality. If multiple items match the same slot
(repeating group), they are ordered by createdAt ASC, then mailboxItemId ASC.

A fill that matches no location is ignored (but logged as unmatched).
A location that matches no fill is treated per §7.1 (missing slots).

### 8.3 Slot Validation

Every fill is validated against its slot type definition before placement:

- string: non-empty, within maxLength
- number: parseable, within min/max if defined
- date: valid ISO 8601
- enum: value exists in closed set
- entity_ref: ID resolvable
- prose: granularity constraint met (structural only V1, see §8.4)
- table: column schema matches
- asset_ref: resultRef resolvable
- computed: compute function produces valid result within same_agent scope

Validation failure on a required slot halts assembly.
Validation failure on an optional slot skips the slot and logs a warning.

### 8.4 Prose Validation (V1 — structural only)

For prose slots, V1 validation is structural, not grammatical:

- **block**: any non-empty text passes
- **paragraph**: must not contain section-level delimiters
- **sentence**: must be non-empty text
- **inline**: must be non-empty word or phrase

All slots filled and non-empty = valid assembly. Grammar checking and
spelling suggestions are workspace tooling concerns, not compile-ref scope.

### 8.5 Output Formats

**prose** — markdown/plaintext. Sections concatenated with headers.

**table** — markdown table or structured data. Each location is a cell or row.

**raw** — no formatting. Items concatenated in template order.

**mixed** — prose sections interspersed with tables and data blocks.

**file_bundle** — reserved in schema. Renderer deferred from V1.

### 8.6 Deterministic Ordering Requirement

The assembler must produce identical output given identical inputs.
Ordering: template section position → location position → fill createdAt ASC.

---

## 9. Nexus Contract Designer — Future Separate Socket

### 9.1 What It Is

The Nexus Contract Designer is a future template design socket. It is a
separate concern from the assembler and a separate socket.

| Component | Sees Prompts | Sees Content | Repo | Socket |
|---|---|---|---|---|
| Nexus Contract Designer | YES | NO (designs layout only) | separate | ContractDesigner |
| compile-ref assembler | NO | NO (opaque assembly) | nexus | Compiler |

These MUST remain separate. The designer can see prompts because it designs
the layout. The assembler cannot see prompts because it only places fills.
Merging them breaks the prompt firewall.

### 9.2 What It Does

A stateless agent that receives agent task summaries and output preferences
and produces an CompileTemplate with location-level slot assignments.

Safe because:
- No memory — pure function, no state persisted between calls
- No network — no external calls
- No side effects — reads inputs, emits template, done
- No drift — deterministic pattern matching, not learned weights

### 9.3 Implementation Path

DB-backed pattern matcher. Not an LLM.

Vocabulary: governed verb lexicon + output contract section types.
Grammar: output contract schemas.

Prompt features (verbs, systems, capabilities, data classes) →
template selection from pattern registry → slot generation.

Deterministic. Auditable. Every decision traceable to a registry entry.

### 9.4 Switchability

Default: deterministic Nexus Contract Designer (when built).
Can be switched to: LLM-assisted contract designer via manifest/factory.

The ContractDesigner socket is independent of the Compiler socket.
Both are independently swappable.

### 9.5 Build Dependency

Requires functional workspace-ref + compile-ref first.
Estimated: 2-3 sessions after those are working.

---

## 10. Contract Template Router

### 10.1 How Does the Right Template Get Selected?

**V1: explicit selection only.**

The orchestrator or workspace specifies which contract template to use via
`templateId` / `templateVersion`. Optionally, workspace passes
`outputPreferences` and the orchestrator selects a matching template.

```typescript
{ templateId: "quarterly_ops_report", templateVersion: "2.0.0" }
```

The compile route accepts `templateId` and `templateVersion`. It does NOT
accept raw ad hoc templates for runtime execution. Templates must be
pre-ingested through the admin template ingestion route.

**Future options (not V1):**

- Slot signature matching — structural matching against fill types
- Keyword/pattern matching — trigger terms against template metadata

---

## 11. Template Signing and Ingestion

### 11.1 Signing Requirement

Templates define output law and guards. Unsigned template ingestion would be
a governance bypass. Templates are treated like policy and manifest files:

- Signed with Ed25519
- Versioned (immutable once ingested)
- Admin-only ingestion
- Signature verified at load time

Templates are signed by an admin/operator template-signing key registered in
the admin key registry. This key is distinct from the final-response signer
key and from approver keys. Key separation prevents a compromised compile
signer from injecting templates, and prevents a template author from forging
final response signatures.

### 11.2 Template Digest

```
templateDigest = sha256(canonicalize({
  templateId, templateVersion, format, sections, guards,
  denialHandling, createdAt, createdBy
}))
```

### 11.3 Ingestion Path

```
operator designs template
→ operator signs template (Ed25519, template-signing key)
→ POST /admin/templates (admin-only route, signed payload)
→ server verifies signature
→ server stores in SQLite registry (Zone 1)
→ template available for compile runs
```

Exact route path, package wiring, and DI registration belong to the
engineering spec. The admin route must respect API layer import law —
API (Layer 7) must not import core (Layer 1) directly. DI injection
through the existing ApiDependencies pattern is required.

### 11.4 Version Immutability

A template version, once ingested, is immutable. No in-place edits.
Changes produce a new version. Old versions are not deleted — they are
retained for audit and replay.

In-flight runs keep their template version. New runs get latest by default.
The Run Ledger records templateId AND templateVersion at compile time.

---

## 12. Denial Handling

### 12.1 Missing Slot Markers

When an agent fails, times out, or is denied, its mailbox slots may be empty.

The assembler checks each template location against available mailbox items.
Missing slots produce one of three treatments per `template.denialHandling`:

**inline** — marker inserted at the missing location:
```
[section unavailable: denied_policy REF=pol-42a TRACE=run-xyz-789]
```

**separate_section** — all denials collected in a dedicated section at end:
```
## Unavailable Sections
- Sales Detail: denied_policy (REF=pol-42a, TRACE=run-xyz-789)
- Shipping Overview: agent_timeout (TRACE=run-xyz-789)
```

**omit** — missing sections silently removed from user-facing output, document
shortened. However, omission is NEVER audit-silent. Omitted missing sections
are still recorded internally via compile_slot_missing Run Ledger events with
full reason code, policy reference, and location path. The user does not see
the gap; the audit trail does.

### 12.2 Marker Content

Internal: full reason code + policy reference + template reference.
User display: concise marker plus trace ID/ref. Not a full policy dump.
Display format is configurable per deployment.

---

## 13. Inter-Agent Data Exchange

Not a compile concern. See orchestrator-ref for dependency graph handling.

By the time compile runs, all inter-agent exchanges have completed. Each
agent's final output is in its mailbox slot. Compile assembles the final
results — it never sees the intermediate exchanges.

---

## 14. Secure Path

For OCT-SECURE / sensitive data paths:

- Mode 3 (frontier synthesis) is hard-denied — no exceptions
- Mode 2 (on-prem synthesis) permitted only if on-prem model is available
- Mode 1 (deterministic render) is always available
- Opaque assembly mode recommended for sensitive multi-agent runs
- Transparent synthesis requires explicit signed policy
- No compile helper may see raw sensitive payloads unless authorized
- Compile-return auth is signed; workspace verifies before display
- Guards still fire — on metadata only, not content

The secure path cannot be weakened by compiler replacement.

---

## 15. Interface Contracts

### 15.1 Already Built (no changes needed)

| Contract | Package | Status |
|---|---|---|
| Compiler | @nexus/contracts | BUILT |
| CompileService | @nexus/contracts | BUILT |
| CompileRequest | @nexus/contracts | BUILT |
| FinalResponseArtifact | @nexus/contracts | BUILT |
| CompileMode | @nexus/contracts | BUILT |
| OutputContract | @nexus/contracts | BUILT |
| OutputCollector | @nexus/contracts | BUILT |
| CompileEligibility | @nexus/contracts | BUILT |
| MailboxItem | @nexus/contracts | BUILT |
| MailboxService | @nexus/contracts | BUILT |
| MailboxBackend | @nexus/contracts | BUILT |
| CompileReturnRequest | @nexus/contracts | BUILT |
| CompileReturnDispatcher | core | BUILT |
| CompileServiceImpl | core | BUILT |
| DeterministicRenderer | core | SKELETON — clean replacement required (§18.1) |
| FinalResponseSigner | core | BUILT |
| OutputCollectorImpl | core | BUILT |
| PayloadResolver | @nexus/contracts | BUILT |

### 15.2 New Contracts (in contracts/src/externals/)

The following TypeScript interfaces are spec seed / illustrative contract shapes.
The engineering spec owns exact field definitions, validation rules, and Zod
schemas. These shapes define the architectural intent and required capabilities;
the spec may refine field names, optionality, or add fields without requiring
a blueprint amendment.

```typescript
// ─── Compile Template ───

interface CompileTemplate {
  templateId: Uuid;
  templateVersion: NonEmpty;
  runId: Uuid;
  format: CompileFormat;
  sections: CompileSection[];
  guards: CompileGuard[];
  denialHandling: 'inline' | 'separate_section' | 'omit';
  createdAt: IsoTimestamp;
  createdBy: 'user' | 'orchestrator' | 'contract_designer' | 'default';
  templateDigest: Sha256Hex;
  signature: Base64Url;
}

type CompileFormat = 'prose' | 'table' | 'raw' | 'mixed' | 'file_bundle';

interface CompileSection {
  sectionId: Uuid;
  position: number;
  title: string;
  assignedAgentId: Uuid;
  expectedContentType: 'prose' | 'table' | 'data' | 'file' | 'mixed';
  locations: CompileLocation[];
  formatHint?: string;
}

interface CompileLocation {
  locationId: NonEmpty;
  position: number;
  assignedAgentId: Uuid;
  expectedSlotId: NonEmpty;
  slotType: SlotType;
  required: boolean;
  placeholder?: string;
  defaultValue?: string;
}

// ─── Slot Types ───

type SlotTypeName =
  | 'string' | 'number' | 'date' | 'enum'
  | 'entity_ref' | 'prose' | 'table'
  | 'repeating_group' | 'asset_ref' | 'computed';

type ContentGranularity = 'block' | 'paragraph' | 'sentence' | 'inline';

interface SlotType {
  type: SlotTypeName;
  granularity?: ContentGranularity;
  maxLength?: number;
  min?: number;
  max?: number;
  values?: string[];
  childLocations?: CompileLocation[];
  computeFn?: string;
  computeScope?: 'same_agent';
}

// ─── Guards ───

interface CompileGuard {
  guardId: NonEmpty;
  name: string;
  when: GuardCondition;
  then: GuardAction;
  severity: 'halt' | 'warn_and_mark' | 'auto_fix';
}

interface GuardCondition {
  locationPath: string;
  operator: '==' | '!=' | '>' | '<' | '>=' | '<='
          | 'is_empty' | 'is_filled' | 'count_gt' | 'count_lt';
  value?: string | number | boolean;
}

interface GuardAction {
  targetLocationPath: string;
  effect: 'set_required' | 'set_value' | 'block_section' | 'add_warning';
  value?: string | number | boolean;
}

// ─── Nexus Contract Designer (future socket — interface only V1) ───

interface ContractDesigner {
  readonly designerId: NonEmpty;
  readonly designerVersion: NonEmpty;
  designTemplate(
    runId: Uuid,
    agentSummaries: AgentTaskSummary[],
    outputPreferences: CompilePreferences | null
  ): Promise<CompileTemplate>;
}

interface AgentTaskSummary {
  agentId: Uuid;
  taskId: Uuid;
  taskSummary: NonEmpty;
  expectedOutputSlots: NonEmpty[];
  capabilities: string[];
}

interface CompilePreferences {
  format: CompileFormat;
  sectionOrder?: string[];
  denialHandling?: 'inline' | 'separate_section' | 'omit';
  locale?: string;
  customInstructions?: string;
}
```

---

## 16. Run Ledger Events

Compile-ref emits (via CompileServiceImpl container):

- compile_started
- compile_mode_selected
- compile_template_loaded (template source, templateId, templateVersion,
  templateDigest, signature verification status)
- compile_slot_matched (per-location: slotId matched to mailboxItemId)
- compile_slot_missing (per-location: expected slot not in mailbox, reason)
- compile_guard_fired (guardId, condition, action, severity)
- compile_guard_halt (guardId — assembly stopped by guard)
- compile_assembly_complete (itemCount, format, partial/complete)
- final_response (artifact delivered to workspace)

### 16.1 Replay/Audit Determinism

The compile_template_loaded event MUST record:
- `templateId` — which template was used
- `templateVersion` — exact version used for this run
- `templateDigest` — SHA-256 digest of the template as loaded
- `signatureVerified` — boolean: Ed25519 signature passed verification

These fields enable full replay: given the same template version and the same
mailbox items, the assembler must produce identical output. The Run Ledger
records are sufficient to reconstruct which template law governed any
historical compile run.

---

## 17. Dependencies

| Dependency | Package | Status |
|---|---|---|
| CompileServiceImpl | core | BUILT |
| CompileReturnDispatcherImpl | core | BUILT |
| FinalResponseSigner | core | BUILT |
| OutputCollectorImpl | core | BUILT |
| MailboxServiceImpl | core | BUILT |
| LocalJsonlMailboxBackend | core | BUILT |
| PayloadResolverSet | core | BUILT |
| DeterministicRenderer | core | SKELETON — replaced by clean production build (§18.1) |
| RunLedgerWriter | core | BUILT |
| Ed25519 signing/verify | core | BUILT |
| CompilerManifestRecord | contracts | BUILT |
| CompileConfig | contracts | BUILT |
| ExternalSocketRegistry | core | BUILT |
| Bootstrap step 21 | scripts | BUILT |

---

## 18. What Needs to Be Built

| Item | Effort | Notes |
|---|---|---|
| CompileTemplate types | small | contracts/src/externals/ (§15.2) |
| SlotType taxonomy types | small | 10 slot types (§6.4) |
| CompileGuard types | small | guard schema (§7.2) |
| ContractDesigner interface | small | future socket, interface only |
| Default template generator | small | baked utility, factory seam for replacement |
| Template registry SQLite store | small-medium | Zone 1, versioned, immutable |
| Template signing/verification | small | Ed25519, same pattern as policy/manifests |
| Template ingestion admin route | small | POST /admin/templates |
| Location-to-slot matcher | small | match by slotId, handle repeating groups |
| Guard evaluator | medium | when/then on metadata, three severities |
| Template-aware DeterministicRenderer | medium | clean production build — see §18.1 |
| Slot validation engine | small-medium | per-type validation (§8.3) |
| Output format renderers | medium | prose, table, raw, mixed (file_bundle deferred) |
| Denial/gap marker insertion | small | configurable markers with reason+ref (§12) |
| Compile route enhancement | small | accept templateId/templateVersion |
| Integration tests | medium | single/multi-agent, partial, denied, secure, guards |

Total estimated: 3-4 sessions.

### 18.1 Clean Production Build Directive

The current DeterministicRenderer (116 lines) is a gate-passing skeleton built
to prove the compile wire during ext-infra development. The template-aware
DeterministicRenderer is a clean production build — not a patch of the skeleton.

The builder must:
- Build the new DeterministicRenderer from scratch as production code
- Implement the same `Compiler` interface the skeleton implements
- Copy nothing from the skeleton except the interface contract it satisfies
- The new implementation replaces the skeleton file entirely
- Retain the same filename and export so bootstrap wiring is unchanged
- The result must look like it was always intended to be production code,
  not a skeleton that got patched into shape

---

## 19. What It Does NOT Do

- Does NOT replace NXS or NVG
- Does NOT execute system actions
- Does NOT call models (deterministic mode)
- Does NOT bypass OCT-COMPILE inheritance
- Does NOT see or store raw prompt content
- Does NOT write to the template registry at runtime
- Does NOT make governance decisions
- Does NOT handle inter-agent data exchange (orchestrator scope)
- Does NOT own compile-return transport (baked infrastructure)
- Does NOT perform grammar checking (V1 — structural validation only)
- Does NOT allow cross-agent computed slots (V1)
- Does NOT accept raw ad hoc templates at the compile route (must be pre-ingested)

---

## 20. Build Order Recommendation

1. CompileTemplate + SlotType + Guard + ContractDesigner types in contracts/src/externals/
2. Template registry SQLite store (versioned, immutable)
3. Template signing/verification (Ed25519)
4. Template ingestion admin route
5. Default template generator (baked utility, factory seam)
6. Location-to-slot matcher (with repeating group expansion)
7. Slot validation engine
8. Guard evaluator
9. Template-aware DeterministicRenderer (replaces current skeleton)
10. Denial/gap handling
11. Output format renderers (prose first, then table, then mixed)
12. Compile route enhancement (templateId/templateVersion)
13. Integration tests

---

## 21. Open Questions for Owner

All arch rulings applied. No open design items remain.

Blueprint is ready for owner ratification or further revision.

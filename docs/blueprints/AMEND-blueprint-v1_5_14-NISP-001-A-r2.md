# AMEND-blueprint-v1.5.14-NISP-001-A-r2.md

**Source blueprint:** `nexus-blueprint-v1-5-13.md` (live HEAD `b818085`, verified 2026-04-25)
**Target blueprint version:** **v1.5.14**
**Amendment scope:** NISP-001.A (model transport layer) + NISP-002 (signed manifest law, 4-domain)
**Session:** S9-T9 build (arch session) — produced by Arch (Claude) for owner + audit re-review
**Status:** PROPOSED — REVISION 2 — incorporates audit's S9-T8 forensic disposition + owner's S9-T9 pushback rulings
**Supersedes:** `AMEND-blueprint-v1.5.14-NISP-001-A.md` (r1)

---

## 0. Audit context — what changed in r2

This is r2 of the NISP-001.A blueprint amendment. r1 was reviewed by audit forensically (S9-T8) with per-fragment dispositions: 4 APPROVE, 4 APPROVE WITH MINOR REVISION, 2 REVISE. Arch then issued 3 pushbacks against audit and surfaced 1 internal contradiction in audit's own ruling text. Owner ruled on all 4 of those at S9-T9.

### 0.1 r2 net changes from r1 — fragment-by-fragment

| Fragment | r1 status | r2 status | Source of revision |
|---|---|---|---|
| F-01 | APPROVE | unchanged | — |
| F-02 | APPROVE WITH MINOR REVISION | revised | Audit S9-T8: "wire-format family" + envelope/status metadata clarification |
| F-03 | APPROVE | unchanged | — |
| F-04 | REVISE | substantially revised | Audit S9-T8: typed namespaces, auth shape, secretRef timing — all accepted; cross-manifest fail-load → cross-domain warning per Owner Pushback 1 ruling |
| F-05 | REVISE | substantially revised | Audit S9-T8: typed namespaces accepted; "common mechanism by contract" softened; RIA exception removed and replaced per Owner Pushback 2 ruling; HTTP-primitive forward reference per Owner Pushback 3 ruling |
| F-06 | APPROVE WITH MINOR REVISION | revised | Audit S9-T8: providerModelNameReturned definition tightened; NVG-local denial codes pinned |
| F-07 | APPROVE WITH CONDITION | revised | Audit S9-T8 condition tightened per Owner F-07 contradiction ruling: spec MUST implement all 4 manifest loaders, no carve-out |
| F-08 | REVISE | revised | Audit S9-T8: cross-domain rule rewritten per Pushback 1; import-law positive allow-list added per Pushback 3 |
| F-09 | APPROVE WITH LABEL FIX | revised | Audit S9-T8: subsection-label-correction note added |
| F-10 | APPROVE WITH WORDING FIX | revised | Audit S9-T8: precise adapter naming |

### 0.2 Scope guards retained from r1 — confirmed unchanged

- **RIA stays canonical.** NIA is owner/sales shorthand only.
- **Option C remains deferred** to a separate amendment.
- **Streaming forbidden v1.** Endpoint manifest exposes no `stream` field. Unknown stream-related fields fail manifest schema validation.
- **HOLE-S9-004 opaque carriage** preserved exactly as r1.
- **Empty / all-disabled endpoint manifest fails closed at startup.**
- **Three new ci:gate steps 17/18/19** all mandatory; Step 19 transport-narrow; full seven-layer import-law gate queued separately.

### 0.3 Scope guard added in r2

Per audit's "Final audit call" closing note S9-T8: **"four loaders" means manifest registry declarations for already-known interfaces, not building new IAM, new connectors, or new approval transports.** F-07 in r2 makes this explicit. Spec v1.8.27 implements four manifest loaders + minimal starter declarations for already-locked interface domains. No new product surfaces.

---

## 1. Format

Per S9-T5 owner-approved fragment format. Audit re-review request: per-fragment APPROVE / REVISE / REJECT in the same pinned format. Ideally per-fragment APPROVE this round so the file can move to merge.

---

## 2. Fragment list (TOC) — r2

| # | Target | Action | Closes |
|---|---|---|---|
| F-01 | header lines 1–12 | UPDATE-PARAGRAPH | meta — version bump |
| F-02 | §13.6 (lines 832–843) | REPLACE | HOLE-S9-002, HOLE-S9-004, ADD-S9-002, DIFF-S9-001 |
| F-03 | §13.7 (lines 845–858) | APPEND | HOLE-S9-004 |
| F-04 | INSERT-AFTER §14.4 (after line 935) | INSERT-AFTER | ADD-S9-002, HOLE-S9-001 |
| F-05 | INSERT-AFTER §14.5 | INSERT-AFTER | NISP-002 (4-domain manifold) |
| F-06 | §22.1 (lines 1484–1495) | APPEND | HOLE-S9-001, HOLE-S9-004, ADD-S9-001 |
| F-07 | §27 (lines 1833–1856) | UPDATE-FIELD | ADD-S9-002, NISP-002 |
| F-08 | §30 (lines 1927–1975) | APPEND | HOLE-S9-002, ADD-S9-002, ADD-S9-003, DIFF-S9-001, streaming, import-law allow-list |
| F-09 | §36 (lines 2269–2304) | UPDATE-PARAGRAPH | streaming-deferred queue, Option C deferral note, subsection-label correction |
| F-10 | §37 (lines 2306–2349) | UPDATE-PARAGRAPH | meta — final-statement language |

---

## F-01 — Version bump and changelog header

**Target:** lines 1–12 (header block)
**Action:** UPDATE-PARAGRAPH
**Closes:** meta
**r2 status:** unchanged from r1

### Before

```
# Nexus Stack — System Blueprint
# Version: v1.5.13
# Owner: James Huson / Lake Area LLC
# Date: 2026-04-21
# Supersedes: nexus-blueprint-v1-4-12.md
# Canonical outline: nexus-complete-end-to-end-flow-v4.8.md (Owner-Approved, LOCKED)
# Engineering spec derived from this blueprint: nexus-engineering-spec-v1-8-26.md
# Canonical law: this document
# Incorporates: Amendment J — WordNet-Backed Lexical Bootstrap Fixture (merged, superseded)
```

### After

```
# Nexus Stack — System Blueprint
# Version: v1.5.14
# Owner: James Huson / Lake Area LLC
# Date: 2026-04-25
# Supersedes: nexus-blueprint-v1-5-13.md
# Canonical outline: nexus-complete-end-to-end-flow-v4.8.md (Owner-Approved, LOCKED)
# Engineering spec derived from this blueprint: nexus-engineering-spec-v1-8-27.md
# Canonical law: this document
# Incorporates: Amendment J — WordNet-Backed Lexical Bootstrap Fixture (merged, superseded)
# Incorporates: NISP-001.A — Model Transport Layer (this version)
# Incorporates: NISP-002 — Signed Manifest Law, four-domain (this version)
```

---

## F-02 — §13.6 transport-stage law (REPLACE) — r2 revised

**Target:** §13.6 (lines 832–843)
**Action:** REPLACE
**Closes:** HOLE-S9-002, HOLE-S9-004, ADD-S9-002, DIFF-S9-001
**r2 changes:** "wire-format family" precision; envelope/status metadata adapter permission added (audit S9-T8)

### Before

```
### 13.6 Outbound: Step 5 — Model Invocation and Health Monitoring

For approved requests:
- Primary model selection per routing policy
- Health monitoring across all configured model endpoints
- Automatic fallback to secondary tier if primary is unavailable
- Fallback is constrained — it never widens the data-class or OCT ceiling
- Cost and latency tracking per request, linked to Routing Provenance Trail entry

Fallback law: on_prem_sensitive does not route to frontier_general on unavailability.
It denies. A constrained fallback to the fallback tier is permitted only within
the allowed ceiling. No silent widening of the wall is possible. No silent queueing.
```

### After

```
### 13.6 Outbound: Step 5 — Model Invocation and Health Monitoring

For approved requests, NVG performs governed model invocation through provider-specific
transport adapters:

- Primary model selection per routing policy
- Endpoint resolution from the signed endpoint manifest (§14.5)
- Provider dispatch through a registered transport adapter — one adapter per provider
  wire-format family
- Health monitoring across all configured model endpoints
- Automatic fallback to secondary tier if primary is unavailable
- Fallback is constrained — it never widens the data-class or OCT ceiling
- Cost and latency tracking per request, linked to Routing Provenance Trail entry
- Opaque carriage of the provider response back through NVG inbound (§13.7) — NVG does
  not semantically inspect provider responses at any layer

Fallback law: on_prem_sensitive does not route to frontier_general on unavailability.
It denies. A constrained fallback to the fallback tier is permitted only within
the allowed ceiling. No silent widening of the wall is possible. No silent queueing.

#### 13.6.1 Transport Adapter Boundary Law (mechanical vs governance)

Transport adapters perform mechanical provider wire-format work only:
- Field mapping to the provider's required request shape
- Provider-required envelope construction
- Provider-required headers (auth, API version, content-type)
- Insertion of `modelName` from the endpoint manifest into the provider request
- Constraining the request to non-streaming (§13.6.2)
- Response shape extraction — locating success/denial signals, response size, latency
  from the provider response
- Inspection of provider envelope/status metadata (HTTP status, error envelope shape,
  rate-limit indicators) for the sole purpose of mapping provider errors to governed
  denial codes (§22.1 transport denial codes)

Transport adapters MUST NOT inspect, classify, route, deny, redact, summarize, truncate,
cache, replay, or mutate semantic payload content. The envelope/status inspection
permitted above does not extend to user prompts or model output content. Governance
decisions live above the transport boundary — in routing policy (§13.4), classification
(§13.3), and OCT ceiling enforcement (§13.3). Transport is mechanical only.

#### 13.6.2 Streaming — Deferred

Reference adapters in this version request complete, non-streaming responses. The
endpoint manifest format (§14.5) does not expose a `stream` field. Unknown
stream-related fields fail manifest schema validation at load time.

Streaming is deferred to a dedicated future amendment. The deferral is for governance
reasons, not implementation difficulty: streaming changes timeout semantics, audit
completion timing, response-size accounting, partial-output handling, cancellation
behavior, and post-inference normalization boundaries. These changes require their own
canonical treatment.

#### 13.6.3 Transport Dependencies — Explicit DI

Transport adapter registry, secret resolution, and endpoint manifest resolution flow
through NVG via explicit constructor dependency injection. Module-level singleton or
globally-mutated transport state is a build violation (see §30 drift rules).

#### 13.6.4 Approved HTTP Primitive

External HTTP client libraries are not part of the transport architecture in this
version. The engineering spec pins the approved HTTP primitive for transport adapters.
Introducing an HTTP client library outside the spec-pinned primitive is a build
violation.
```

### Reasoning

r1 wording adopted and tightened per audit S9-T8: "wire-format family" prevents adapter
identity from collapsing into provider/business name (a single provider can ship multiple
wire-format families over time). Envelope/status metadata clarification closes a
literal-reading hole — adapters need to read HTTP status to map to denial codes, but that
is not "inspecting payload content." §13.6.4 forward-references the spec's HTTP-primitive
lockdown per Owner Pushback 3 ruling without putting implementation detail in blueprint.

---

## F-03 — §13.7 inbound opaque carriage rule (APPEND)

**Target:** end of §13.7 (after line 858)
**Action:** APPEND
**Closes:** HOLE-S9-004
**r2 status:** unchanged from r1

### Before

```
NVG does not inspect the semantic content of model responses. No content parsing.
No token inspection. No response classification beyond size and format metadata.
The governed loop closes through NXS (if the result triggers a system action) and
the compile step OCT rules (if the result becomes compile input). Not here.
```

### After (append after the existing paragraph)

```
NVG does not inspect the semantic content of model responses. No content parsing.
No token inspection. No response classification beyond size and format metadata.
The governed loop closes through NXS (if the result triggers a system action) and
the compile step OCT rules (if the result becomes compile input). Not here.

#### 13.7.1 Opaque Content Carriage Law

NVG carries the provider response opaquely from the transport boundary (§13.6) through
inbound normalization to the orchestrator-facing surface. The opaque content is:
- forwarded as an unknown-shape payload from transport adapter to NVG inbound to orchestrator
- never inspected semantically by any NVG layer
- never classified by any NVG layer
- never logged or stored in the Routing Provenance Trail (§22.1)
- never persisted by NVG in any audit stream
- never used as input to any NVG governance decision (routing, ceiling, denial, fallback)

The Routing Provenance Trail records metadata about the response (size, latency,
endpoint identity, denial code) but never the response body. Storing the opaque body
in any audit stream is a build violation.

The first surface authorized to interpret model output semantically is the
Post-Inference Action Normalizer (§15) — outside NVG. NISP-001.A in this version
guarantees opaque carriage only as far as the orchestrator-facing boundary; the
orchestrator implementation that consumes the boundary is deferred to a separate
amendment (Option C / runtime surfaces).
```

---

## F-04 — §14.5 Endpoint Manifest Law (INSERT) — r2 revised

**Target:** INSERT-AFTER §14.4 (after line 935)
**Action:** INSERT-AFTER (new §14.5 subsection of §14)
**Closes:** ADD-S9-002, HOLE-S9-001 (endpoint declaration form)
**r2 changes:** typed-namespace qualified IDs; auth shape clarified by `kind`; loader validates `secretRef` resolvability without logging value; cross-manifest fail-load removed (cross-domain warning rule lives in §14.6)

### Before

(end of §14.4)

```
- A routing policy that would route sensitive data to a frontier tier is rejected at
  load time as a classification-enforcement violation — even if the signature is valid

---

## 15. Normalization Boundary
```

### After (insert new §14.5 between §14.4 and §15)

```
- A routing policy that would route sensitive data to a frontier tier is rejected at
  load time as a classification-enforcement violation — even if the signature is valid

### 14.5 Endpoint Manifest Law

Model endpoints are declared in a versioned, signed YAML manifest. This is the only
governed source of endpoint identity — endpoint URLs, auth, adapter dispatch, and
operational enable/disable state.

Endpoint manifest law:
- Manifest path: `config/nvg/endpoints.v1.yaml`
- Manifest is signed by the control-plane keypair at authoring time
- NVG validates the signature before loading any manifest entries
- An unsigned, invalid-signature, schema-invalid, or absent manifest is rejected at
  load time; NVG fails closed if no manifest can be loaded
- The manifest declares one or more endpoint entries; each entry is a signed declaration
  of an endpoint
- Each entry declares: `endpointId` (unique within this manifest), `tier` (open governed
  string from §14.3), `url`, `adapterId` (the registered ModelTransportAdapter wire-format
  family), `modelName` (provider-side model identifier), `auth` (governed shape; see
  below), `timeoutMs` (optional per-endpoint override; default 30 000 ms), `enabled`
  (boolean)
- The manifest does NOT expose a `stream` field. Unknown stream-related fields fail
  schema validation at load time

Endpoint auth (governed by `auth.kind`):
- `auth.kind: 'api_key' | 'bearer' | 'none'`
- If `auth.kind` is `none`: `secretRef`, `headerName`, and `prefix` MUST be absent
- If `auth.kind` is `api_key` or `bearer`: `secretRef` and `headerName` are REQUIRED;
  `prefix` is optional
- For enabled entries, the loader validates `secretRef` resolvability through the
  configured SecretSource at startup, WITHOUT reading or logging the secret value
- The transport adapter resolves the secret value at invoke time, never at config-load
  time, never logged
- Disabled entries (`enabled: false`) skip `secretRef` resolvability checks

Disabled entries:
- `enabled: false` skips the entry at registry load
- The entry is NOT inserted into the runtime endpoint registry
- The loader emits a config-load notice naming the disabled endpoint
- The entry remains in the manifest for change-tracking purposes

Empty / all-disabled manifest:
- An endpoint manifest with zero enabled entries fails closed at NVG startup
- The error message names the empty registry explicitly
- Operator must enable at least one endpoint, or remove NVG from the deployment

Uniqueness:
- `endpointId` must be unique within the endpoint manifest
- Duplicate `endpointId` within the endpoint manifest fails load with explicit error
- Endpoint identifiers live in the `endpoint` namespace (§14.6.4). For cross-domain
  audit display, references, and management API output, the qualified identifier is
  `endpoint:<endpointId>`

Trust boundary:
- The endpoint manifest is control-plane configuration (§24.1)
- The control-plane keypair (§15.2 of the spec) signs both routing policy (§14.4) and
  endpoint manifest. They share the same trust root by design

```

### Reasoning

r1 endpoint declaration form is preserved. r2 changes per audit S9-T8: auth shape clarified
by `kind` discriminant (forces correct combination at schema validation, not at runtime
discovery); secretRef resolvability validated at startup *without logging* — distinguishes
presence-check from value-fetch correctly; cross-manifest fail-load rule deleted in favor
of warning + qualified identifier per Owner Pushback 1 ruling (rule moves to §14.6).
"Wire-format family" terminology aligned with F-02.

---

## F-05 — §14.6 Signed Manifest Law (INSERT) — r2 revised

**Target:** INSERT-AFTER §14.5
**Action:** INSERT-AFTER (new §14.6 subsection of §14)
**Closes:** NISP-002 (4-domain manifold)
**r2 changes:** typed namespaces with cross-domain warning rule; "common mechanism by contract" softened; RIA exception removed and replaced with RIA-as-enabled-manifest-entry per Owner Pushback 2 ruling

### Before

(end of newly inserted §14.5)

### After (insert new §14.6 between §14.5 and §15)

```
### 14.6 Signed Manifest Law (Generic Mechanism + Four Domains)

This section codifies the signed-manifest pattern used by §14.5 (endpoint manifest) and
extends it to four domains where the runtime registry is plug-in by design. The mechanism
is shared. The schemas are domain-specific. New domains plug in additively without
rebuild.

#### 14.6.1 Mechanism

A signed manifest is a versioned YAML file declaring a registry of plug-in entries for
one domain. Mechanism law:

- The file carries a version identifier and an issuance timestamp
- The file is signed by the control-plane keypair at authoring time (Ed25519 over a
  canonicalized body)
- The runtime validates the signature before loading any manifest file
- The runtime validates the body against a domain-specific schema before accepting any
  entry
- An unsigned, invalid-signature, or schema-invalid manifest file is rejected at load
  time
- Loading is fail-closed: a missing or rejected manifest blocks startup of any subsystem
  that depends on it
- Manifest loading happens once at startup. Manifests are not hot-reloadable in this
  version

The mechanism is common by contract. The engineering spec decides whether the
implementation is one shared loader utility or domain-specific loaders that conform to
the same manifest contract. Either is valid; the mechanism law above is what binds them.

#### 14.6.2 Four Governed Domains (this version)

| Domain | Manifest path | Interface (unchanged) | Body shape (declared in spec) |
|---|---|---|---|
| Identity providers | `config/identity/providers.v1.yaml` | `IdentityProviderInterface` (§7) | `{ providerId, providerType, configuration, enabled }` |
| Model endpoints | `config/nvg/endpoints.v1.yaml` | ModelTransportAdapter (this version) | `{ endpointId, tier, url, adapterId, modelName, auth, timeoutMs?, enabled }` (§14.5) |
| Connectors | `config/connectors/connectors.v1.yaml` | `Connector` (§24.6) | `{ connectorId, connectorType, allowedSystems, configuration, enabled }` |
| Approval channels | `config/channels/channels.v1.yaml` | `ApprovalChannel` (§19.5) | `{ channelId, channelType, configuration, enabled }` |

Each manifest is independently signed and independently loaded. A failure in one domain
manifest does not invalidate the others — but the dependent subsystem fails closed for
that domain. (Example: invalid `connectors.v1.yaml` does not block NVG startup but does
block NXS Gate 06 connector dispatch until repaired.)

#### 14.6.3 Manifest Mechanism vs Interface Contract

The signed-manifest mechanism does NOT replace the interfaces that govern each domain.
The interfaces remain locked in their existing canonical sections (§7, §14.5, §24.6,
§19.5). The manifest is the **registry** — declaring which instances of an interface
exist at runtime. The interface is the **contract** — declaring what an implementation
must do. They are orthogonal:

- The manifest may add new entries without changing any interface
- An interface may be amended without changing manifest format
- A new implementation registered via manifest must satisfy the interface defined in
  Layer 2 contracts; the manifest does not redefine the interface

#### 14.6.4 Typed Namespaces and Qualified Identifiers

Each domain has a typed namespace. Primary identifiers exist within their domain
namespace:

| Domain | Primary identifier | Qualified form |
|---|---|---|
| Identity providers | `providerId` | `identity:<providerId>` |
| Model endpoints | `endpointId` | `endpoint:<endpointId>` |
| Connectors | `connectorId` | `connector:<connectorId>` |
| Approval channels | `channelId` | `channel:<channelId>` |

Within-domain uniqueness is mandatory. Duplicate primary identifiers within a single
manifest fail load with an explicit error.

Cross-domain primary identifier reuse is permitted. The same string may appear as
`endpointId` in `endpoints.v1.yaml` and as `connectorId` in `connectors.v1.yaml`
without architectural conflict.

Cross-domain collision emits a non-blocking config-load warning naming the colliding
identifier and the domains where it appears. Startup proceeds. The operator is
responsible for assessing whether the collision is intentional.

All persisted audit records, CLI output, management API output, and cross-domain
references MUST use the qualified identifier form (`<domain>:<primaryId>`). Unqualified
identifiers are permitted only inside their own domain manifest body.

#### 14.6.5 Disabled Entries (uniform across domains)

Each manifest schema includes `enabled: boolean`. When `enabled: false`:
- The entry's auth / secret / configuration is NOT validated for resolvability
- The entry is NOT inserted into the runtime registry
- The loader emits a config-load notice naming the disabled entry and its domain
- The entry remains visible in the manifest for change-tracking and review

Disabled entries are operator configuration. Healthy/unhealthy is runtime state. The
two are not interchangeable in any domain.

#### 14.6.6 Empty / All-Disabled Manifest

A manifest with zero enabled entries fails closed at startup of the subsystem that
depends on it, with an explicit error naming the empty registry.

This rule applies uniformly across all four domains. There is no per-domain exception.

For the identity-provider domain specifically: starter deployments satisfy the manifest
by declaring the Reference Identity Adapter (RIA, §7.4) as an enabled provider entry.
RIA remains the Nexus-provided starter/reference implementation of the Identity Provider
Interface. A zero-enabled identity-provider manifest is invalid.

A constructor-wired RIA (without manifest declaration) may exist only as a temporary
implementation bridge during migration, and only if the engineering spec explicitly
names it as such. It is not the canonical runtime posture.

#### 14.6.7 Trust Boundary

All four manifests are control-plane configuration (§24.1) and are signed with the
control-plane keypair. They share the same trust root as routing policy (§14.4) and
the existing signed policy artifacts. There is no per-manifest separate keypair in this
version. Production deployments may upgrade to per-domain keypairs as a hardening
amendment without changing the manifest file format.

#### 14.6.8 Owner/Sales Shorthand Note

Owner and sales shorthand may refer to the four-domain manifest mechanism as the
"Nexus manifold" or "NISP-002." The canonical name in this version is **Signed Manifest
Law** (§14.6). The shorthand is non-canonical.
```

### Reasoning

r1 four-domain mechanism preserved. r2 changes per audit S9-T8 + owner rulings:
"common mechanism by contract" — blueprint binds the contract, spec decides shared
utility vs domain-specific loaders (audit's concern about over-prescribing implementation
in blueprint); §14.6.4 typed namespaces + qualified-identifier convention + cross-domain
warning rule (Pushback 1 ruling — warning, not fail-load); §14.6.6 RIA-as-manifest-entry
replaces the constructor exception (Pushback 2 ruling); transitional constructor-wired
path is now spec-named only, not blueprint law. The §14.6.6 wording explicitly forbids
silent constructor wiring as canonical posture.

---

## F-06 — §22.1 Routing Provenance Trail content rule (APPEND) — r2 revised

**Target:** §22.1 (lines 1484–1495)
**Action:** APPEND
**Closes:** HOLE-S9-001 (trail entry fields), HOLE-S9-004 (trail-must-not-contain rule), ADD-S9-001 (denial code surface)
**r2 changes:** providerModelNameReturned defined more precisely (audit S9-T8); transport denial codes pinned NVG-local

### Before

```
### 22.1 Stream 1 — Routing Provenance Trail (NVG)

The NVG audit stream. Append-only. Queryable via management API and CLI.

Every entry carries:
- Actor identity and OCT
- Data classification decision and routing policy version applied
- Model tier selected and invoked
- Outbound request and inbound return linked by run ID and correlation ID
- Any denial or quarantine with reason code
- Fallback events with reason and tier selected
- Cost and latency metrics
```

### After (replace bullet list and append the must-not-contain rule)

```
### 22.1 Stream 1 — Routing Provenance Trail (NVG)

The NVG audit stream. Append-only. Queryable via management API and CLI.

Every entry carries:
- Actor identity and OCT
- Data classification decision and routing policy version applied
- Model tier selected and invoked
- Endpoint identity at event time: `endpointId`, `adapterId`, `modelName`
- `providerModelNameReturned` — optional provider-returned model identifier, version,
  or alias, stored exactly as returned when present; absent when the provider returns
  no such field
- Outbound request and inbound return linked by run ID and correlation ID
- Any denial or quarantine with reason code, including transport denial codes:
  `NVG_TRANSPORT_UNKNOWN_ADAPTER`, `NVG_TRANSPORT_AUTH_MISSING`,
  `NVG_TRANSPORT_AUTH_FAILED`, `NVG_TRANSPORT_RATE_LIMITED`,
  `NVG_TRANSPORT_PROVIDER_ERROR`, `NVG_TRANSPORT_PARSE_ERROR`
- Fallback events with reason and tier selected
- Cost and latency metrics

Endpoint identity recording law: `endpointId`, `adapterId`, and `modelName` are
recorded at event time, not by lookup against a mutable manifest. An audit record
that depends on later registry lookup is not forensic — the manifest may have been
re-signed with different content between the event and the audit query. The trail
entry is self-sufficient by construction.

Transport denial code scope: the six transport denial codes named above are
NVG-local. They populate the Routing Provenance Trail and the NVG invocation result
surface. They do NOT propagate into the NXS Evidence Ledger or the Comprehensive
Chronicle View unless a future canonical bridge explicitly maps them. CCV is an NXS
evidence concept (§20.8); transport failure is an NVG concept.

Trail content prohibition: the Routing Provenance Trail entry MUST NOT contain
the opaque provider response, the opaque model output, or any field that carries
model response body content. The trail records metadata only. Including content
in the trail is a build violation (see §13.7.1, §30 drift rules).
```

### Reasoning

r1 trail-fields-at-event-time rule preserved. r2 changes per audit S9-T8:
providerModelNameReturned definition tightened to acknowledge variability (alias,
dated version, or absent — providers vary); transport denial code scope pinned as
NVG-local with explicit non-bridging into NXS by default. This forecloses the failure
mode where transport denials accidentally pollute the Evidence Ledger.

---

## F-07 — §27 monorepo paths (UPDATE-FIELD) — r2 revised

**Target:** §27 monorepo block (lines 1833–1856)
**Action:** UPDATE-FIELD
**Closes:** ADD-S9-002, NISP-002 (4-domain manifold paths)
**r2 changes:** spec-implements-all-four-loaders made explicit per Owner F-07 contradiction ruling — no carve-out

### Before

```
nexus/
  packages/
    core/           Layer 1 — NXS authority engine, seven gates, ledger, crypto
    contracts/      Layer 2 — canonical shared types, interfaces, governed constants
    vanguard/       Layer 3 — NVG wall enforcement engine, routing, audit trail
    adapters/
      mcp/          Layer 4 — MCP Adapter v1 (current release, fully implemented)
      rest/         Layer 4 — REST Adapter v2 (interface contract locked; not implemented)
    connectors/
      stub/         Layer 5 — StubConnector (testing reference)
      vault/        Layer 5 — HashiCorp Vault connector (production reference)
    identity-ref/   Layer 6 — Reference Identity Adapter (optional starter package)
    interfaces/
      cli/          Layer 7 — CLI control interface
      api/          Layer 7 — Management API (localhost-only)
  docs/
    nexus-blueprint-v1-4-12.md        (this document)
    nexus-engineering-spec-v1-4-12.md (engineering spec — to be produced after owner approval)
  keys/
  fixtures/
  schemas/
  scripts/
```

### After

```
nexus/
  packages/
    core/           Layer 1 — NXS authority engine, seven gates, ledger, crypto
    contracts/      Layer 2 — canonical shared types, interfaces, governed constants
    vanguard/       Layer 3 — NVG wall enforcement engine, routing, audit trail
                    Includes: src/transport/ — model transport adapters,
                    adapter registry, signed endpoint manifest loader
    adapters/
      mcp/          Layer 4 — MCP Adapter v1 (current release, fully implemented)
      rest/         Layer 4 — REST Adapter v2 (interface contract locked; not implemented)
    connectors/
      stub/         Layer 5 — StubConnector (testing reference)
      vault/        Layer 5 — HashiCorp Vault connector (production reference)
    identity-ref/   Layer 6 — Reference Identity Adapter (RIA — starter package,
                    declared as an enabled identity-provider manifest entry per §14.6.6)
    interfaces/
      cli/          Layer 7 — CLI control interface
      api/          Layer 7 — Management API (localhost-only)
  config/                               Signed manifest configuration (§14.6)
    identity/
      providers.v1.yaml                 Identity provider manifest — RIA enabled by default
    nvg/
      endpoints.v1.yaml                 Model endpoint manifest (§14.5)
    connectors/
      connectors.v1.yaml                Connector manifest — declares stub/vault
    channels/
      channels.v1.yaml                  Approval channel manifest — declares CLI
  docs/
    nexus-blueprint-v1-5-14.md          (this document)
    nexus-engineering-spec-v1-8-27.md   (governing spec — derived from this blueprint)
    nexus-complete-end-to-end-flow-v4.8.md   (canonical outline — LOCKED)
    nexus-owner-ratification-v1-4-12.md (LOCKED)
  keys/
  fixtures/
  schemas/
  scripts/
```

**Spec implementation requirement (per §14.6.1 fail-closed law):** spec v1.8.27 MUST
implement loaders, schemas, and starter fixtures for ALL FOUR manifest domains. There
is no "schema-locked but not runtime-loaded" carve-out — §14.6.1 fail-closed loading
law would contradict that. The starter fixtures point at already-existing
implementations (RIA, stub/vault connectors, CLI approval channel) plus the new
endpoint adapter set. This is manifest-registry implementation, not new product surface.

### Reasoning

r1 monorepo structure preserved. r2 changes per audit S9-T8 + owner contradiction
ruling: explicit "spec implements all four manifest loaders, no carve-out" paragraph
appended to the fragment so r2's F-07 cannot be read as permitting a docs-only manifest
path list. RIA description updated to acknowledge it ships as the default enabled
identity-provider manifest entry (per §14.6.6). Per audit's "Final audit call" S9-T8:
"four loaders" means manifest-registry declarations for already-known interfaces, not
building new IAM/connectors/transports — pinned in the requirement paragraph.

---

## F-08 — §30 new drift rules (APPEND) — r2 revised

**Target:** end of §30 (after line 1974)
**Action:** APPEND
**Closes:** HOLE-S9-002, ADD-S9-002, ADD-S9-003, DIFF-S9-001, streaming, import-law allow-list
**r2 changes:** cross-manifest duplicate-fail rule rewritten as within-domain + qualified-reference rule (Pushback 1); transport import-law positive allow-list (Pushback 3)

### Before

(last bullet of §30)

```
- do not let NVG routing policy contain a rule that routes sensitive data to a frontier tier
```

### After (append additional drift rules after the existing list)

```
- do not let NVG routing policy contain a rule that routes sensitive data to a frontier tier
- do not let a transport adapter inspect, classify, route, deny, redact, summarize,
  truncate, cache, replay, or mutate semantic payload content
- do not let a transport adapter request streaming responses in this version
- do not let the endpoint manifest expose a stream field
- do not let a transport adapter or transport registry be wired through module-level
  singleton state — DI is explicit
- do not let any signed manifest (§14.6) be loaded without signature verification
- do not let a signed manifest be hot-reloaded — load is once, at startup
- do not let two entries in the same manifest domain register the same primary
  identifier
- do not reference cross-domain entries without a qualified domain prefix
  (`identity:<providerId>`, `endpoint:<endpointId>`, `connector:<connectorId>`,
  `channel:<channelId>`) in audit records, CLI output, management API output, or
  cross-domain references
- do not let opaque model output enter the Routing Provenance Trail or any other audit
  stream — opaque content is carried, never logged
- do not let `enabled: false` and `healthy: false` be conflated in any registry —
  one is operator config, one is runtime state
- do not let an empty / all-disabled manifest produce a degraded-runtime startup —
  fail closed
- do not let `packages/vanguard/src/transport/` import from any source outside the
  approved allow-list:
    - `@nexus/contracts` (Layer 2)
    - relative imports inside `packages/vanguard/src/`
    - Node built-ins approved by the engineering spec
    - external libraries explicitly approved by the engineering spec for HTTP, YAML,
      or schema validation
  Any other import is a build violation enforced by ci:gate Step 19.
```

### Reasoning

r1 drift rules preserved minus the cross-manifest fail-load rule. r2 changes per audit
S9-T8 + owner rulings: cross-manifest duplicate-fail replaced with within-domain
uniqueness + qualified-reference rule (Pushback 1 ruling); final import-law rule
expanded into a positive allow-list per Pushback 3 / audit S9-T8 — the spec amendment
locks the specific approved external libraries (and the specific HTTP primitive,
`globalThis.fetch`, per Owner Pushback 3 ruling). The allow-list closes the failure mode
where a misbehaving transport adapter pulls in `axios` or `node-fetch` and the layer-law
gate misses it.

---

## F-09 — §36 deferred items (UPDATE-PARAGRAPH) — r2 revised

**Target:** §36 (lines 2271–2304)
**Action:** UPDATE-PARAGRAPH
**Closes:** streaming-deferred queue, Option C deferral note, subsection-label correction
**r2 changes:** explicit subsection-label-correction note (audit S9-T8)

### Before

```
### 35.1 Deferred from This Build — Production Targets (Interface Contracts Locked)

[...]

### 35.2 Deferred to Future Blueprint Versions

[...]
```

### After (replace the entire §35.1 + §35.2 block; renumber subsections to match top-level §36)

```
### 36.1 Deferred from This Build — Production Targets (Interface Contracts Locked)

These items have interface contracts locked in this version. They are production targets
for the next build cycle. No partial implementation, no stub, no placeholder code for
any of these items exists in this version.

- **REST Adapter v2**: adapter interface locked in Layer 4. Implementation next cycle.
- **Webhook Approval Channel (Channel v2)**: approval channel interface locked in Layer 2.
  Implementation next cycle.
- **NISP-001.S — Streaming Transport**: transport adapter interface locked in this
  version (§13.6, §14.5). Streaming-specific governance contract (timeout semantics,
  audit completion timing, response-size accounting, cancellation, partial-output
  handling, post-inference normalization boundaries) deferred to a dedicated future
  amendment.
- **Reference Runtime — Workspace / Orchestrator / Compile (Option C)**: blueprint
  surfaces locked at concept level (§10, §11, §21). Service interfaces and reference
  implementation deferred to a dedicated future amendment. The runtime-surface plug-in
  pattern of §14.6 admits an additional manifest domain (runtime surfaces) when this
  amendment lands; no rebuild of the manifest mechanism is required.

### 36.2 Deferred to Future Blueprint Versions

These items are named as future deliverables. They are not blocked, not scoped, and not
started in this version. No code or interface for any of these items belongs in this build.

- Dashboard UI (Layer 7 — browser-based governance surface)
- Slack Approval Channel (Channel v3)
- PostgreSQL ledger backend (Backend v2)
- S3 ledger backend (Backend v3)
- Multi-node ledger replication
- SOC 2 export formatting
- Production Kubernetes manifests
- Connector marketplace / self-service connector onboarding
- Self-service actor registration portal
- MFA / SSO for approver identity
- Live credential rotation automation
- Okta / Azure AD / AWS IAM connector packages (enterprise-provided by integrator)
- Advanced NVG content classification beyond label-enforcement (ML-assisted labeling
  is off by default; full ML classification pipeline is deferred)
- Multi-party orchestrator (multi-layer orchestration tree)
- Cross-enterprise run ledger federation
- NVG cost management and optimization surfaces
- Per-domain manifest keypairs (manifest mechanism in §14.6 currently uses a single
  control-plane keypair across all four domains; per-domain keys are a hardening
  upgrade)
- Full seven-layer package-boundary import-law gate (Step 19 in this version is
  transport-narrow; full layer-law gate queued)
```

**Note on numbering:** the v1.5.13 source file labels these subsections `### 35.1` and
`### 35.2` despite living under top-level `## 36. Deferred Items`. r2 corrects the
subsection labels to `### 36.1` and `### 36.2` to match the parent. **This is a
subsection-label correction under existing top-level §36, not a top-level section
renumber.** No top-level section in this blueprint is renumbered by this amendment.

### Reasoning

r1 deferred-items content preserved. r2 changes per audit S9-T8: explicit note that the
35.x → 36.x correction is sub-label only, not top-level renumbering. Other content
unchanged.

---

## F-10 — §37 Final Blueprint Statement (UPDATE-PARAGRAPH) — r2 revised

**Target:** §37 (lines 2308–2349)
**Action:** UPDATE-PARAGRAPH (small edits only)
**Closes:** meta — final-statement language alignment
**r2 changes:** precise adapter naming per audit S9-T8

### Before

```
Nexus Stack v1.5.13 is a two-checkpoint, seven-layer, TypeScript-strict governed runtime for
the full human → agent → model → action → compile → user loop. [...]

One wall enforcement engine (NVG) governs data egress to model tiers. One authority engine
(NXS) governs system actions through seven fixed gates, default-deny. [...]

Protocol adapters are additive — MCP is Adapter v1. Connectors are additive — Vault is
the reference. Approval channels are additive — CLI is Channel v1. Model tiers are additive
— registry-governed open strings. Identity providers are swappable — the interface is the
contract. OCT is immutable per run — assigned by operators, not self-declared by actors.
Operating modes are signed infrastructure configuration — not agent-level settings.
```

### After (apply targeted edits within §37; non-amended paragraphs unchanged)

```
Nexus Stack v1.5.14 is a two-checkpoint, seven-layer, TypeScript-strict governed runtime for
the full human → agent → model → action → compile → user loop. [...]

One wall enforcement engine (NVG) governs data egress to model tiers, dispatches model
calls through provider-specific transport adapters, and carries model output opaquely
back to the orchestrator boundary without inspection. One authority engine (NXS) governs
system actions through seven fixed gates, default-deny. [...]

Protocol adapters are additive — MCP is Adapter v1. Transport adapters are additive —
Ollama, Anthropic Claude, and OpenAI-compatible endpoints ship as reference transport
adapters in this version. Connectors are additive — Vault is the reference. Approval
channels are additive — CLI is Channel v1. Model tiers are additive — registry-governed
open strings. Identity providers are swappable — the interface is the contract; the
Reference Identity Adapter (RIA) is the starter implementation, declared as the default
enabled entry in the identity-provider manifest. The signed-manifest mechanism (§14.6)
provides a single registry pattern for the four plug-in domains: identity providers,
model endpoints, connectors, and approval channels. OCT is immutable per run — assigned
by operators, not self-declared by actors. Operating modes are signed infrastructure
configuration — not agent-level settings.
```

### Reasoning

r1 final-statement edits preserved. r2 changes per audit S9-T8: "OpenAI-compatible
endpoints" instead of "OpenAI" (the wire-format family ships, not the legal/business
provider) — keeps the door open for any provider that exposes the same wire format
without overfitting; "Anthropic Claude" instead of "Anthropic" disambiguates the model
family from the company; RIA's manifest-entry default-enabled status acknowledged here
to align with §14.6.6.

---

## 3. Closing notes for review

**r2 supersedes r1.** r1 is reference for diff purposes only.

**Net surface added by this amendment (unchanged from r1):**
- One new subsection §13.6 expansion (transport-stage law) — r2 adds §13.6.4 HTTP primitive forward-reference
- One new appended rule §13.7.1 (opaque carriage)
- Two new subsections §14.5 and §14.6 (endpoint manifest + signed manifest law) — r2 adds §14.6.4 typed namespaces
- Trail content rule pinned to §22.1
- Monorepo paths in §27 — r2 adds explicit four-loader-required paragraph
- Twelve new drift rules in §30 (eleven retained from r1, one added: cross-domain qualified-reference rule)
- Two new deferred items + Option C deferral note in §36
- Targeted language edits in §37

**Net surface NOT changed:**
- §1 through §12, except for cross-references — unchanged
- §15 through §21 — unchanged
- §23, §24, §25, §26, §28, §29, §31, §32, §33, §34, §35 — unchanged
- All MODULAR rules (§25) — unchanged

**No top-level section renumbering.** All inserts are subsections of existing parents
(§13, §14). The §35.x → §36.x correction in F-09 is subsection-label-only.

**Spec amendment (next deliverable):** `AMEND-spec-v1.8.27-NISP-001-A.md`. Will derive
from this blueprint after owner+audit approval. Per F-07 requirement: must implement
loaders, schemas, and starter fixtures for ALL FOUR manifest domains, plus pin
`globalThis.fetch` as the approved HTTP primitive and prohibit external HTTP client
libraries (per Owner Pushback 3 ruling).

**Owner approval required for merge.** Audit pinned re-review requested per fragment.
After both pass, owner issues the merge command and the blueprint becomes v1.5.14
canonical.

---

*End of AMEND-blueprint-v1.5.14-NISP-001-A-r2.md*

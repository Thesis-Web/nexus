# Nexus — Agent Action Router and Authority Governance Layer

# System Blueprint v0-3-6

# Owner: James Huson / Lake Area LLC

# Version: v0.3.6 | 2026-04-14

# Supersedes: nexus-blueprint-v0-3-5.md

# Canonical law: this document

# Engineering spec: nexus-engineering-spec-v0-4-6.md

---

## Changelog from v0-3-5

Governance cleanup pass. No new gates, no new layers, no new governed types.

1. Header: Build instructions removed as co-canonical law (OA-001). Canonical law is this
   document only. Engineering spec is nexus-engineering-spec-v0-4-6.md. Build instructions
   are builder-operations law only — not product law, not blueprint fallback.

2. §18 Canonical next step: Updated to reference nexus-engineering-spec-v0-4-6.md.

3. Implicit pipeline branch law codified (BS-101): Gate 04 description updated to make
   explicit that the orchestrator branches deterministically on Gate 04 outcome — ALLOW →
   Gate 06, REQUIRE_APPROVAL/ESCALATE → Gate 05 → Gate 06, DENY/ERROR → Gate 07.
   Gate 05 is never invoked on ALLOW paths. Gate 05 is invoked at most once per action.

4. Approval record first-class contract codified (BS-102): §10 updated. The pending
   approval store must expose a getRequest() method. A shared approval-decision service
   (decideApproval) is the single signing path used by both CLI and API.

5. Repo build contract codified (BS-103): All script-referenced config files are declared.
   format:check and lint are distinct script targets. Clean-clone assertion is law.

---

## Changelog from v0-3-4

Third number 4→5: Twenty law-hardening items from conical audit (SOLVE-001 through SOLVE-020).
No new gates, no new layers, no new governed types.

1. §4 Core concepts: version references updated from v0.3.3 set → v0.3.4 set throughout.

2. §7.3 Delegation minting: Added explicit mint-time invariant — root delegation environment
   must equal actor.environment. DelegationError thrown on mismatch (SOLVE-018).

3. §8.1 Gate 01 session law: Clarified that sessions must exist before any action proceeds.
   The MCP adapter auto-create path is prohibited — adapters MUST NOT create sessions from
   caller-supplied headers. Sessions are created only via explicit nexus session start or
   POST /sessions. Gate 01 owns session expiry semantics: SessionStore returns the session
   record regardless of expiry; Gate 01 computes and emits SESSION_EXPIRED denial (SOLVE-007,
   SOLVE-011).

4. §9 Sequential numbering law: Corrected SEQUENCE_ANOMALY emission point. SEQUENCE_ANOMALY
   is emitted by the ledger chain verifier when sequence discontinuity is detected, not by
   an ingress detector. Sequences are engine-assigned at ingress atomically; no ingress
   anomaly is possible. Removed the erroneous "satisfied by other mechanisms" note that
   caused CONTRA-509. SEQUENCE_ANOMALY remains governed law. Chain verifier enforces
   continuity (SOLVE-010, CONTRA-509).

5. §10 Human approval law: Three changes:
   a. ApprovalRequest expiry must equal policy approvalConfig.timeoutSeconds — not a
   hardcoded constant. Invariant: signed expiresAt equals runtime timeout window
   (SOLVE-005).
   b. Approver private-key contract added: approver keys stored at
   keys/approvers/<approverId>.keypair.json (gitignored). Loaded exclusively via
   key-manager.ts by approverId. All approval commands require explicit approverId.
   Dev key fallback permitted in test fixtures only (SOLVE-006).
   c. ApprovalConfig carries a single channelId field (string), not a channels array.
   Ordered multi-channel fallback is deferred to Channel v2 specification. Treating
   channelId as an array is a build violation (SOLVE-016).

6. §11.5 Evidence minimums: delegationSequence added as required evidence field — forensic
   ordering and per-delegation action counter. Not a CCV field; forensic only (SOLVE-009).

7. §11.9 Chain integrity law: Ledger chain verifier must enforce sequence continuity.
   A gap or regression in ledgerSequence is a chain integrity failure. SEQUENCE_ANOMALY
   denial code is emitted for sequence discontinuities detected during verification.
   This closes CONTRA-509: SEQUENCE_ANOMALY is valid governed law with a defined emission
   point (SOLVE-014, CONTRA-509).

8. §12.2 Fingerprint projection law: ExecutionGrantTemplate fingerprint must use a shared
   projection helper that excludes templateFingerprint and approvalLinkage by field omission,
   not undefined substitution. Both buildGrantTemplate and assertTemplateIntegrity must call
   the same helper. Undefined values are illegal in all canonicalized payloads (SOLVE-003,
   SOLVE-004).

9. §12.7 Execution violation law: Gate 06 must catch NexusSecurityViolation separately from
   generic connector errors. A security violation preserves its denialCode, emits a
   ThreatEvent, and maps to denied_threat FinalOutcome. A generic connector error maps to
   error FinalOutcome. These two paths must never be conflated (SOLVE-013).

10. §14 Assertion boundary extended: Management API trust boundary is explicit law:
    Management API binds to 127.0.0.1 only. All mutation routes require a local admin
    bearer token generated at initialization and stored at keys/admin.token (gitignored).
    Production upgrade path: replace bearer token with mTLS or local Unix socket. No
    exposure beyond localhost is permitted in this version (SOLVE-008).

11. §15 POC boundary: Three additions:
    a. MCP session auto-create is explicitly prohibited. No adapter may create a session
    from caller-supplied headers (SOLVE-007).
    b. CLI and MCP proxy bin wiring is law: package.json must define nexus and
    nexus-mcp-proxy bin entries. Build is not operational without them (SOLVE-012).
    c. Fixture scenarios are resolved via SCENARIO_MANIFEST governed constant — not by
    string concatenation. nexus run --scenario accepts a manifest key only (SOLVE-019).

12. §17 Drift prevention: Four new rules added reflecting approved law hardening (SOLVE-007,
    SOLVE-008, SOLVE-016, SOLVE-017).

13. §18 Canonical next step: Updated to reference nexus-engineering-spec-v0-4-4.md.

14. Session identity derivation law (§8.2 new): principalId is derived server-side from
    actor.principalId at session creation. Caller-supplied principalId is rejected.
    Session creation validates actor.principalId == delegation.principalId and rejects
    mismatches (SOLVE-017).

---

## 1. System Purpose

Nexus is a private-runtime, policy-aware action router and authority governance layer for
AI agents and automated systems. It sits inline at the boundary between AI agents and the
real systems those agents act upon. Every action an agent attempts passes through Nexus.
Nexus identifies the actor and the authority they hold, classifies the action, enforces
delegation boundaries, evaluates the action against policy, routes high-risk actions to
human approval, computes and mints bounded execution authority for allowed actions, forwards
execution through governed connectors, and emits a tamper-evident, hash-chained evidence
record for every action regardless of outcome.

Nexus exists because AI agents currently operate with either god-mode static credentials or
full user impersonation. There is no standard runtime layer that knows who the actor is,
what authority they were delegated, whether the action is permitted under policy, whether a
human must approve it, whether the credential used at execution time was correctly bounded
to that specific action and delegation context, and whether the complete chain of custody is
provable and comparable afterward. Nexus is that layer.

The product wedge is runtime authority enforcement and evidence production across systems.
Nexus is not a secrets vault, not an IAM platform, not an OAuth wrapper, not an agent
framework, not a compliance reporting suite, not a model risk manager, and not a chat
interface. Existing tools in each of those categories are plumbing that Nexus governs.

---

## 2. Product Thesis

The product thesis is:

- One engine is built once.
- One runtime contract governs the gate pipeline.
- One fixed authority model governs delegation, execution grants, and approval.
- Protocol adapters connect agents to the engine without baking protocol into the engine.
- Connectors abstract target systems without baking system-specific credential logic into the engine.
- Approval channels abstract human interface without baking channel-specific transport into the approval orchestrator.
- The control interface exposes governance surfaces without exposing engine internals.

If the engine, runtime contract, and execution-grant law are built correctly, new adapters,
new connectors, and new approval channels are additive implementations, not architectural
rewrites. This is the core portability law of Nexus and it is enforced from the first line of code.

The approved v0.3.4 POC uses MCP as Adapter v1. MCP being the first adapter does not make
the engine an MCP system. The engine is protocol-agnostic. MCP is a pluggable surface.

Nexus is intentionally positioned as an authority broker and governed action router, not as
a token storage system. Vaults, OAuth servers, cloud identity services, and secrets managers
are infrastructure that sits behind Nexus connectors. Nexus governs the authority that flows
through them — it does not replace them.

---

## 3. Scope Boundary

### 3.1 Included in Blueprint Scope

This blueprint defines:

- system purpose and trust model
- core concept definitions at architecture level including compiler comparison contract
- control-plane and data-plane responsibilities with gate assignments
- five-layer architecture
- actor model, actor class law, Principal definition, and non-human identity law
- delegation model, delegation-chain law, and trust boundaries
- gate pipeline structure and gate responsibilities
- modularity law enforced from initial build
- security posture, threat surface model, and black-hat design posture
- token and execution-grant governance law
- human approval law and signed approval contract with mandatory payload minimums
- evidence ledger law, intent evidence minimums, execution-grant metadata minimums,
  redaction law, and compiler comparison view
- assertion boundary and certification language prohibition
- POC boundary and 10-scenario proof matrix
- portability thesis
- drift prevention rules
- canonical next steps

### 3.2 Excluded from Blueprint Scope

This blueprint does not define:

- implementation code
- exact TypeScript interfaces and field-level schemas (engineering spec)
- governed constant value sets (engineering spec)
- database schema detail (engineering spec)
- API field-by-field definitions (engineering spec)
- exact signature envelope fields and key-rotation cadence (engineering spec)
- redaction marker format and redaction schema (engineering spec)
- field-level CCV schema and derivation rules (engineering spec; blueprint fixes semantic
  fields, invariants, and comparability law only)
- vendor lock to any model provider, cloud provider, or protocol
- detailed infrastructure manifests
- pricing or commercial terms
- connector-specific integration behavior

---

## 4. Core Concepts

These are the governed concepts at architecture level. Field-level definitions belong in the
engineering spec. These definitions are sufficient to constrain the spec and the builder
without becoming the spec.

**Actor**: A runtime identity that initiates or participates in an action. An Actor has a
registered class, a principal, an environment, and a bounded authority ceiling. Actor class
is an open governed type. The v0.3.4 governed actor classes are defined in §7.1.

**Principal**: The human or organizational identity whose authority an Actor is borrowing.
A Principal is not an Actor class — it is the upstream owner of delegated authority. Every
Actor must have a resolvable Principal. A Principal may not delegate more authority than the
Principal holds.

**DelegationContext**: A signed, time-bounded, scope-bounded authority grant from a Principal
to an Actor for a session. The DelegationContext carries actor identifier, principal
identifier, allowed systems, allowed capabilities, forbidden capabilities, maximum risk tier,
chain depth, parent context reference if sub-delegated, downstream propagation flag,
environment, expiry, and the signature of the issuing control plane. No actor may exceed the
authority defined in its DelegationContext.

**Session**: A runtime association between an Actor, a Principal, and a DelegationContext
that establishes the identity context for a bounded set of actions. Sessions are created
explicitly by the CLI (nexus session start) or management API (POST /sessions). No adapter
may create a session from caller-supplied headers. Session expiry is checked at Gate 01;
Gate 01 owns the expiry decision.

**Capability**: A normalized description of what an action does, more specific than a verb
alone. A Capability is resolved from the combination of ActionVerb, target resource type,
and action context at classification time. Capability is an open governed type. The v0.3.4
capability set, taxonomy version, and mapping rules are defined in the engineering spec.

**ActionVerb**: The operation class of an action. ActionVerb is an open governed type. The
v0.3.4 set is: read, create, update, delete, send, publish, export, execute. A Capability
is resolved from ActionVerb plus target context, not from ActionVerb alone.

**RiskTier**: A governed classification of action risk level computed deterministically from
Capability, DataClass, target environment, and external-facing flag. RiskTier is an open
governed type. The v0.3.4 set is: low, medium, high, critical.

**DataClass**: The sensitivity class of data touched by an action. DataClass is an open
governed type. The v0.3.4 set is: public, internal, confidential, pii, phi, financial. An
action may carry multiple data classes.

**Environment**: The deployment environment in which an action occurs. Environment is an open
governed type. The v0.3.4 set is: dev, staging, production. Environment is a required
dimension for actor registration, risk computation, delegation context, grant scoping, and
evidence. Two logically identical actions in dev versus production are not semantically
equivalent for comparison purposes.

**OutcomeLabel**: The normalized label for a policy evaluation outcome. OutcomeLabel is an
open governed type. The v0.3.4 set is: allow, deny, require_approval, escalate.
OutcomeLabel must be stored as a governed constant in EvidenceRecord — not derived from prose.

**ApprovalDecisionLabel**: The normalized label for a human approval decision.
ApprovalDecisionLabel is an open governed type. The v0.3.4 set is: approved, denied,
timed_out. ApprovalDecisionLabel must be stored as a governed constant in EvidenceRecord —
not derived from prose.

**FinalOutcomeLabel**: The normalized label for the final disposition of an action.
FinalOutcomeLabel is an open governed type. The v0.3.4 set is: executed, denied_identity,
denied_classification, denied_delegation, denied_policy, denied_approval, denied_timeout,
denied_threat, error.

**ExecutionGrant**: A short-lived, scope-bounded, signed runtime authority artifact that
allows a connector to execute a specific action under specific identity, scope, constraints,
and expiry. ExecutionGrants are minted by the engine at Gate 06 under the template computed
at Gate 04. They are produced as a function of identity, delegation context, policy outcome,
capability, and approval state.

**CredentialSubject**: The identity a downstream system sees when an ExecutionGrant is
redeemed by a connector. CredentialSubject selection is explicit engine law, not implicit
connector behavior.

**ExecutionGrantTemplate**: An intermediate artifact computed by Gate 04 at policy evaluation
time. The template specifies the required capability scope, expiry class, CredentialSubject
category, resource bounds, environment bound, approval linkage requirements, and approval
routing config. Gate 04 is the single authoritative computation point for grant template law.

**ApprovalRequest**: A signed artifact issued by the control plane when a high-risk action
requires human decision. Mandatory fields are defined in §10. An ApprovalRequest is a
first-class legal artifact. ApprovalRequest expiry must equal the policy approvalConfig
timeoutSeconds. These must be identical — signed expiry and runtime timeout are an invariant.

**ApprovalResponse**: A signed artifact produced by a registered human approver who has
reviewed an ApprovalRequest. An unsigned or unverifiable ApprovalResponse always produces
DENY. Timeout responses are system-generated and must never reach the external verification path.

**EvidenceRecord**: An immutable, hash-chained, Ed25519-signed record of an action's
complete lifecycle through the gate pipeline. Mandatory content is defined in §11.

**CompilerComparisonView (CCV)**: A reduced, stable, versioned semantic view derivable from
every EvidenceRecord. The CCV is the canonical surface the compiler uses to compare agent
logic across runs, agents, and versions. Two runs are logically comparable if they share the
same blueprint version, runtime contract version, capability taxonomy version, and comparison
input version. The CCV is not a second ledger — it is a derived view materialized from the
EvidenceRecord at write time and stored within the signed EvidenceRecord body.

---

## 5. Plane and Layer Stack

Nexus is a five-layer system ordered from lowest, most reusable runtime substrate to highest,
thinnest human-facing surface. Across those layers the architecture is split into two planes.

### 5.1 Control Plane and Data Plane

**Control Plane**: Owns every decision. Actor resolution, delegation verification, policy
evaluation, ExecutionGrantTemplate computation, approval orchestration, approval signature
verification, execution-grant minting, ledger write and chain management, CCV materialization.

**Data Plane**: Owns every forwarding operation. Ingress normalization, protocol translation,
connector forwarding, result capture, and redaction before evidence write.

**Gate-to-Plane Assignment:**

| Gate                     | Plane                                                 |
| ------------------------ | ----------------------------------------------------- |
| Gate 01 — Identity       | Control                                               |
| Gate 02 — Classification | Control                                               |
| Gate 03 — Delegation     | Control                                               |
| Gate 04 — Policy         | Control                                               |
| Gate 05 — Approval       | Control                                               |
| Gate 06 — Execution      | Control (grant minting) + Data (connector forwarding) |
| Gate 07 — Evidence       | Control                                               |

Gate 06 is hybrid. The grant minting sub-step is control-plane law. The connector forwarding
sub-step is data-plane operation. These two sub-steps must be physically distinct and must
not share mutable state.

### 5.2 Layer 1 — Core Engine

The core engine is the gate pipeline and its internal subsystems. It receives a canonical
AgentAction envelope from any adapter and executes all seven gates in fixed order. It
enforces gate order and default-deny at every gate. It owns execution-grant template
computation and grant minting under §12 law. It materializes the CCV within the signed
EvidenceRecord at Gate 07. It writes an evidence record for every action regardless of
outcome.

Layer 1 is built first. Layer 1 must never import adapter-specific, connector-specific,
channel-specific, or control-interface-specific code.

### 5.3 Layer 2 — Runtime Contract

The runtime contract is the law the engine obeys. It defines all contract shapes listed in
§4, all governed type constants for the v0.3.4 set, the gate contract interface, the ledger
backend interface, the adapter interface, the connector interface, and the approval channel
interface.

Layer 2 must be fixed before any adapter, connector, or interface is implemented.

### 5.4 Layer 3 — Protocol Adapters

Protocol adapters translate incoming agent actions from a specific wire protocol into the
Layer 2 canonical AgentAction envelope. Adapters extract intent context from protocol-specific
metadata. Adapters never alter gate behavior, never mint credentials, and never define
authority law. MCP proxy is Adapter v1.

**Adapters MUST NOT set or override environment.** Environment is an actor-registration
property, resolved from the actor registry at Gate 01. No adapter-provided header, field,
or parameter may influence the ResourceTarget.environment used in risk computation,
delegation enforcement, or evidence. This prohibition applies to all adapters, not only MCP.

**Adapters MUST NOT create sessions.** Sessions are created exclusively via nexus session
start or POST /sessions. Any adapter that auto-creates a session from caller-supplied headers
is violating the control-plane trust boundary.

### 5.5 Layer 4 — Connector Registry

The connector registry holds pluggable connectors for executing actions against target
systems. Connectors redeem execution grants through governed paths. They must never define
credential law, never pull long-lived base secrets directly from configuration, and never
expand scope beyond what the grant specifies.

### 5.6 Layer 5 — Control Interface

The control interface exposes governance surfaces to human operators. CLI, management API,
and eventually a browser dashboard. Layer 5 is built last.

---

## 6. Build Order

Fixed:

1. Layer 1 — Core Engine
2. Layer 2 — Runtime Contract
3. Layer 3 — MCP Adapter v1
4. Layer 4 — Connector implementations (vault as reference; stub for testing)
5. Layer 5 — CLI, management API, dashboard

No dashboard or second adapter before integration tests are green.

### 6.1 POC Operating Mode

Human-as-interface-first mode. A human operator may manually trigger approval decisions,
inspect ledger output, inspect token posture, and validate gate outcomes at each stage.
This is a deliberate early operation mode. Later addition of automated flows and dashboard
is additive evolution.

---

## 7. Actor Model and Trust Boundaries

### 7.1 Actor Classes and Principal

**Principal**: The upstream human or organizational identity whose authority an Actor is
borrowing. Every Actor must have a resolvable Principal at session start. A Principal may
not delegate more authority than the Principal holds.

Actor classes — open governed type, v0.3.4 set:

**HUMAN** — Person directly operating. Acts as their own Principal unless delegating.

**HUMAN_WITH_COPILOT** — Person operating with AI copilot. Human is initiating Principal.
Copilot acts under bounded delegation.

**SUPERVISED_AGENT** — Automated agent operating under active human supervision. Must have
an identifiable human Principal who owns the action on their behalf.

**AUTONOMOUS_AGENT** — Automated agent operating without live human oversight. Requires
stronger controls: owner registration, review cadence, narrower risk ceiling.

**SCHEDULED_AGENT** — Batch or cron job. Operates under a registered schedule. Limited
to non-interactive, pre-approved capabilities.

**DELEGATED_SUBAGENT** — An agent that receives sub-delegated authority from another agent.
The parent agent's DelegationContext defines the ceiling for the sub-agent's authority.
Sub-agent delegation cannot expand beyond parent bounds.

**SERVICE_AUTOMATION** — Infrastructure-level service or bot. Non-human, always requires
registered owner and purpose.

### 7.2 Non-Human Identity Law

Non-human actors (all classes except HUMAN and HUMAN_WITH_COPILOT) must be registered with:
owner identity, purpose statement, and review cadence. Gate 01 rejects non-human actors with
incomplete registries.

### 7.3 Delegation Minting Law

DelegationContext is minted by the control plane. Minting law:

- A Principal may not delegate capabilities they do not hold.
- A Principal may not delegate systems outside their registered allowedSystems.
- A Principal may not delegate risk above their maxDelegableRiskTier.
- Root delegation environment must equal actor.environment. Minting a root delegation with
  a different environment from the actor is prohibited. DelegationError thrown on mismatch.
- Sub-delegation cannot expand allowedSystems, allowedCapabilities, or maxRiskTier beyond
  the parent DelegationContext.
- All DelegationContexts are signed by the control-plane private key at mint time.

---

## 8. Gate Pipeline

### 8.1 Gate 01 — Identity and Session Law

Gate 01 resolves the runtime identity tuple: Actor, Principal, Session, DelegationContext.
It enforces all identity prerequisites before any other gate runs.

Session law:

- Sessions must exist before any action proceeds through the gate pipeline.
- Sessions are created exclusively via explicit nexus session start (CLI) or POST /sessions
  (management API). No adapter may create a session from caller-supplied headers.
- Gate 01 calls SessionStore.get(sessionId) to retrieve the session record regardless of
  expiry state. If null (session not found), Gate 01 returns SESSION_NOT_FOUND.
- Gate 01 computes session expiry explicitly: if session.expiresAt ≤ now, Gate 01 returns
  SESSION_EXPIRED. SessionStore does not own expiry semantics.
- SessionStore.get() returns the session record regardless of expiry. The store does not
  filter by expiry. Gate 01 is the sole owner of the SESSION_EXPIRED decision.

principalId derivation law:

- principalId is derived server-side from actor.principalId at session creation time.
- Session creation API (POST /sessions and nexus session start) do not accept a
  caller-supplied principalId field. It is computed from the actor registration.
- The engine validates actor.principalId == delegation.principalId at session creation.
  Mismatch throws and session creation is rejected.

### 8.2 Gate 02 — Classification

Gate 02 normalizes the raw action verb, resolves the target, classifies data classes,
resolves the Capability identifier, and computes the RiskTier. All resolved fields are
written back to the AgentAction envelope for downstream gates. Adapter-provided environment
values are never trusted — actor.environment from the Gate 01 context is the only
authoritative environment source for ResourceTarget.

### 8.3 Gate 03 — Delegation

Gate 03 verifies the DelegationContext signature, checks delegation expiry, enforces scope
ceilings, enforces environment match between resolved target and delegation, enforces chain
depth, checks propagation permission, and builds the DelegationContextSnapshot from the
full chain. A broken chain (missing parent delegation) throws DelegationChainIntegrityError
and Gate 03 returns CHAIN_INTEGRITY_BROKEN. Gate 03 MUST deny any action where the resolved
target environment differs from the delegation context environment.

### 8.4 Gate 04 — Policy

Gate 04 evaluates the loaded policy bundle, finds the first matching rule in priority order,
determines the OutcomeLabel (allow, deny, require_approval, escalate), computes the
ExecutionGrantTemplate under §12 law. Default-deny if no policy loaded or no rule matches.
Gate 04 is the single authoritative point for grant template computation. No connector,
adapter, or channel may supplement or override template computation.

Pipeline branch law: The orchestrator branches explicitly on Gate 04's OutcomeLabel.

- ALLOW → Gate 06 → Gate 07
- REQUIRE_APPROVAL or ESCALATE → Gate 05; if Gate 05 passes → Gate 06 → Gate 07; if Gate 05 denies/times out/errors → Gate 07
- DENY or ERROR → Gate 07

Gate 05 is never invoked on ALLOW paths. Gate 05 is invoked at most once per action.
Gate 06 is never invoked before Gate 04 passes. Gate 06 is never invoked on an
approval-required path without a resolved, verified ApprovalResponse.
Gate 07 always runs exactly once per action.

The orchestrator is an explicit stateful control-flow pipeline — not a generic gate loop
that naively iterates over all seven gates. Gate 05 and Gate 06 conform to the standard
gate interface `evaluate(action, context, priorDecisions)`. Branch control lives in the
orchestrator, not in gate modules.

### 8.5 Gate 05 — Approval

Gate 05 orchestrates human approval for require_approval or escalate outcomes. It packages
and signs the ApprovalRequest (with expiry equal to approvalConfig.timeoutSeconds), dispatches
to the registered approval channel, awaits a signed ApprovalResponse, verifies the approver
signature against the approver registry, and processes the decision. Timeout always produces
DENY — never allow. A single channelId from ApprovalConfig governs routing.

### 8.6 Gate 06 — Execution

Gate 06 is the data-plane gate. Control sub-step: assertTemplateIntegrity(), mintGrant().
Data sub-step: connector.redeemGrant(), connector.execute(). NexusSecurityViolation must
be caught separately from generic connector errors: a security violation emits a ThreatEvent
and maps to denied_threat; a generic connector failure maps to error. Grant secret is cleared
from vault in a finally block after every execution attempt.

### 8.7 Gate 07 — Evidence

Gate 07 always runs regardless of upstream outcomes. It builds the complete EvidenceRecord,
materializes the CCV inside the record body, computes the record hash over the full body
including CCV, signs the hash, and appends to the ledger. Evidence is always written — even
on pipeline crash, partial evidence is preferred to no evidence.

### 8.8 Default-Deny Posture

Every gate is default-deny. An action reaches the next gate only when the current gate
explicitly passes. No gate assumes permission. No gate can be skipped by upstream outcome
(Gate 07 runs always).

---

## 9. Token and Action Replay

### 9.1 Replay Detection

The engine assigns a unique actionId at ingress. The replay detector checks actionId
uniqueness in a SQLite-backed dedup table over a configurable TTL window (default 3600s).
A repeated actionId within the window produces DENIED with REPLAY_DETECTED and a ThreatEvent.

### 9.2 Sequence Assignment

The engine assigns a delegationSequence at ingress — a monotonically increasing counter per
delegationContext. Sequences are engine-assigned only. Adapters never provide sequence
numbers. Sequence numbers are stored in the EvidenceRecord.actionSummary for forensic
ordering and audit. delegationSequence is a forensic field, not a CCV field.

### 9.3 Sequence Anomaly Law

SEQUENCE_ANOMALY is a governed denial code. It is emitted by the ledger chain verifier when
sequence discontinuities are detected — gaps or regressions in ledgerSequence across evidence
records. Sequences are engine-assigned atomically at ingress; no sequence anomaly is possible
at runtime without post-write tamper. The chain verifier checks expectedSeq continuity on
every verification pass. A gap or regression emits a ChainError with type sequence_anomaly
and denialCode SEQUENCE_ANOMALY. The §17.1 note in spec v0.4.3 that declared the requirement
"satisfied by other mechanisms" was drift and is removed in v0.4.4.

### 9.4 Replay TTL Bounds

TTL is configurable with bounds: minimum 300s, maximum 86400s. Default 3600s. Value outside
bounds: engine refuses to start. A decrease below default is logged as a posture change.

---

## 10. Human Approval Law

### 10.1 When Approval Is Required

Any action with OutcomeLabel require_approval or escalate from Gate 04 must pass through
Gate 05 before Gate 06 may run. Timeout always produces DENY. The machine never
auto-approves an action due to timeout.

### 10.2 ApprovalRequest Minimums

Every ApprovalRequest must carry: approvalId, actionId, templateId, issuedAt, expiresAt,
actionSummary, contextSummary, proposedTarget, diff (if connector produces one), estimatedImpact,
principalDisplayName, actorDisplayName, riskTier, dataClasses, modelConfidence, riskNote,
signature (Ed25519 over canonicalized body).

### 10.3 Expiry Invariant

ApprovalRequest.expiresAt must equal addSeconds(issuedAt, approvalConfig.timeoutSeconds).
The signed expiry and the runtime timeout decision window must be identical. Hardcoded expiry
constants are prohibited. This is an invariant enforced by test.

### 10.4 Approver Key Contract

Approver private keys are stored at keys/approvers/<approverId>.keypair.json (directory
gitignored). Keys are loaded exclusively via key-manager.ts by approverId. No approval
command proceeds without an explicit approverId. Dev key fallback is permitted in test
fixtures only, labeled FIXTURE_SYNTHETIC_SECRET. Approver public keys are stored in the
approver registry. ApprovalResponse signature is verified against the registry public key
before acceptance.

### 10.8 Approval Decision Service Law

The pending approval store must expose a getRequest(approvalId) method that returns the
stored, signed ApprovalRequest JSON for that approval ID. Both CLI and management API
approval handlers must use a single shared approval-decision service
(decideApproval(approvalId, approverId, decision, note?)) as the sole signing path.
No duplicate approval-signing logic may exist across CLI and API surfaces. The shared
service must:

1. load the pending record — reject if not found
2. reject if status is not pending
3. parse the stored ApprovalRequest via getRequest()
4. reject if expired
5. load the approver key via key-manager.ts
6. build and sign the ApprovalResponse
7. persist via store.resolve()

CLI and management API are thin shells that call this service. They do not re-implement
signing logic independently.

### 10.5 ApprovalResponse Verification

Gate 05 verifies the approver's Ed25519 signature against the registered public key before
accepting any decision. An unsigned response, a response signed by an unregistered approver,
or a response with an invalid signature always produces DENY with APPROVAL_SIG_INVALID.
System-generated timeout responses (decidedBy: 'system:timeout') are never sent through
external signature verification.

### 10.6 Approval Channel Law

For this version, ApprovalConfig carries a single channelId (string). Ordered multi-channel
fallback is deferred to Channel v2. Gate 05 resolves the channel from the registry by
channelId. APPROVAL_CHANNEL_NOT_FOUND is returned if channelId is not registered. CLI is
Channel v1 (channelId: 'cli'). No webhook code, stub, or partial implementation exists in
this version.

### 10.7 Signed Approval Chain

The control plane signs the ApprovalRequest. The approver signs the ApprovalResponse. Both
signed artifacts are stored in EvidenceRecord. The full signed chain is provable from a
clean ledger read without any other context.

---

## 11. Evidence Ledger Law

### 11.1 Append-Only

The evidence ledger is append-only. No UPDATE or DELETE operation may exist on the ledger
interface. Chain integrity depends on immutability.

### 11.2 Hash Chain

Every EvidenceRecord carries previousHash (SHA-256 of the prior record) and recordHash
(SHA-256 of the full canonicalized record body including CCV). The first record carries
GENESIS_HASH as previousHash.

### 11.3 Signing

Each EvidenceRecord is signed by the control-plane Ed25519 private key at write time.
Signature covers recordHash — the hash of the full body including CCV.

### 11.4 Always-Write

Every action — allowed, denied, approval-denied, timed-out, or errored — produces an
EvidenceRecord. Gate 07 is never conditional.

### 11.5 Intent and Rationale Minimums

Every EvidenceRecord must include:

- actor identity and actor class
- principal identity
- environment (from actor registration — guaranteed present even on pre-classification failures)
- delegation-context identifier and chain snapshot (all hops)
- delegationSequence (engine-assigned per-delegation counter; forensic ordering; not in CCV)
- classified Capability
- ActionVerb
- target resource type
- DataClasses
- RiskTier
- objective summary (bounded extraction from intent context)
- triggering source or event
- toolchain or adapter context available at execution time
- model identity and model confidence when present
- policy rule identifier matched and OutcomeLabel
- approval-required flag
- ApprovalDecisionLabel when applicable
- FinalOutcomeLabel

### 11.6 Execution-Grant Metadata Minimums

EvidenceRecord must include execution-grant metadata sufficient to prove authority without
exposing the secret. At minimum: grant identifier, scope descriptor, CredentialSubject type,
expiry class, issuance time, expiry, approval linkage, and template fingerprint. Secret
value must never be written into evidence.

### 11.7 Redaction Law

Before EvidenceRecord write, redact: PII, PHI, financial data in results; base-secret values
in any field; raw model prompts containing sensitive data; reasoning traces containing
sensitive user data; intent fields exceeding the defined length ceiling (truncate and flag).
Redacted fields replaced by governed redaction marker from engineering spec. Redacted fields
not removed — record remains structurally complete.

### 11.8 Compiler Comparison View (CCV)

Every EvidenceRecord must contain a materialized CompilerComparisonView within its signed
body. The CCV is the stable semantic surface the compiler uses for cross-agent, cross-run,
cross-version logic comparison. The CCV is inside the tamper-evident boundary: it is included
in the body before the record hash is computed.

Field-level CCV schema is defined in the engineering spec. This blueprint fixes only the
semantic fields, invariants, and comparability law listed here. CCV field definitions are
blueprint law: they may not change without a blueprint version bump.

Capability taxonomy version must be persisted in EvidenceRecord and CCV. Environment is a
required CCV field and part of the comparison key.

Two actions are logically comparable if they share: same blueprint version, same runtime
contract version, same capability taxonomy version, same comparison input version, and same
actor class, environment, capability, data classes, and risk tier.

For comparable actions, differences in OutcomeLabel, ApprovalDecisionLabel, CredentialSubject
type, scope descriptor, or FinalOutcomeLabel are treated as meaningful logic differences,
not noise.

The CCV must include at minimum:

meta section: blueprint version, runtime contract version, capability taxonomy version,
comparison input version, normalized action hash (SHA-256 of canonical action envelope),
policy bundle hash (hash of loaded policy file)

identity section: actor identifier, actor class, principal identifier, environment

delegation section: delegation context identifier, chain depth, chain hash (SHA-256 of
canonical chain snapshot), maximum risk tier from delegation

classification section: capability identifier, action verb, data classes sorted, risk tier

policy and approval section: policy rule identifier, OutcomeLabel, approval-required flag,
ApprovalDecisionLabel

authority and execution section: execution grant identifier, CredentialSubject type, scope
descriptor, expiry class, ExecutionGrantTemplate fingerprint (SHA-256 of template minus live
credential)

result section: FinalOutcomeLabel, error code family

### 11.9 Chain Integrity and Sequence Continuity

The chain verifier must enforce both hash linkage and sequence continuity. A gap or regression
in ledgerSequence is a chain integrity violation. SEQUENCE_ANOMALY is emitted for sequence
discontinuities detected during chain verification. Sequence continuity enforcement is not
optional — a ledger with sequence gaps is not a valid ledger.

---

## 12. Token and Credential Governance Law

### 12.1 Base Secrets and Storage

Base secrets must live only in a governed vault connector or cloud identity path. Never
injected into agents, adapters, or approval payloads. Static tokens in code, config, or
chat logs are build violations. Test fixtures MAY contain synthetic secrets explicitly
labeled as non-production (using the FIXTURE_SYNTHETIC_SECRET prefix); such secrets must
never be used outside test harnesses.

### 12.2 Execution-Grant Law and Fingerprint Projection

ExecutionGrants must be short-lived, action-bounded or narrowly scoped, produced as a
function of the specific actor/delegation/policy/approval state for this action, a strict
subset of the DelegationContext that authorized them, and kept in memory only for the
duration of the action.

The ExecutionGrantTemplate fingerprint must be computed using a shared projection helper
that excludes templateFingerprint and approvalLinkage from the payload by field omission —
not by undefined substitution. buildGrantTemplate and assertTemplateIntegrity must call the
same helper. Any deviation between the two computation paths is a security violation.

Undefined values are illegal in all canonicalized payloads. The canonicalize() function must
strip undefined-valued keys and throw if a non-key undefined is encountered. This law applies
to all signature and hash computation paths.

### 12.3 Scope Law

Every ExecutionGrant scoped at minimum by: target system, Capability, relevant resource
bounds, and expiry. Scope law must distinguish at minimum: read-one versus bulk-export;
draft versus send; internal update versus customer-facing write; view-analytics versus
extract-PII.

### 12.4 Credential Subject Law

CredentialSubject selection is explicit engine law determined by the ExecutionGrantTemplate
at Gate 04. Connectors implement redemption against the specified CredentialSubject type —
they do not choose it.

### 12.5 Rotation and Posture

Rotation priority: write/send/publish/delete/export on customer-facing systems → high;
write on internal → medium; read-only on internal → low. Control interface must expose
token posture summary.

### 12.6 Cross-Connector Portability

ExecutionGrants must be redeemable across connector implementations without engine changes.
Engine produces grant; connector redeems it through the connector interface.

### 12.7 Execution Violation Law

NexusSecurityViolation must be caught separately from generic connector errors in Gate 06.
A security violation (broad token bypass, expired grant, template integrity failure) emits
a ThreatEvent, preserves its denialCode, and maps to denied_threat FinalOutcome.
A generic connector failure (network error, service unavailable) does not emit a ThreatEvent
and maps to error FinalOutcome. These two categories must never be conflated.

---

## 13. Modularity Law

**MODULAR-001**: Protocol never baked into core engine. Adapters implement the adapter
interface. MCP is Adapter v1.

**MODULAR-002**: Actor class is a governed open string type. Never a closed TypeScript
union ceiling.

**MODULAR-003**: Ledger backend is an interface. JSONL is Backend v1.

**MODULAR-004**: Approval channel is an interface. CLI is Channel v1.

**MODULAR-005**: Connector is an interface. Resolved by registered type at runtime.

**MODULAR-006**: RiskTier is a governed open string type. Adding a tier requires no engine
changes.

**MODULAR-007**: Policy rule condition schema is versioned and extensible. Condition field
additions require schema version bump.

**MODULAR-008**: ExecutionGrant template computation is engine law. Gate 04 is the single
authoritative computation point. No connector supplements or overrides it.

**MODULAR-009**: CCV field definitions are blueprint law. CCV schema changes require a
blueprint version bump. No spec or implementation change may silently redefine CCV semantics.

---

## 14. Assertion Boundary

The machine governs, routes, brokers bounded execution authority, and records. It does not
certify.

The system MAY assert: action allowed under policy rule X; action denied with reason; action
required and received human approval; approval denied or timed out; actor not registered;
delegation expired; policy file signature invalid; execution grant minted and redeemed under
governed scope; replay detected.

The system MAY NOT assert: action is safe; agent is trustworthy; system certifies this
action; action complies with regulation X; organization is in compliance.

Prohibited language: "approved by system" / "authorized by engine" / "Nexus certifies" /
"system confirms compliance" / "this action is safe" / "compliant action".

### 14.1 Management API Trust Boundary

The management API is a mutation surface. Its trust boundary is explicit law:

- Binds to 127.0.0.1 only.
- All mutation routes (POST, PUT, DELETE) require Authorization: Bearer <admin-token>.
- Admin token generated at nexus init, stored at keys/admin.token (gitignored).
- Read routes (GET) require the same admin token.
- No exposure beyond localhost is permitted in this version.
- Production upgrade path: replace bearer token with mTLS or local Unix socket.
  This is an architectural swap, not a new insertion.

---

## 15. POC Boundary

### 15.1 POC Must Prove

- seven-gate pipeline executes in fixed order on every action
- gate default-deny posture holds with no rules loaded
- MCP adapter correctly normalizes and forwards agent actions
- delegation context minting, chain capture, signing, and Gate 03 verification work
- policy evaluation produces deterministic outcomes for identical inputs
- Gate 04 computes ExecutionGrantTemplates deterministically, including approval routing config
- approval request signing, mandatory field presence, and response signature verification work
- Gate 06 mints ExecutionGrants under §12 law before connector forwarding
- evidence records are hash-chained, sequence-continuous, and signature-verifiable from a
  clean clone
- all 10 threat test scenarios pass
- deterministic replay produces identical gate decisions AND identical CompilerComparisonView
  records for identical inputs under the same blueprint and runtime contract versions

### 15.2 POC Must Exclude

Dashboard UI, Slack channel (Channel v3), webhook approval channel (Channel v2), REST
adapter (Adapter v2), PostgreSQL ledger backend (Backend v2), multi-node ledger replication,
SOC 2 export formatting, production K8s manifests, connector marketplace, self-service actor
registration portal, Okta/identity connector (deferred; Vault connector is the reference
implementation).

Webhook channel clarification: no webhook approval channel code, stub, or partial
implementation exists in this POC. The ApprovalChannel interface preserves the extension
point. Channel v2 will be specified and built in a later spec version when remote approval
use cases are proven. Treating the interface as permission to scaffold partial webhook code
is a build violation.

MCP session auto-create clarification: the MCP adapter must not auto-create sessions from
caller-supplied headers. Sessions require explicit creation via CLI or management API. Any
code path that creates a session from an adapter header is a trust boundary violation.

### 15.3 Bin Wiring Law

The build is not operational without explicit bin wiring. package.json must define:

```json
"bin": {
  "nexus":          "packages/interfaces/cli/dist/index.js",
  "nexus-mcp-proxy": "packages/adapters/mcp/dist/mcp-server.js"
}
```

Dev execution via tsx is permitted. Dist must be the production path. Both bins must be
buildable and executable from a clean clone.

### 15.5 Build Contract Law

The build is not operational unless a fresh clone can complete: install → format:check →
lint → typecheck → test → ci:gate without inventing missing config files. Every file
referenced by a script must be declared in the repo layout. format:check and lint are
distinct script targets — they are not merged. Declaring them as one combined target is a
build violation. All script-referenced config files (ci-gate.ts, eslint.config.js,
vitest.integration.config.ts, vitest.threat.config.ts) must exist in the declared repo
layout. A build that cannot pass ci:gate from a clean clone is not a conformant build. The CLI nexus run --scenario <id> validates the scenario ID against this
manifest before any fixture loading. No string concatenation may be used to resolve fixture
paths. Manifest keys are the canonical scenario identifiers.

### 15.5 POC Demo Scenario Matrix

All ten must pass. POC is not complete until all ten pass.

1.  Agent reads low-risk record → ALLOWED → grant minted → executed → evidence + CCV recorded
2.  Agent creates medium-risk record → ALLOWED → grant minted → executed → evidence + CCV recorded
3.  Agent sends external message (high-risk) → REQUIRE_APPROVAL → human approves → grant minted → executed → evidence + CCV recorded
4.  Agent sends external message (high-risk) → REQUIRE_APPROVAL → human denies → DENIED → no grant minted → evidence + CCV recorded
5.  Agent sends external message (high-risk) → REQUIRE_APPROVAL → timeout → auto-DENIED → no grant minted → evidence + CCV recorded
6.  Scenario 1 action replayed with original action ID → REPLAY DETECTED → DENIED → threat log + evidence recorded
7.  No policy loaded → any action → DENIED by default-deny → evidence + CCV recorded
8.  Unsigned policy file at load → REJECTED at load → all subsequent actions denied by default
9.  Connector path attempts broad static credential instead of governed ExecutionGrant → DENIED → threat log + evidence recorded
10. Delegated sub-agent attempts action outside parent delegation bounds → DENIED at Gate 03 → no policy evaluation → evidence + CCV recorded

---

## 16. Portability Thesis

The engine, runtime contract, and execution-grant law remain stable while adapters,
connectors, and channels are additive implementations. Changing the protocol adapter requires
zero changes to core engine or runtime contract. Changing the downstream connector requires
zero change to execution-authority law. Changing the approval channel requires zero changes
to the approval orchestrator's core logic.

---

## 17. Drift Prevention Rules

- do not let the adapter protocol become a core engine type
- do not let the approval channel become a core orchestrator type
- do not let the ledger backend become a core ledger type
- do not let the control interface drive gate pipeline design
- do not collapse Layer 1 and Layer 2
- do not let a connector define or modify credential law
- do not let an actor class addition require a core engine rewrite
- do not let any execution path bypass execution-grant law
- do not let a long-lived base secret enter an agent, adapter, or approval payload
- do not let the machine assert certification, compliance, or safety
- do not let timeout produce auto-approval
- do not let Gate 07 be conditional on upstream outcomes
- do not let sub-agent delegation expand beyond parent bounds
- do not let intent logging become unrestricted prompt capture
- do not let Gate 02 compute scope or grant template
- do not let Gate 04 grant template computation be overridden by a connector
- do not let the engineering spec introduce a new closed-union ceiling on any governed open type
- do not let CCV field definitions change without a blueprint version bump
- do not let CCV be computed or stored outside the signed EvidenceRecord body
- do not let canonicalization for signing or hashing be non-recursive
- do not let Gate 03 pass when action target environment differs from delegation environment
- do not let any adapter create a session from caller-supplied headers
- do not let the management API accept mutation routes without a local admin bearer token
- do not let ApprovalConfig carry a list of channels — it carries a single channelId in this version
- do not let session creation accept a caller-supplied principalId — derive from actor registration
- do not let buildGrantTemplate and assertTemplateIntegrity compute fingerprints over different payloads
- do not let undefined values enter canonicalize() or any signature/hash computation path
- do not let NexusSecurityViolation be caught by the generic connector error handler
- do not let ledger sequence gaps pass chain verification

---

## 18. Canonical Next Step

The engineering spec is nexus-engineering-spec-v0-4-6.md. It applies all governance
cleanup items from the owner-approval log (OA-001 through OA-003, BS-101 through BS-103).
Key additions and changes from v0.4.4:

- §1 header: build instructions reference removed (OA-001)
- §2: governing precedence law stack made fully explicit (OA-002)
- §7.1: all script-referenced config files declared in repo layout (BS-103)
- §7.2: format:check added as distinct script target; ci:gate uses tsx scripts/ci-gate.ts (BS-103)
- §13.1: pipeline orchestrator replaced — explicit stateful branch, no generic gate loop (BS-101)
- §20.6: PendingApprovalStore getRequest() method added; shared decideApproval service defined (BS-102)
- §22.3: CLI approval handler calls shared decideApproval service (BS-102)
- §23.2: Management API approval routes call shared decideApproval service (BS-102)
- §32: final spec statement updated per OA-003

Blueprint governs purpose, architecture, and boundaries.
Spec governs implementation law.
No spec section may contradict blueprint law. Blueprint wins all conflicts.
Build instructions govern builder-session behavior only. They are not product law and are
not blueprint or spec fallback.

---

## 19. Final Blueprint Statement

Nexus v0.3.6 is a five-layer, private-runtime, policy-aware action router and authority
governance layer for AI agents. One engine processes all actions through seven fixed gates.
One runtime contract governs gate behavior. One fixed authority model governs delegation,
execution-grant minting, and approval. Protocol adapters are additive pluggable surfaces —
MCP is Adapter v1. Adapters never create sessions, never supply environment, and never
define authority law. Connectors are additive pluggable target-system abstractions — they
redeem authority, they do not define it. Approval channels are additive pluggable human
interfaces — CLI is Channel v1 with a single channelId. Sessions are created exclusively
via CLI or management API — never by adapters. principalId is derived server-side at session
creation — never trusted from caller input. Root delegation environment must equal actor
environment at mint time — enforcement is explicit and throws. Execution authority is
governed by explicit execution-grant law, produced deterministically as a function of
identity, delegation, policy, and approval state. The evidence ledger is append-only,
hash-chained, sequence-continuous, and signed by construction. Human approval is a signed
legal artifact chain. ApprovalRequest expiry equals policy timeoutSeconds — this is an
invariant enforced by test. Approver private keys live at keys/approvers/<approverId>.keypair.json
— loaded by key-manager.ts — never committed to the repo. Intent evidence is mandatory law.
Every action produces a Compiler Comparison View — stored within the signed EvidenceRecord
body as part of the tamper-evident record. SEQUENCE_ANOMALY is governed denial code law —
emitted by the chain verifier on sequence discontinuity — not an ingress concern. NexusSecurityViolation
is caught separately from generic connector errors and maps to denied_threat. The management
API binds to localhost only and requires an admin bearer token on all routes. The machine
classifies, enforces, routes, mints bounded execution authority, and produces tamper-evident
proof of every action. Human operators remain the final decision authority on high-risk
actions. The system governs action, authority, evidence, and comparison — it does not certify.

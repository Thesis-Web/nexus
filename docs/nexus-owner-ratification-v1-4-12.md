# Nexus Stack — Owner Ratification Statement
# Owner: James Huson / Lake Area LLC
# Date: 2026-04-19
# Status: OWNER-APPROVED — LOCKED
# Purpose: Canonical ratification of all v1.4.x blueprint decisions
# This file is a canonical input for all audit passes.

---

## What This Document Is

This is the owner's formal ratification of all architectural decisions made in the
nexus-blueprint-v1-4-12.md blueprint series. It exists because audit processes require
ratification to appear inside the canonical file set. This document satisfies that
requirement.

This document is canonical law alongside:
- nexus-complete-end-to-end-flow-v4.8.md (LOCKED)
- nexus-blueprint-v1-4-12.md (current blueprint)
- nexus-engineering-spec (to be derived from v1.4.12 blueprint)

---

## Ratified Decisions

### RAT-001 — v1.x Version Line

**Decision:** The blueprint version line is v1.x, replacing v0.3.x.

**Rationale:** The scope expanded from a single authority engine (Nexus, v0.3.x) to a
full two-checkpoint governed stack: Nexus Vanguard (NVG) wall enforcement + Nexus (NXS)
authority engine + workspace + orchestration plane + OCT system + operating modes +
three audit streams + compile/return path + identity provider interface. This is the
largest architectural expansion in the project's history and warrants a major version.

**Owner approval:** 2026-04-19.

---

### RAT-002 — Standalone Architecture-Law Sections (§31–§34)

**Decision:** Four standalone architecture-law sections are approved as canonical
blueprint content:
- §31 The Complete Governed Loop
- §32 Target Systems — Scoped Execution
- §33 Operational Constraints — No On-Prem
- §34 Security Model

**Rationale:** The blueprint is designed to be law. Law must be complete. These sections
are derived directly from the v4.8 canonical outline:
- §31 ← v4.8 "The Complete Governed Loop"
- §32 ← v4.8 "Target Systems: Scoped Execution"
- §33 ← v4.8 "No On-Prem: Explicit Constraint Table"
- §34 ← v4.8 "The Security Model"

Content is carry-forward from canon. Standalone section structure provides anti-drift
visibility and prevents downstream spec/build drift.

**Owner approval:** 2026-04-19.

---

### RAT-003 — CLI Layer 7 Import Exception

**Decision:** The CLI package (Layer 7) may import core/ (Layer 1) engine entry points
for command dispatch. This is the sole permitted cross-layer import. It must not expose
engine internals through the CLI public surface.

**Rationale:** The CLI dispatches commands to the core engine. A CLI that cannot import
its engine's entry points cannot function. This is a formalization of a physical
dependency that exists in every version of the working codebase. The exception is narrow,
documented, and explicit.

**Owner approval:** 2026-04-19.

---

### RAT-004 — Sentinel / Applicability Encoding Law in Blueprint

**Decision:** The EvidenceRecord sentinel encoding strategy — governed sentinel strings,
no nulls, every field always present, union-type law for applicability-governed fields —
is approved as blueprint-level architecture law.

**Rationale:** Without this encoding law in the blueprint, the spec writer must invent
behavior for every early-denial, non-approval, and non-grant path. That invention would
be unauditable against blueprint law because no blueprint law would exist. The encoding
strategy is the minimum architecture needed to make the spec deterministically derivable.
It does not define the exact sentinel string value (that is spec scope). It defines the
architecture: one type, one strategy, no nulls, structurally complete records.

**Owner approval:** 2026-04-19.

---

### RAT-005 — Build Order in Blueprint

**Decision:** Layer-sequencing build order (§28) is approved as blueprint-scope content.

**Rationale:** Build order is architecture-level sequencing law (which layer before which),
not build-session process law (how many tokens per turn). If build order is only in build
instructions, the spec may be built in wrong order, causing architectural violations that
are expensive to detect after the fact. Including it in the blueprint prevents spec drift.

**Owner approval:** 2026-04-19.

---

### RAT-006 — Version Designator Pattern

**Decision:** Architecture version designators (JSONL is Backend v1, MCP is Adapter v1,
CLI is Channel v1) are approved as blueprint-level architecture markers.

**Rationale:** This pattern has been in the blueprint since v0.3.6. It names which
implementation fills which interface slot. It does not define implementation detail —
it names the architecture version. The CLOG-006 fix explicitly clarified: "this is an
architecture version designation, like 'MCP is Adapter v1.' Specific schema, format,
and file management details are defined in the engineering spec."

**Owner approval:** 2026-04-19.

---

### RAT-007 — Blueprint Scope for Production Hardening

**Decision:** All hardening in the v1.4.x series that tightens encoding, closes
derivation holes, or removes ambiguity without changing product outcome is approved.

**Rationale:** If the hardening does not change the outcome of the product and brings
the product closer to a production run, it is approved. If hardening changes the product
or moves away from production scope, it must be reverted. All v1.4.x changes have been
verified as hardening-only — no product outcome has changed, no gate behavior has changed,
no architectural shape has changed.

**Owner approval:** 2026-04-19.

---

## Governing Law Hierarchy

1. nexus-complete-end-to-end-flow-v4.8.md (canonical outline — LOCKED)
2. This ratification statement (owner decisions — LOCKED)
3. nexus-blueprint-v1-4-12.md (current blueprint — derived from #1 and #2)
4. nexus-engineering-spec (to be derived from #3)
5. Build instructions (builder-operations law only — not product law)

No document lower in this hierarchy may contradict a document higher in this hierarchy.
Conflicts are resolved upward. This hierarchy supersedes all prior version-line references.

---

## Superseded Documents

- nexus-blueprint-v0-3-6.md — superseded by nexus-blueprint-v1-4-12.md
- All v0.3.x blueprint versions — superseded by the v1.x line
- All prior audit-disposition arguments that relied on owner directives outside
  canonical files — this document now places those directives inside the canonical set

---

*Owner: James Huson / Lake Area LLC*
*Date: 2026-04-19*
*Status: OWNER-APPROVED — LOCKED*
*This document is a canonical input for all audit passes.*

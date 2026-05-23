# STALE HEADER / FOOTER / STATUS CLEANUP — 2026-05-23

**Scope:** docs/blueprints/, docs/engineering-specs/, docs/alignment/
**Driving law:** `docs/alignment/nexus-component-outline-v0-1-0.md §11 Document Hygiene Law` (Owner-Ratified 2026-05-23)
**Source spec:** `NEXUS-FIX-SPEC-POST-CONSOLIDATION-2026-05-23.md §3`
**Session:** runs/fix-spec-2026-05-23/

## Audit method

Per spec §3.2 — four grep passes across the three doc trees:

1. `canonical outline.*v4.8|v4.8.*canonical|precedence.*blueprint.*spec|law hierarchy`
2. `^Status:|^VERSION:|^Canonical:|^Supersedes:|^This document is|^This spec is`
3. `End of.*spec|End of.*blueprint|this document supersedes|final authority`
4. `out.of.scope|OUT OF SCOPE|deferred.*v2|not.*v1|future.*phase` (engineering spec only)

Plus a confirming sweep for `canonical engineering spec|canonical blueprint|This document.*canonical|governing law|final authority|build.*clear`.

## Findings and dispositions

| File | Line(s) | Stale content | Fix applied |
|---|---|---|---|
| `docs/engineering-specs/nexus-engineering-spec-v1-8-26.md` | 5867–5882 (§44 Final Spec Statement) | "This document is the **canonical engineering spec** for the Nexus Stack build. Status: CANONICAL — governing law / build not yet build-cleared." + "Blueprint governs purpose / Spec governs implementation / Blueprint wins all conflicts" — a partial precedence claim that omits the component outline (#3 in the ratified chain) and the locked owner-ratification document (#2). | Replaced with the ratified §Governing Precedence chain inline + a pointer to the outline. Original "canonical / governing law" framing softened; left the substantive description of v1.5.13 architecture untouched. |
| `docs/blueprints/AMEND-blueprint-nexus-compile-1-1-1.md` | 1–8 (header), 12–28 (§0 Precedence) | Header banner "This document is canonical compile-ref implementation law." + §0 listed a 6-entry precedence chain that pre-dates the outline ratification (outline absent, owner-ratification document absent, externals AMEND included as #3). | Header softened to "compile-ref implementation law within that precedence chain." §0 replaced with the ratified chain inline + pointer to outline. Preserved the inheritance statement "this AMEND does not redefine or weaken upstream law." |
| `docs/blueprints/AMEND-blueprint-nexus-infra-externals-v1-0-0.md` | 1–6 (header) | "Governing canon: nexus-blueprint-v1-5-13.md, nexus-engineering-spec-v1-8-26.md, nexus-complete-end-to-end-flow-v4.8.md" — omits the outline and the owner-ratification document, both above this AMEND in the chain. | Replaced with pointer to outline §Governing Precedence + inline summary of the ratified chain + 2026-05-23 retirement note. |
| `docs/blueprints/AMEND-nexus-planner-db-lexicon-v0-2-1.md` | 1871 (footer) | "End of spec v0.2.1. **Build-clear.** Begin Phase D Commit 1." — embeds a build-orchestration directive in an AMEND footer, which decays the moment the build queue advances past Phase D. | Softened to "End of AMEND spec v0.2.1" with a §11-aligned note that build sequencing is owned by the active `runs/` BUILD-QUEUE, not the AMEND footer. |
| `docs/blueprints/AMEND-nexus-admin-arc4-fixups-v0-1-0.md` | 198 (footer) | "*End of spec. Build per §4 sequence.*" — same anti-pattern as above: a footer that promotes the AMEND's §4 sequence to "what to do next" outside the build-queue. | Softened to a §11-aligned note. §4 sequence remains authoritative for re-applying this AMEND from scratch (preserved in the new footer). |

## Findings examined and left as-is (with rationale)

| File | Line(s) | Content | Why left alone |
|---|---|---|---|
| `docs/blueprints/AMEND-blueprint-nexus-infra-externals-v1-0-0.md` | 593 | "Status: additive explicit law under ADD-EXT-002…" | Section-level status label describing what §9 (Output Routing Law) IS — not a stale document-level banner claiming final authority. Legitimate intra-document metadata. |
| `docs/engineering-specs/nexus-engineering-spec-v1-8-26.md` | 64 | "This spec is exhaustive for: …" | Accurate section intro listing which layers are covered by the spec. Not a precedence/authority claim. |
| `docs/blueprints/AMEND-blueprint-v1_5_14-NISP-001-A-r2.md` | 916 | "*End of AMEND-blueprint-v1.5.14-NISP-001-A-r2.md*" | Plain end-of-file marker. No build directive, no authority claim. |
| `docs/engineering-specs/AMEND-spec-v2_9_29-NISP-001-A-r4.md` | 1228 | "*End of AMEND-spec-v2.9.29-NISP-001-A-r4.md*" | Plain end-of-file marker. |
| `docs/engineering-specs/nexus-engineering-spec-v1-8-26.md` | 135–137 | "Historical scope note (2026-05-23): The out-of-scope list below was…" | The original out-of-scope claims were already historicized in the prior canonical-law session. The note correctly frames the body section as superseded; no further patch needed. |
| `docs/blueprints/AMEND-nexus-mailbox-pit-v0-2-1.md` and `…v0-2-0.md` | various uses of "canonical" | "canonical event name", "canonical mailbox", "canonical Nexus identity term", "canonical step list" | All are accurate technical references to authoritative names/IDs within the runtime contracts — not document-level "this document is canonical" banners. |

## Result

5 files patched, 6 findings examined and left as-is with documented rationale. The §11 Document Hygiene Law is now enforced across docs/blueprints/, docs/engineering-specs/, and docs/alignment/.

The §Governing Precedence chain lives in one place (`docs/alignment/nexus-component-outline-v0-1-0.md`). Every AMEND that previously enumerated its own chain now points to the outline; future precedence-stack changes are made there once, not in N AMEND headers.

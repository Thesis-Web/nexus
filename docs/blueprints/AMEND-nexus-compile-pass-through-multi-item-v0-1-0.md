# AMEND — Nexus Compile Pass-Through (Multi-Item)

**Version:** v0.1.0
**Status:** RATIFIED (Hard Law #11 multi-item pass-through + digest/provenance verification on pass-through path)
**Date:** 2026-05-19
**Owner:** James Huson / Lake Area LLC
**Author:** Claude (dangerous-mode spec rework session)
**Base commit:** 3ae197d
**Outline pin:** docs/alignment/nexus-component-outline-v0-1-0.md §3 J Compile/Return, Hard Law #11
**Audit packet:** Turn 3 P0-020, P0-021, Turn 4 P0-031, P0-032

---

## §0 Disposition

Hard Law #11: compile is pass-through when there's nothing to compile. The current `packages/core/src/compile/deterministic-renderer.ts:85-96` only pass-throughs when `templateId === undefined && items.length === 1`; multi-item no-contract runs fall into `defaultTemplateGenerator`, violating the law. Additionally, the pass-through helper skips the digest/provenance verification that the templated path performs (P0-021).

This spec ratifies the canonical multi-item pass-through law and mandates digest/provenance verification on both paths.

**Hard Law #11 (outline §3 J / §1):**
> Compile is pass-through when there's nothing to compile. Single-agent + no output contract = compile does not validate, parse, or transform — it forwards verbatim to return. Multi-agent without output contract = same. Output contract present = compile assembles per template.

**Q-rulings applied:**
- **Q3** BAKED enforcement — pass-through verification lives in baked compile primitives; plug-in assembler may extend but cannot remove.
- **Q5** Compile never silent-fails; pass-through digest mismatch quarantines, not bypass-partial.

**Audit findings closed:** P0-020, P0-021 (Turn 3), P0-031, P0-032 (Turn 4).

---

## §1 Scope

In scope (V1):
- Multi-item pass-through bundle/manifest semantics.
- Digest + provenance re-verification on BOTH templated and pass-through paths (single source of truth before final artifact assembly).
- Per-item failure quarantine (no bypass-partial; no silent skip).
- CI gates per Spec F4.19.

Out of scope:
- Synthesis compile modes (on-prem agent, frontier agent) — separate spec; this is the deterministic-renderer law.
- Custom assembler plug-in shape (V2).

---

## §2 Contract types

### §2.1 `CompileRequest` (decision discriminator)

```ts
interface CompileRequest {
  readonly runId: RunId;
  readonly compileInputMailboxRef: MailboxRef;
  readonly templateId?: WorkflowTemplateId;     // present = assemble; absent = pass-through
  readonly mode: CompileMode;                    // 'deterministic' | 'on_prem_synthesis' | 'frontier_synthesis'
}
```

The decision is `templateId === undefined ? PASS_THROUGH : ASSEMBLE`. Item count is NOT a discriminator. Multi-item with no template = pass-through bundle.

### §2.2 `FinalResponseArtifact` (pass-through shapes)

```ts
type FinalResponseArtifact =
  | { kind: 'pass_through_single'; item: MailboxItemSnapshot; signedAt: RunSequence; signature: Ed25519Signature }
  | { kind: 'pass_through_bundle'; items: readonly MailboxItemSnapshot[]; manifest: PassThroughManifest; signedAt: RunSequence; signature: Ed25519Signature }
  | { kind: 'assembled'; templateId: WorkflowTemplateId; body: AssembledBody; signedAt: RunSequence; signature: Ed25519Signature };

interface MailboxItemSnapshot {
  readonly mailboxItemRef: MailboxItemRef;
  readonly digest: HexDigest;
  readonly provenance: ProvenanceSource;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly bytesRef: BytesRef;                   // opaque resolvable; never inline body in ledger (P1-014)
}

interface PassThroughManifest {
  readonly itemCount: number;
  readonly itemRefs: readonly MailboxItemRef[];
  readonly aggregateDigest: HexDigest;             // SHA-256 of canonical concat of item digests in order
}
```

A "bundle" is the deterministic concatenation contract; no template, no slot matching, no prose parsing.

---

## §3 Runtime behavior

### §3.1 Single source of truth for digest/provenance verification

Both pass-through and assembler paths invoke `verifyMailboxItems(items)` BEFORE any artifact assembly:

```ts
function verifyMailboxItems(items: readonly MailboxItem[]): VerificationResult {
  for (const item of items) {
    if (item.provenance === 'unknown') return { ok: false, reason: 'unknown_provenance', itemRef: item.ref };
    const recomputed = sha256(readBytes(item.bytesRef));
    if (recomputed !== item.digest) return { ok: false, reason: 'digest_mismatch', itemRef: item.ref };
  }
  return { ok: true };
}
```

On any failure: the run does NOT produce a final artifact. Compile emits `compile_quarantined` ledger event with reason + itemRef; workspace receipt explains. No bypass-partial. No silent skip.

### §3.2 Pass-through single (one item, no template)

1. Verify item per §3.1.
2. Construct `{ kind: 'pass_through_single', item: snapshot, signedAt, signature }`.
3. Sign with compile signing key.
4. Hand to return endpoint.

### §3.3 Pass-through bundle (multiple items, no template)

1. Verify all items per §3.1.
2. Compute `aggregateDigest = sha256(canonicalConcat(item.digest for item in items in mailbox-order))`.
3. Construct `{ kind: 'pass_through_bundle', items: snapshots, manifest, signedAt, signature }`.
4. Sign.
5. Hand to return endpoint.

The bundle is deterministic: same items in same order → same artifact bytes → same digest.

**No** default-template generation. **No** prose parsing. **No** slot matching. **No** opacity-rule violations.

### §3.4 Assembled (output contract present)

1. Verify all items per §3.1.
2. Load template; assemble per slot/section/guard.
3. Construct `{ kind: 'assembled', templateId, body, signedAt, signature }`.
4. Sign.
5. Hand to return endpoint.

### §3.5 Three-mode behavior

| Mode      | Gate behavior                                                                                | Run continues? | Ledger writes? |
|-----------|----------------------------------------------------------------------------------------------|----------------|----------------|
| observe   | Verification + assembly; on failure log `would_quarantine_compile`; artifact still returns with caveat | yes        | always         |
| advisory  | Verification + assembly; on failure quarantine + workspace warning; no artifact returned     | no on fail     | always         |
| enforcing | Verification + assembly; on failure quarantine, no artifact, run terminates per Hard Law #11 | no on fail     | always         |

### §3.6 BAKED vs plug-in

- **BAKED (floor):** `verifyMailboxItems` + signing key chain + ledger writes; pass-through bundle construction; assembler invocation pattern.
- **PLUG-IN (defense in depth):** the deterministic-renderer implementation is plug-in; on-prem-synthesis and frontier-synthesis modes are plug-in adapters that still go through the same `verifyMailboxItems` step.

---

## §4 Implementation sequence

1. Add `pass_through_bundle` variant to `FinalResponseArtifact` discriminated union.
2. Add `PassThroughManifest` + helpers.
3. Extract `verifyMailboxItems` into shared module; call from BOTH renderer paths.
4. Update `packages/core/src/compile/deterministic-renderer.ts`:
   - Remove the single-item restriction at lines 85-96.
   - Add `renderPassThroughBundle` helper.
   - Delete the path that falls to `defaultTemplateGenerator` when `templateId === undefined`.
5. Update return endpoint to handle three artifact kinds.
6. Update tests (Spec F4.4 e2e suite covers T-COMPILE-PT-01/-02/-03).
7. CI gates per Spec F4.19.

---

## §5 Tests (acceptance gates)

| Gate | Purpose | Type |
|---|---|---|
| CMP-PT-01 | Single item + no templateId → `pass_through_single` artifact, no parsing, no transformation | Unit |
| CMP-PT-02 | Three items + no templateId → `pass_through_bundle` with `manifest.aggregateDigest` correct over canonical concat | Unit |
| CMP-PT-03 | Same items in same order produce byte-equal artifact (determinism) | Unit |
| CMP-PT-04 | One item digest mismatch (forge bytes after write) → `compile_quarantined` emitted, no artifact | Integration |
| CMP-PT-05 | One item provenance='unknown' → `compile_quarantined` with reason `unknown_provenance` | Integration |
| CMP-PT-06 | templateId present → assembler path; pass-through helpers not invoked | Unit |
| CMP-PT-07 | observe mode: quarantine logs `would_quarantine_compile`; artifact still returns with caveat | Integration |
| CMP-PT-08 | enforcing mode: quarantine → no artifact; run terminates with compile-attributed reason | Integration |
| CMP-PT-09 | Pass-through bundle never invokes defaultTemplateGenerator (static AST scan) | Static |

**CI static gates (Spec F4.19):**
- `GOV-06 compile no-contract pass-through` — verifies `templateId === undefined` reaches pass-through path regardless of item count.
- `GOV-07 compile pass-through digest/provenance` — verifies `verifyMailboxItems` is called before artifact construction on BOTH paths.

---

## §6 Audit closure mapping

| Finding | How closed |
|---|---|
| P0-020 | Multi-item no-contract → `pass_through_bundle` path; deterministic concatenation; no default-template generation; test CMP-PT-02 |
| P0-021 | `verifyMailboxItems` shared; called before any artifact construction; test CMP-PT-04 |
| P0-031 | CI gate GOV-06 in Spec F4.19; test CMP-PT-09 static |
| P0-032 | CI gate GOV-07 in Spec F4.19; test CMP-PT-04 + CMP-PT-05 |

---

*End of v0.1.0.*

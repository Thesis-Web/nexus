/**
 * verifyMailboxItems — F4.12 §3.1 (Hard Law #11 pass-through verification)
 *
 * Single source of truth for per-item digest + provenance verification on
 * the compile pass-through paths (single-item and bundle). Both paths in
 * `deterministic-renderer.ts` call this helper BEFORE constructing any
 * artifact. On any failure the run does NOT produce a final artifact —
 * the caller emits `compile_quarantined` and throws.
 *
 * Three failure modes:
 *   - 'unknown_provenance' — `item.provenance === 'unknown'`. The
 *     writer-side mapping is incomplete; the defensive default in
 *     `runtime-utils/payload-labels.ts` produces 'unknown' when no
 *     writer-side path applies. Per the mailbox contract comment this
 *     value is reserved for quarantine.
 *   - 'resolver_unavailable' — no `PayloadResolver` in the registry
 *     accepted `item.resultRef`. Means the renderer can't read the
 *     bytes; can't compute a digest; must quarantine.
 *   - 'digest_mismatch' — `sha256(resolved bytes) !== item.resultDigest`.
 *     Indicates tamper or storage corruption between write-time and
 *     compile-time. This is the F4.12 §3.1 / §5 CMP-PT-04 case.
 *
 * Verify order: provenance check first (cheapest), then resolver lookup,
 * then digest verify (reads the bytes — most expensive). Short-circuits
 * on the first failure — F4.12 §3.1 says "the run does NOT produce a
 * final artifact" so there's no point continuing.
 *
 * On success the helper returns the resolved bytes alongside each item
 * so the caller (pass-through bundle or single) can reuse them to write
 * the artifact body without a second resolver pass.
 *
 * Layer 1 — imports from @nexus/contracts only.
 *
 * Spec: docs/blueprints/AMEND-nexus-compile-pass-through-multi-item-v0-1-0.md §3.1
 * Hard Law: outline §1 HL #11 + §3 J
 */
import { createHash } from 'node:crypto';
import type { MailboxItem, NonEmpty, PayloadResolver, Sha256Hex, Uuid } from '@nexus/contracts';

export type VerifyFailureReason = 'digest_mismatch' | 'unknown_provenance' | 'resolver_unavailable';

export interface VerifyMailboxItemsFailure {
  readonly ok: false;
  readonly reason: VerifyFailureReason;
  readonly mailboxItemId: Uuid;
  readonly sourceMailboxId: NonEmpty;
  /** Human-readable detail suitable for the compile_quarantined ledger
   *  event + the workspace receipt explanation. Never contains the
   *  payload bytes themselves — only the mismatch metadata. */
  readonly detail: string;
}

export interface ResolvedMailboxItem {
  readonly item: MailboxItem;
  readonly bytes: Uint8Array;
}

export interface VerifyMailboxItemsSuccess {
  readonly ok: true;
  /** Per-item resolved bytes, in the same order as the input. The
   *  pass-through bundle path reuses these for the canonical concat
   *  step (avoids a second resolver pass + a second on-disk read). */
  readonly resolvedItems: ReadonlyArray<ResolvedMailboxItem>;
}

export type VerifyMailboxItemsResult = VerifyMailboxItemsSuccess | VerifyMailboxItemsFailure;

export async function verifyMailboxItems(
  items: ReadonlyArray<MailboxItem>,
  resolvers: ReadonlyArray<PayloadResolver>
): Promise<VerifyMailboxItemsResult> {
  const resolvedItems: ResolvedMailboxItem[] = [];
  for (const item of items) {
    if (item.provenance === 'unknown') {
      return {
        ok: false,
        reason: 'unknown_provenance',
        mailboxItemId: item.mailboxItemId,
        sourceMailboxId: item.mailboxId,
        detail: `mailboxItem ${item.mailboxItemId} carries provenance='unknown' (writer-side mapping incomplete; quarantine per F4.12 §3.1)`,
      };
    }
    let bytes: Uint8Array | null = null;
    for (const resolver of resolvers) {
      if (resolver.canResolve(item.resultRef)) {
        bytes = await resolver.resolveBytes(item.resultRef);
        break;
      }
    }
    if (bytes === null) {
      return {
        ok: false,
        reason: 'resolver_unavailable',
        mailboxItemId: item.mailboxItemId,
        sourceMailboxId: item.mailboxId,
        detail: `no payload resolver accepted resultRef '${item.resultRef}' for mailboxItem ${item.mailboxItemId}`,
      };
    }
    const recomputed = createHash('sha256').update(bytes).digest('hex') as Sha256Hex;
    if (recomputed !== item.resultDigest) {
      return {
        ok: false,
        reason: 'digest_mismatch',
        mailboxItemId: item.mailboxItemId,
        sourceMailboxId: item.mailboxId,
        detail: `sha256 mismatch for mailboxItem ${item.mailboxItemId}: expected ${item.resultDigest}, got ${recomputed}`,
      };
    }
    resolvedItems.push({ item, bytes });
  }
  return { ok: true, resolvedItems };
}

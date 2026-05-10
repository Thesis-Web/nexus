/**
 * secure_agent_handoff slot-read guard — composition-boundary helper.
 *
 * File: scripts/secure-handoff-guard.ts
 *
 * Phase 1 of the multi-node planner secure handoff support. When a
 * `secure_agent_handoff` node tries to read an upstream slot, this
 * guard rejects the read if the downstream agent's OCT clearance is
 * lower than the upstream mailbox item's classification level — i.e.
 * a hard deny on octLevel mismatch.
 *
 * Phase 2 will replace this with real bidirectional redaction at the
 * slot boundary (rewriting bytes flowing INTO a less-cleared agent
 * rather than denying outright). Until then this is the minimum
 * defensible guard: an OCT-OPEN agent cannot peek at OCT-SECURE data
 * just because the planner stitched it into a sub-task DAG.
 *
 * Lives at the composition boundary so the orchestrator can call it
 * before reading the mailbox item's resultRef bytes. Pure and side-
 * effect free — easy to unit test.
 *
 * The rank-based comparison is intentionally simple. The richer
 * dataClassCeiling-vs-resultClassifications check (per
 * OCT_CEILINGS in @nexus/contracts) is the correct long-term answer;
 * pulling that in is Phase 2 work alongside redaction.
 */

/**
 * Numeric rank used for clearance comparison. Higher rank = greater
 * clearance / authority to read. Unknown labels rank 0 (lowest), so
 * a misconfigured agent fails closed against any classified slot.
 */
export const OCT_RANK: Readonly<Record<string, number>> = {
  'OCT-OPEN': 1,
  'OCT-CONFIDENTIAL': 2,
  'OCT-SECURE': 3,
  // OCT-COMPILE is a special compile-time level, not a clearance —
  // it MUST NOT be used as a downstream agent's octLevel for slot
  // reads. Treated as 0 so any classified slot read is denied.
  'OCT-COMPILE': 0,
};

export function octRank(level: string | null | undefined): number {
  if (level === null || level === undefined) return 0;
  return OCT_RANK[level] ?? 0;
}

export interface SlotReadGuardResult {
  readonly allowed: boolean;
  /** Set only when allowed=false. Stable string suitable for the
   *  NodeDispatchResult.failureReason field. */
  readonly denyReason?: string;
}

/**
 * Decide whether a `secure_agent_handoff` node may read an upstream
 * mailbox item. Returns allowed=false when the downstream agent's
 * clearance is strictly lower than the upstream item's octLevel.
 */
export function checkSecureHandoffSlotRead(
  downstreamOctLevel: string | null,
  upstreamItemOctLevel: string,
  fromSubTaskKey: string,
  slotId: string
): SlotReadGuardResult {
  const downstreamRank = octRank(downstreamOctLevel);
  const upstreamRank = octRank(upstreamItemOctLevel);
  if (downstreamRank < upstreamRank) {
    return {
      allowed: false,
      denyReason:
        'secure_handoff_oct_mismatch: downstream OCT level ' +
        `'${downstreamOctLevel ?? '<none>'}' cannot read upstream slot ` +
        `${fromSubTaskKey}.${slotId} (octLevel '${upstreamItemOctLevel}')`,
    };
  }
  return { allowed: true };
}

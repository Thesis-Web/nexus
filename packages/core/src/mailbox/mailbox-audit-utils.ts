/**
 * Mailbox-pit V1 — AUDIT-ONLY mailboxId decoder.
 *
 * File: packages/core/src/mailbox/mailbox-audit-utils.ts
 * Spec: AMEND-nexus-mailbox-pit-v0-2-1 §3.1.1 (Export-path discipline)
 *
 * ============================================================
 *  STRUCTURAL BOUNDARY — read before importing anything here.
 * ============================================================
 *
 * This module exists for OFFLINE AUDIT RECONSTRUCTION ONLY. Given a
 * mailbox file on disk (whose filename or path embeds the mailboxId),
 * audit tooling needs to recover the actorId WITHOUT a live
 * MailboxService. That is the only legitimate use case for the
 * functions exported here.
 *
 * The intent is enforced by the EXPORT PATH, not by this comment:
 *
 *   - NOT re-exported from packages/core/src/mailbox/index.ts
 *   - NOT re-exported from packages/core/src/index.ts
 *   - NOT re-exported from @nexus/contracts barrel
 *
 * Allowed importers (per spec §3.1.1.2):
 *
 *   1. Audit CLI scripts under tools/audit/** (none today; reserved).
 *   2. The unit-test file mailbox-audit-utils.test.ts (this dir).
 *   3. Future approved audit-only modules — added by amendment.
 *
 * Any other importer is a violation of spec §3.1.1.2 and will be
 * caught by the MAILBOX-PIT-EXPORT-BOUNDARY ci:gate check (ADD-
 * MAILBOX-PIT-002).
 *
 * If you are looking at this file because you need provenance on a
 * hot path: STOP. Use one of:
 *   - MailboxService.listMailboxesForRun (returns the actor map)
 *   - MailboxService.resolveMailboxProvenance (returns the typed
 *     MailboxAllocation record)
 *   - The inverted map of listMailboxesForRun for direct lookups
 *
 * Those routes are the supported provenance authority. The function
 * below is structurally inferior on the hot path because it parses
 * a string format that may change between schema versions.
 */
import type { Uuid, NonEmpty } from '@nexus/contracts';
import { MAILBOX_ID_PREFIX_V1, MAILBOX_ID_ACTOR_INFIX } from './mailbox-id-format.js';

/**
 * Recover the actorId from a V1 mailboxId by parsing the canonical
 * format. Returns null on malformed input, unknown prefix, or any
 * other shape mismatch — the caller MUST handle null as "this is not
 * a V1 mailboxId I can decode."
 *
 * Format (per spec §2.1):
 *   mbx-v1-run-<runId>-actor-<actorId>
 *
 * Both runId and actorId are UUIDs (8-4-4-4-12 hex with hyphens). The
 * decoder validates the surrounding prefix/infix but does NOT validate
 * the UUID syntax itself — the caller can do that if it wants.
 *
 * Pure function: no I/O, no state, no side effects.
 */
export function decodeActorIdFromMailboxId(mailboxId: NonEmpty): Uuid | null {
  const raw = mailboxId as string;
  if (!raw.startsWith(MAILBOX_ID_PREFIX_V1)) return null;

  const afterPrefix = raw.slice(MAILBOX_ID_PREFIX_V1.length);
  const infixIdx = afterPrefix.indexOf(MAILBOX_ID_ACTOR_INFIX);
  if (infixIdx < 0) return null;

  // Reject extra occurrences of the infix — only one separator allowed.
  if (afterPrefix.indexOf(MAILBOX_ID_ACTOR_INFIX, infixIdx + MAILBOX_ID_ACTOR_INFIX.length) >= 0) {
    return null;
  }

  const actorPart = afterPrefix.slice(infixIdx + MAILBOX_ID_ACTOR_INFIX.length);
  if (actorPart.length === 0) return null;
  return actorPart as Uuid;
}

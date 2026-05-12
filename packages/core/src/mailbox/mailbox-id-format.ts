/**
 * Mailbox-pit V1 mailboxId format — internal-only module.
 *
 * File: packages/core/src/mailbox/mailbox-id-format.ts
 * Spec: AMEND-nexus-mailbox-pit-v0-2-1 §2.1 + §3.3
 *
 * This module owns the canonical V1 mailboxId encoding:
 *
 *   mbx-v1-run-<runId>-actor-<actorId>
 *
 * The encoder is exported here so MailboxServiceImpl can derive
 * mailboxIds without parsing strings. The format constants are also
 * exported here so mailbox-audit-utils.ts can implement its own
 * inverse (decoder) for offline reconstruction without depending on
 * the encoder's implementation.
 *
 * NOT re-exported from packages/core/src/mailbox/index.ts. Internal
 * to the mailbox subsystem. The export-path discipline rule (spec
 * §3.1.1) applies to the decode function in mailbox-audit-utils;
 * this file is consumed only by the service + the audit-utils.
 */
import type { Uuid, NonEmpty } from '@nexus/contracts';

export const MAILBOX_ID_PREFIX_V1 = 'mbx-v1-run-' as const;
export const MAILBOX_ID_ACTOR_INFIX = '-actor-' as const;

/**
 * Deterministically encode a (runId, actorId) pair to its canonical
 * V1 mailboxId string. The function is pure — same inputs always
 * produce the same output. No state, no I/O.
 */
export function encodeMailboxIdV1(runId: Uuid, actorId: Uuid): NonEmpty {
  return `${MAILBOX_ID_PREFIX_V1}${runId}${MAILBOX_ID_ACTOR_INFIX}${actorId}` as NonEmpty;
}

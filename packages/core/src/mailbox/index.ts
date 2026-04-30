// packages/core/src/mailbox/index.ts
// AMEND-spec §7 — Mailbox barrel
// Layer 1 — baked mailbox infrastructure.

export { MailboxServiceImpl } from './mailbox-service.js';
export { LocalJsonlMailboxBackend } from './local-jsonl-mailbox.backend.js';
export { computeMailboxEligibility, isAllowedTransition } from './mailbox-eligibility.js';
export type { EligibilityResult } from './mailbox-eligibility.js';
export { MailboxError, MailboxTransitionError, MailboxIntegrityError } from './mailbox-errors.js';
export { mailboxMetadataPath, mailboxPayloadDir, mailboxPayloadPath } from './mailbox-paths.js';

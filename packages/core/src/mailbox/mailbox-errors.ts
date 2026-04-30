/**
 * Mailbox Errors — AMEND-spec §7
 *
 * File: packages/core/src/mailbox/mailbox-errors.ts
 * Layer 1 — mailbox-specific error types.
 */

export class MailboxError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'MailboxError';
    this.code = code;
  }
}

export class MailboxTransitionError extends MailboxError {
  public readonly fromStatus: string;
  public readonly toStatus: string;
  constructor(fromStatus: string, toStatus: string, itemId: string) {
    super(
      'mailbox_transition_forbidden',
      `Forbidden mailbox transition: ${fromStatus} -> ${toStatus} (item ${itemId})`
    );
    this.name = 'MailboxTransitionError';
    this.fromStatus = fromStatus;
    this.toStatus = toStatus;
  }
}

export class MailboxIntegrityError extends MailboxError {
  constructor(message: string) {
    super('mailbox_integrity_error', message);
    this.name = 'MailboxIntegrityError';
  }
}

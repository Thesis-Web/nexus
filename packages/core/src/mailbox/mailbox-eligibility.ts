/**
 * Mailbox Eligibility — AMEND-spec §7.3, §7.4
 *
 * File: packages/core/src/mailbox/mailbox-eligibility.ts
 * Layer 1 — imports from @nexus/contracts only.
 *
 * Eligibility is computed by the baked MailboxService before compile read.
 * Status transitions follow §7.4 allowed/forbidden transition table.
 */
import type { MailboxItem, MailboxStatus, MailboxManifestRecord } from '@nexus/contracts';
import { DENIAL_CODE } from '@nexus/contracts';

// ─── Eligibility result ───

export interface EligibilityResult {
  eligible: boolean;
  transitionTo: MailboxStatus | null;
  denialCode: string | null;
}

/**
 * Compute mailbox eligibility for a single item per §7.3.
 *
 * This function does NOT verify digest against payload bytes — that check
 * requires an async payload resolver and is done by OutputCollector at
 * write time. By the time items reach eligibility check for compile read,
 * digest has already been verified at write. The eligibility function here
 * rechecks classification, redaction, status, and expiry.
 */
export function computeMailboxEligibility(
  item: MailboxItem,
  policy: Pick<MailboxManifestRecord, 'classificationRequired' | 'digestRequired'>,
  nowIso: string
): EligibilityResult {
  // Classification check (§7.3)
  if (policy.classificationRequired && item.resultClassifications.length === 0) {
    return {
      eligible: false,
      transitionTo: 'blocked',
      denialCode: DENIAL_CODE.MAILBOX_CLASSIFICATION_MISSING,
    };
  }

  // Redaction check (§7.3)
  if (item.redactionState === 'blocked') {
    return {
      eligible: false,
      transitionTo: 'blocked',
      denialCode: DENIAL_CODE.MAILBOX_REDACTION_BLOCKED,
    };
  }

  // Status check — only 'available' items are eligible (§7.3)
  if (item.mailboxStatus !== 'available') {
    return {
      eligible: false,
      transitionTo: null,
      denialCode: null,
    };
  }

  // Expiry check (§7.3)
  if (item.expiresAt !== null && item.expiresAt <= nowIso) {
    return {
      eligible: false,
      transitionTo: 'expired',
      denialCode: DENIAL_CODE.MAILBOX_ITEM_EXPIRED,
    };
  }

  return { eligible: true, transitionTo: null, denialCode: null };
}

// ─── Status transition validation (§7.4) ───

const ALLOWED_TRANSITIONS: Record<string, Set<string>> = {
  available: new Set(['blocked', 'cancelled', 'expired', 'consumed']),
  blocked: new Set(['blocked']),
  cancelled: new Set(['cancelled']),
  expired: new Set(['expired']),
  consumed: new Set(['consumed']),
};

/**
 * Returns true if the transition from→to is allowed per §7.4.
 * Idempotent self-transitions (blocked→blocked, etc.) are allowed.
 */
export function isAllowedTransition(from: MailboxStatus, to: MailboxStatus): boolean {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (allowed === undefined) return false;
  return allowed.has(to);
}

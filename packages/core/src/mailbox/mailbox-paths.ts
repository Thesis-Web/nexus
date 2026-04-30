/**
 * Mailbox Paths — AMEND-spec §7.1
 *
 * File: packages/core/src/mailbox/mailbox-paths.ts
 * Layer 1 — path resolution for JSONL mailbox backend.
 *
 * Storage layout:
 *   <storageRoot>/
 *     mailbox-items.jsonl
 *     payloads/
 *       <runId>/
 *         <mailboxItemId>.payload
 */
import { join } from 'node:path';

export function mailboxMetadataPath(storageRoot: string): string {
  return join(storageRoot, 'mailbox-items.jsonl');
}

export function mailboxPayloadDir(storageRoot: string, runId: string): string {
  return join(storageRoot, 'payloads', runId);
}

export function mailboxPayloadPath(
  storageRoot: string,
  runId: string,
  mailboxItemId: string
): string {
  return join(storageRoot, 'payloads', runId, `${mailboxItemId}.payload`);
}

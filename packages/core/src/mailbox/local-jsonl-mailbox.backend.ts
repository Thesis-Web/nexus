/**
 * Local JSONL Mailbox Backend — AMEND-spec §7.1
 *
 * File: packages/core/src/mailbox/local-jsonl-mailbox.backend.ts
 * Layer 1 — reference storage backend.
 *
 * Storage layout:
 *   <storageRoot>/mailbox-items.jsonl
 *   <storageRoot>/payloads/<runId>/<mailboxItemId>.payload
 *
 * Law:
 * - JSONL is append-only. Status transitions append a new version record
 *   rather than mutating prior lines.
 * - Payload files must be written before metadata append.
 * - Backend must not call LLMs, NXS, NVG, connectors, approval channels,
 *   or workspace endpoints.
 * - Duplicate mailboxItemId discovered during read is a data integrity error.
 */
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type {
  MailboxBackend,
  MailboxItem,
  MailboxReadQuery,
  MailboxStatus,
  NonEmpty,
  Uuid,
  DenialCode,
} from '@nexus/contracts';
import { nowIso } from '@nexus/contracts';
import { mailboxMetadataPath, mailboxPayloadDir, mailboxPayloadPath } from './mailbox-paths.js';
import { isAllowedTransition } from './mailbox-eligibility.js';
import { MailboxTransitionError, MailboxIntegrityError } from './mailbox-errors.js';

export class LocalJsonlMailboxBackend implements MailboxBackend {
  readonly backendId: NonEmpty;
  readonly backendVersion: NonEmpty;
  private readonly storageRoot: string;

  constructor(storageRoot: string) {
    this.backendId = 'local-jsonl-reference' as NonEmpty;
    this.backendVersion = '1.0.0' as NonEmpty;
    this.storageRoot = storageRoot;
  }

  async write(item: MailboxItem): Promise<void> {
    const metaPath = mailboxMetadataPath(this.storageRoot);
    await fs.mkdir(dirname(metaPath), { recursive: true });
    const line = JSON.stringify(item) + '\n';
    await fs.appendFile(metaPath, line, 'utf-8');
  }

  async getById(mailboxItemId: Uuid): Promise<MailboxItem | null> {
    const items = await this.readAllItems();
    // Last version record wins (append-only versioning)
    const versions = items.filter(i => i.mailboxItemId === mailboxItemId);
    if (versions.length === 0) return null;
    return versions[versions.length - 1]!;
  }

  async listByRun(query: MailboxReadQuery): Promise<MailboxItem[]> {
    const items = await this.readAllItems();

    // Collect latest version per mailboxItemId for this run
    const latest = new Map<string, MailboxItem>();
    for (const item of items) {
      if (item.mailboxId !== query.mailboxId) continue;
      if (item.runId !== query.runId) continue;
      latest.set(item.mailboxItemId, item);
    }

    const results = [...latest.values()];

    if (query.includeIneligible === true) {
      return results;
    }

    // Default: return only compile-eligible items
    return results.filter(i => i.compileEligible);
  }

  async updateStatus(
    mailboxItemId: Uuid,
    next: MailboxStatus,
    reason: DenialCode | null
  ): Promise<MailboxItem> {
    const current = await this.getById(mailboxItemId);
    if (current === null) {
      throw new MailboxIntegrityError(
        `Cannot update status: mailbox item '${mailboxItemId}' not found`
      );
    }

    if (!isAllowedTransition(current.mailboxStatus, next)) {
      throw new MailboxTransitionError(current.mailboxStatus, next, mailboxItemId);
    }

    // Idempotent self-transition — return current without appending
    if (current.mailboxStatus === next) {
      return current;
    }

    const updated: MailboxItem = {
      ...current,
      mailboxStatus: next,
      compileEligible: next === 'available',
      blockedReason: reason,
      consumedAt: next === 'consumed' ? nowIso() : current.consumedAt,
    };

    // Append new version record (append-only §7.1)
    await this.write(updated);
    return updated;
  }

  // ─── Internal helpers ───

  private async readAllItems(): Promise<MailboxItem[]> {
    const metaPath = mailboxMetadataPath(this.storageRoot);
    let raw: string;
    try {
      raw = await fs.readFile(metaPath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }

    const items: MailboxItem[] = [];
    const lines = raw.split('\n').filter(l => l.trim().length > 0);
    for (const line of lines) {
      try {
        items.push(JSON.parse(line) as MailboxItem);
      } catch {
        throw new MailboxIntegrityError(
          `Corrupted JSONL line in mailbox metadata: ${line.slice(0, 80)}`
        );
      }
    }
    return items;
  }

  // ─── Payload helpers (used by OutputCollector for inline payloads) ───

  async writePayload(runId: string, mailboxItemId: string, bytes: Uint8Array): Promise<string> {
    const dir = mailboxPayloadDir(this.storageRoot, runId);
    await fs.mkdir(dir, { recursive: true });
    const path = mailboxPayloadPath(this.storageRoot, runId, mailboxItemId);
    await fs.writeFile(path, bytes);
    return `mailbox://${runId}/${mailboxItemId}`;
  }

  async readPayload(runId: string, mailboxItemId: string): Promise<Uint8Array> {
    const path = mailboxPayloadPath(this.storageRoot, runId, mailboxItemId);
    const buf = await fs.readFile(path);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
}

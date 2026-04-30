/**
 * Mailbox Manifest Loader — AMEND-spec §4.4
 *
 * File: packages/core/src/manifest/mailbox/mailbox-manifest-loader.ts
 * Layer 1 — imports from @nexus/contracts, @nexus/runtime-utils only.
 *
 * Loader invariants (§4.4):
 *   - Exactly one enabled required:true mailbox in V1 governed runtime mode.
 *   - mailboxType must resolve in MailboxBackendFactoryRegistry.
 *   - Duplicate mailboxId fails closed.
 *   - storageRoot must not escape configured runtime root.
 *   - classificationRequired must be true for governed runtime mode.
 *   - digestRequired must be true for governed runtime mode.
 */
import type {
  MailboxBackendFactoryRegistry,
  MailboxManifestRecord,
  NonEmpty,
} from '@nexus/contracts';
import { loadSignedManifest } from '@nexus/runtime-utils';
import { MailboxManifestBodySchema } from './mailbox-manifest-schema.js';
import { resolve, normalize } from 'node:path';

export interface LoadMailboxManifestOptions {
  manifestPath: string;
  controlPlanePublicKey: string;
  factoryRegistry: MailboxBackendFactoryRegistry;
  /** Runtime root for storageRoot path validation */
  runtimeRoot?: string;
}

export async function loadMailboxManifest(
  opts: LoadMailboxManifestOptions
): Promise<MailboxManifestRecord[]> {
  const result = await loadSignedManifest(
    opts.manifestPath,
    MailboxManifestBodySchema,
    opts.controlPlanePublicKey
  );
  const body = result.body;

  const seenIds = new Set<string>();
  const records: MailboxManifestRecord[] = [];
  let requiredEnabledCount = 0;

  for (const entry of body.mailboxes) {
    // Duplicate mailboxId fails closed
    if (seenIds.has(entry.mailboxId)) {
      throw new Error(`mailbox manifest: duplicate mailboxId '${entry.mailboxId}'`);
    }
    seenIds.add(entry.mailboxId);

    if (!entry.enabled) {
      console.info(`[mailbox-manifest] disabled mailbox: ${entry.mailboxId} (skipped)`);
      continue;
    }

    // storageRoot path escape check (§4.4)
    const runtimeRoot = opts.runtimeRoot ?? process.cwd();
    const resolvedStorage = resolve(runtimeRoot, entry.storageRoot);
    const normalizedStorage = normalize(resolvedStorage);
    const normalizedRoot = normalize(runtimeRoot);
    if (!normalizedStorage.startsWith(normalizedRoot)) {
      throw new Error(
        `mailbox manifest: storageRoot '${entry.storageRoot}' escapes runtime root` +
          ` (mailbox '${entry.mailboxId}')`
      );
    }

    // classificationRequired must be true for governed runtime mode (§4.4)
    if (!entry.classificationRequired) {
      throw new Error(
        `mailbox manifest: classificationRequired must be true in governed runtime mode` +
          ` (mailbox '${entry.mailboxId}')`
      );
    }

    // digestRequired must be true for governed runtime mode (§4.4)
    if (!entry.digestRequired) {
      throw new Error(
        `mailbox manifest: digestRequired must be true in governed runtime mode` +
          ` (mailbox '${entry.mailboxId}')`
      );
    }

    // mailboxType registered in factory registry
    const factory = opts.factoryRegistry.get(entry.mailboxType);
    if (factory === null) {
      throw new Error(
        `mailbox manifest: mailboxType '${entry.mailboxType}' not registered` +
          ` (mailbox '${entry.mailboxId}')`
      );
    }

    if (entry.required) {
      requiredEnabledCount++;
    }

    records.push({
      mailboxId: entry.mailboxId as NonEmpty,
      mailboxType: entry.mailboxType as NonEmpty,
      enabled: entry.enabled,
      required: entry.required,
      storageRoot: entry.storageRoot as NonEmpty,
      retentionPolicy: {
        payloadTtlSeconds: entry.retentionPolicy.payloadTtlSeconds,
        metadataRetention: entry.retentionPolicy.metadataRetention,
      },
      classificationRequired: entry.classificationRequired,
      digestRequired: entry.digestRequired,
      configuration: entry.configuration,
    });
  }

  // Exactly one enabled required:true mailbox in V1 (§4.4)
  if (requiredEnabledCount !== 1) {
    throw new Error(
      `mailbox manifest: exactly 1 enabled required mailbox is required in V1 governed runtime mode,` +
        ` found ${requiredEnabledCount}.`
    );
  }

  return records;
}

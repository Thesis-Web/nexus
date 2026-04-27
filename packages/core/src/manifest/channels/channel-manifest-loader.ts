/**
 * Approval Channel Manifest Loader — spec §32a.2.3
 *
 * File: packages/core/src/manifest/channels/channel-manifest-loader.ts
 * Layer 1 — imports from @nexus/contracts, @nexus/runtime-utils only.
 *
 * Loads, verifies, and validates the signed approval-channel manifest at startup.
 * Returns an array of enabled channel entries for factory instantiation.
 *
 * Steps:
 *   1-3. File read + YAML parse + Ed25519 signature verify (via loadSignedManifest)
 *   4.   Schema validation (ApprovalChannelManifestBodySchema)
 *   5.   Per-entry validation:
 *        - channelId uniqueness within manifest
 *        - channelType registered in ApprovalChannelFactoryRegistry (§12.3.48)
 *   6.   At-least-one-enabled invariant (§14.6.6 fail closed)
 *
 * Fail-closed: any validation failure throws; dependent subsystem does not start.
 *
 * Import-law (NISP-001.A-BS-001 owner ruling):
 *   MUST NOT import from packages/connectors, packages/identity-ref,
 *   packages/vanguard, packages/interfaces.
 */
import type { ApprovalChannelFactoryRegistry, NonEmpty } from '@nexus/contracts';
import { loadSignedManifest } from '@nexus/runtime-utils';
import { ApprovalChannelManifestBodySchema } from './channel-manifest-schema.js';

export interface ChannelManifestRecord {
  readonly channelId: NonEmpty;
  readonly channelType: NonEmpty;
  readonly configuration: Record<string, unknown>;
}

export interface LoadChannelManifestOptions {
  /** Path to the signed approval-channel manifest YAML (§14.6.2) */
  manifestPath: string;
  /** Control-plane public key for signature verification (base64url Ed25519) */
  controlPlanePublicKey: string;
  /** Factory registry — must be populated before calling this (§12.3.48 invariant 3) */
  factoryRegistry: ApprovalChannelFactoryRegistry;
}

export async function loadChannelManifest(
  opts: LoadChannelManifestOptions
): Promise<ChannelManifestRecord[]> {
  // Steps 1-4: file read, YAML parse, signature verify, schema validate
  const result = await loadSignedManifest(
    opts.manifestPath,
    ApprovalChannelManifestBodySchema,
    opts.controlPlanePublicKey
  );
  const body = result.body;

  const seenIds = new Set<string>();
  const records: ChannelManifestRecord[] = [];

  for (const entry of body.channels) {
    // channelId uniqueness within manifest (§14.6.4) — checked for ALL entries
    // including disabled, so manifest never contains ambiguous duplicate IDs
    if (seenIds.has(entry.channelId)) {
      throw new Error(`channel manifest: duplicate channelId '${entry.channelId}'`);
    }
    seenIds.add(entry.channelId);

    // Disabled entries: skip remaining validation, emit notice
    if (!entry.enabled) {
      // eslint-disable-next-line no-console
      console.info(`[channel-manifest] disabled channel: ${entry.channelId} (skipped)`);
      continue;
    }

    // channelType registered in factory registry (§12.3.48 invariant 2)
    const factory = opts.factoryRegistry.get(entry.channelType);
    if (factory === null) {
      throw new Error(
        `channel manifest: channelType '${entry.channelType}' not registered` +
          ` (channel '${entry.channelId}')`
      );
    }

    records.push({
      channelId: entry.channelId as NonEmpty,
      channelType: entry.channelType as NonEmpty,
      configuration: entry.configuration,
    });
  }

  // At-least-one-enabled invariant (§14.6.6)
  if (records.length === 0) {
    throw new Error(
      'channel manifest: zero enabled channels — subsystem fails closed.' +
        ' Enable at least one approval channel (CLI is the starter default).'
    );
  }

  return records;
}

/**
 * Identity Provider Manifest Loader — spec §32a.2.1
 *
 * File: packages/core/src/manifest/identity/identity-manifest-loader.ts
 * Layer 1 — imports from @nexus/contracts, @nexus/runtime-utils only.
 *
 * Loads, verifies, and validates the signed identity-provider manifest at startup.
 * Returns an array of enabled provider entries for factory instantiation.
 *
 * Steps:
 *   1-3. File read + YAML parse + Ed25519 signature verify (via loadSignedManifest)
 *   4.   Schema validation (IdentityProviderManifestBodySchema)
 *   5.   Per-entry validation:
 *        - providerId uniqueness within manifest
 *        - providerType registered in IdentityProviderFactoryRegistry (§12.3.48)
 *   6.   At-least-one-enabled invariant (§14.6.6 fail closed)
 *
 * Fail-closed: any validation failure throws; dependent subsystem does not start.
 *
 * Import-law (NISP-001.A-BS-001 owner ruling):
 *   MUST NOT import from packages/identity-ref, packages/connectors,
 *   packages/vanguard, packages/interfaces.
 */
import type { IdentityProviderFactoryRegistry, NonEmpty } from '@nexus/contracts';
import { loadSignedManifest } from '@nexus/runtime-utils';
import { IdentityProviderManifestBodySchema } from './identity-manifest-schema.js';

export interface IdentityProviderManifestRecord {
  readonly providerId: NonEmpty;
  readonly providerType: NonEmpty;
  readonly configuration: Record<string, unknown>;
}

export interface LoadIdentityManifestOptions {
  /** Path to the signed identity-provider manifest YAML (§14.6.2) */
  manifestPath: string;
  /** Control-plane public key for signature verification (base64url Ed25519) */
  controlPlanePublicKey: string;
  /** Factory registry — must be populated before calling this (§12.3.48 invariant 3) */
  factoryRegistry: IdentityProviderFactoryRegistry;
}

export async function loadIdentityManifest(
  opts: LoadIdentityManifestOptions
): Promise<IdentityProviderManifestRecord[]> {
  // Steps 1-4: file read, YAML parse, signature verify, schema validate
  const result = await loadSignedManifest(
    opts.manifestPath,
    IdentityProviderManifestBodySchema,
    opts.controlPlanePublicKey
  );
  const body = result.body;

  const seenIds = new Set<string>();
  const records: IdentityProviderManifestRecord[] = [];

  for (const entry of body.providers) {
    // providerId uniqueness within manifest (§14.6.4) — checked for ALL entries
    // including disabled, so manifest never contains ambiguous duplicate IDs
    if (seenIds.has(entry.providerId)) {
      throw new Error(`identity manifest: duplicate providerId '${entry.providerId}'`);
    }
    seenIds.add(entry.providerId);

    // Disabled entries: skip remaining validation, emit notice
    if (!entry.enabled) {
      // eslint-disable-next-line no-console
      console.info(`[identity-manifest] disabled provider: ${entry.providerId} (skipped)`);
      continue;
    }

    // providerType registered in factory registry (§12.3.48 invariant 2)
    const factory = opts.factoryRegistry.get(entry.providerType);
    if (factory === null) {
      throw new Error(
        `identity manifest: providerType '${entry.providerType}' not registered` +
          ` (provider '${entry.providerId}')`
      );
    }

    records.push({
      providerId: entry.providerId as NonEmpty,
      providerType: entry.providerType as NonEmpty,
      configuration: entry.configuration,
    });
  }

  // At-least-one-enabled invariant (§14.6.6)
  if (records.length === 0) {
    throw new Error(
      'identity manifest: zero enabled providers — subsystem fails closed.' +
        ' Enable at least one identity provider (RIA is the starter default).'
    );
  }

  return records;
}

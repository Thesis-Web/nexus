/**
 * Connector Manifest Loader — spec §32a.2.2
 *
 * File: packages/core/src/manifest/connectors/connector-manifest-loader.ts
 * Layer 1 — imports from @nexus/contracts, @nexus/runtime-utils only.
 *
 * Loads, verifies, and validates the signed connector manifest at startup.
 * Returns an array of enabled connector entries for factory instantiation.
 *
 * Steps:
 *   1-3. File read + YAML parse + Ed25519 signature verify (via loadSignedManifest)
 *   4.   Schema validation (ConnectorManifestBodySchema)
 *   5.   Per-entry validation:
 *        - connectorId uniqueness within manifest
 *        - connectorType registered in ConnectorFactoryRegistry (§12.3.48)
 *   6.   At-least-one-enabled invariant (§14.6.6 fail closed)
 *
 * Fail-closed: any validation failure throws; dependent subsystem does not start.
 *
 * Import-law (NISP-001.A-BS-001 owner ruling):
 *   MUST NOT import from packages/connectors/stub, packages/connectors/vault,
 *   packages/identity-ref, packages/vanguard, packages/interfaces.
 */
import type { ConnectorFactoryRegistry, DataClass, NonEmpty } from '@nexus/contracts';
import { loadSignedManifest } from '@nexus/runtime-utils';
import { ConnectorManifestBodySchema } from './connector-manifest-schema.js';

export interface ConnectorManifestRecord {
  readonly connectorId: NonEmpty;
  readonly connectorType: NonEmpty;
  readonly allowedSystems: string[];
  readonly dataClass: DataClass;
  readonly configuration: Record<string, unknown>;
}

export interface LoadConnectorManifestOptions {
  /** Path to the signed connector manifest YAML (§14.6.2) */
  manifestPath: string;
  /** Control-plane public key for signature verification (base64url Ed25519) */
  controlPlanePublicKey: string;
  /** Factory registry — must be populated before calling this (§12.3.48 invariant 3) */
  factoryRegistry: ConnectorFactoryRegistry;
}

export async function loadConnectorManifest(
  opts: LoadConnectorManifestOptions
): Promise<ConnectorManifestRecord[]> {
  // Steps 1-4: file read, YAML parse, signature verify, schema validate
  const result = await loadSignedManifest(
    opts.manifestPath,
    ConnectorManifestBodySchema,
    opts.controlPlanePublicKey
  );
  const body = result.body;

  const seenIds = new Set<string>();
  const records: ConnectorManifestRecord[] = [];

  for (const entry of body.connectors) {
    // connectorId uniqueness within manifest (§14.6.4) — checked for ALL entries
    // including disabled, so manifest never contains ambiguous duplicate IDs
    if (seenIds.has(entry.connectorId)) {
      throw new Error(`connector manifest: duplicate connectorId '${entry.connectorId}'`);
    }
    seenIds.add(entry.connectorId);

    // Disabled entries: skip remaining validation, emit notice
    if (!entry.enabled) {
      // eslint-disable-next-line no-console
      console.info(`[connector-manifest] disabled connector: ${entry.connectorId} (skipped)`);
      continue;
    }

    // connectorType registered in factory registry (§12.3.48 invariant 2)
    const factory = opts.factoryRegistry.get(entry.connectorType);
    if (factory === null) {
      throw new Error(
        `connector manifest: connectorType '${entry.connectorType}' not registered` +
          ` (connector '${entry.connectorId}')`
      );
    }

    records.push({
      connectorId: entry.connectorId as NonEmpty,
      connectorType: entry.connectorType as NonEmpty,
      allowedSystems: entry.allowedSystems,
      dataClass: entry.dataClass,
      configuration: entry.configuration,
    });
  }

  // At-least-one-enabled invariant (§14.6.6)
  if (records.length === 0) {
    throw new Error(
      'connector manifest: zero enabled connectors — subsystem fails closed.' +
        ' Enable at least one connector or remove NXS Gate 06 from the deployment.'
    );
  }

  return records;
}

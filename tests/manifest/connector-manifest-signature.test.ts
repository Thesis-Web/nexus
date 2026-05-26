/**
 * Connector Manifest Signature + Loader Tests — spec §38.11
 *
 * Parallel coverage to endpoint-manifest-signature.test.ts.
 * Exercises the full loadConnectorManifest chain:
 *   signed YAML → loadSignedManifest → schema → factory registry → uniqueness → fail-closed
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { loadControlPlaneKey } from '../../packages/core/src/crypto/key-manager.js';
import { signManifest } from '../../packages/runtime-utils/src/manifest/sign-manifest.js';
import { loadConnectorManifest } from '../../packages/core/src/manifest/connectors/connector-manifest-loader.js';
import { ConnectorFactoryRegistry } from '../../packages/core/src/manifest/connectors/connector-factory-registry.js';
import type { ConnectorFactory } from '@nexus/contracts';

let privateKey: string;
let publicKey: string;
let tempDir: string;
const tempFiles: string[] = [];

function stubFactory(connectorType: string): ConnectorFactory {
  return {
    connectorType: connectorType as import('@nexus/contracts').NonEmpty,
    create: async () => ({
      systemType: connectorType as import('@nexus/contracts').NonEmpty,
      connectorVersion: '1.0.0' as import('@nexus/contracts').NonEmpty,
      supportedCapabilities: () => ['*'],
      canProduceDiff: () => false,
      execute: async () => ({
        grantId: '00000000-0000-0000-0000-000000000000' as import('@nexus/contracts').Uuid,
        executedAt: new Date().toISOString() as import('@nexus/contracts').IsoTimestamp,
        status: 'success' as const,
        responseCode: null,
        durationMs: 0,
        redactedSummary: null,
        errorType: null,
        errorMessage: null,
      }),
      redeemGrant: async () => {},
    }),
  };
}

function registryWith(...types: string[]): ConnectorFactoryRegistry {
  const reg = new ConnectorFactoryRegistry();
  for (const t of types) reg.register(stubFactory(t));
  return reg;
}

async function writeSignedManifest(
  body: Record<string, unknown>,
  filename: string
): Promise<string> {
  const envelope = await signManifest({
    body,
    privateKey,
    issuer: 'nexus-test',
    manifestVersion: '1.0',
  });
  const path = join(tempDir, filename);
  await fs.writeFile(path, yaml.dump(envelope), 'utf-8');
  tempFiles.push(path);
  return path;
}

beforeAll(async () => {
  const key = await loadControlPlaneKey();
  privateKey = key.privateKey;
  publicKey = key.publicKey;
  tempDir = await fs.mkdtemp(join(tmpdir(), 'nexus-conn-manifest-'));
});

afterEach(async () => {
  for (const f of tempFiles.splice(0)) {
    await fs.unlink(f).catch(() => {});
  }
});

describe('Connector Manifest Loader', () => {
  it('loads valid manifest with one enabled connector', async () => {
    const path = await writeSignedManifest(
      {
        connectors: [
          {
            connectorId: 'stub',
            connectorType: 'stub',
            allowedSystems: ['*'],
            dataClass: 'public',
            configuration: {},
            enabled: true,
          },
        ],
      },
      'valid.yaml'
    );
    const records = await loadConnectorManifest({
      manifestPath: path,
      controlPlanePublicKey: publicKey,
      factoryRegistry: registryWith('stub'),
    });
    expect(records).toHaveLength(1);
    expect(records[0].connectorId).toBe('stub');
    expect(records[0].connectorType).toBe('stub');
    expect(records[0].allowedSystems).toEqual(['*']);
  });

  it('skips disabled entries', async () => {
    const path = await writeSignedManifest(
      {
        connectors: [
          {
            connectorId: 'stub',
            connectorType: 'stub',
            allowedSystems: ['*'],
            dataClass: 'public',
            configuration: {},
            enabled: true,
          },
          {
            connectorId: 'vault',
            connectorType: 'vault',
            allowedSystems: ['*'],
            dataClass: 'public',
            configuration: {},
            enabled: false,
          },
        ],
      },
      'disabled.yaml'
    );
    const records = await loadConnectorManifest({
      manifestPath: path,
      controlPlanePublicKey: publicKey,
      factoryRegistry: registryWith('stub', 'vault'),
    });
    expect(records).toHaveLength(1);
    expect(records[0].connectorId).toBe('stub');
  });

  it('rejects invalid signature', async () => {
    const envelope = await signManifest({
      body: {
        connectors: [
          {
            connectorId: 'stub',
            connectorType: 'stub',
            allowedSystems: ['*'],
            dataClass: 'public',
            configuration: {},
            enabled: true,
          },
        ],
      },
      privateKey,
      issuer: 'nexus-test',
      manifestVersion: '1.0',
    });
    const corrupted = { ...envelope, signature: 'AAAA' + envelope.signature.slice(4) };
    const path = join(tempDir, 'badsig.yaml');
    await fs.writeFile(path, yaml.dump(corrupted), 'utf-8');
    tempFiles.push(path);

    await expect(
      loadConnectorManifest({
        manifestPath: path,
        controlPlanePublicKey: publicKey,
        factoryRegistry: registryWith('stub'),
      })
    ).rejects.toThrow('signature verification failed');
  });

  it('rejects duplicate connectorId', async () => {
    const path = await writeSignedManifest(
      {
        connectors: [
          {
            connectorId: 'stub',
            connectorType: 'stub',
            allowedSystems: ['*'],
            dataClass: 'public',
            configuration: {},
            enabled: true,
          },
          {
            connectorId: 'stub',
            connectorType: 'stub',
            allowedSystems: ['*'],
            dataClass: 'public',
            configuration: {},
            enabled: true,
          },
        ],
      },
      'dup.yaml'
    );
    await expect(
      loadConnectorManifest({
        manifestPath: path,
        controlPlanePublicKey: publicKey,
        factoryRegistry: registryWith('stub'),
      })
    ).rejects.toThrow("duplicate connectorId 'stub'");
  });

  it('rejects unknown connectorType not in factory registry', async () => {
    const path = await writeSignedManifest(
      {
        connectors: [
          {
            connectorId: 'mystery',
            connectorType: 'nonexistent',
            allowedSystems: ['*'],
            dataClass: 'public',
            configuration: {},
            enabled: true,
          },
        ],
      },
      'unknown.yaml'
    );
    await expect(
      loadConnectorManifest({
        manifestPath: path,
        controlPlanePublicKey: publicKey,
        factoryRegistry: registryWith('stub'),
      })
    ).rejects.toThrow("connectorType 'nonexistent' not registered");
  });

  it('fails closed on zero enabled connectors (§14.6.6)', async () => {
    const path = await writeSignedManifest(
      {
        connectors: [
          {
            connectorId: 'stub',
            connectorType: 'stub',
            allowedSystems: ['*'],
            dataClass: 'public',
            configuration: {},
            enabled: false,
          },
        ],
      },
      'all-disabled.yaml'
    );
    await expect(
      loadConnectorManifest({
        manifestPath: path,
        controlPlanePublicKey: publicKey,
        factoryRegistry: registryWith('stub'),
      })
    ).rejects.toThrow('zero enabled connectors');
  });

  it('loads real config/connectors/connectors.v1.yaml from repo', async () => {
    // Default-shipped connectors: stub + vault + postgres-sales-finance +
    // postgres-warehouse + mailpit-local. The fixture registers all four
    // connector types so the manifest loads cleanly; stub +
    // postgres-sales-finance + postgres-warehouse + mailpit-local are
    // enabled by default per the demo bootstrap.
    const records = await loadConnectorManifest({
      manifestPath: 'config/connectors/connectors.v1.yaml',
      controlPlanePublicKey: publicKey,
      factoryRegistry: registryWith('stub', 'vault', 'postgres', 'mailpit'),
    });
    const ids = records.map(r => r.connectorId).sort();
    expect(ids).toContain('stub');
    expect(ids).toContain('postgres-sales-finance');
    expect(ids).toContain('postgres-warehouse');
    expect(ids).toContain('mailpit-local');
  });
});

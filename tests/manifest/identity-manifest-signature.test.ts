/**
 * Identity Manifest Signature + Loader Tests — spec §38.11
 *
 * Parallel coverage to endpoint-manifest-signature.test.ts.
 * Exercises the full loadIdentityManifest chain:
 *   signed YAML → loadSignedManifest → schema → factory registry → uniqueness → fail-closed
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { loadControlPlaneKey } from '../../packages/core/src/crypto/key-manager.js';
import { signManifest } from '../../packages/runtime-utils/src/manifest/sign-manifest.js';
import { loadIdentityManifest } from '../../packages/core/src/manifest/identity/identity-manifest-loader.js';
import { IdentityProviderFactoryRegistry } from '../../packages/core/src/manifest/identity/identity-provider-factory-registry.js';
import type { IdentityProviderFactory } from '@nexus/contracts';

let privateKey: string;
let publicKey: string;
let tempDir: string;
const tempFiles: string[] = [];

/** Minimal stub factory satisfying IdentityProviderFactory */
function stubFactory(providerType: string): IdentityProviderFactory {
  return {
    providerType: providerType as import('@nexus/contracts').NonEmpty,
    create: async () => ({
      providerType: 'reference_adapter' as const,
      providerVersion: '1.0.0' as import('@nexus/contracts').NonEmpty,
      resolveIdentity: async () => null,
      authenticate: async () => 'stub' as import('@nexus/contracts').NonEmpty,
    }),
  };
}

function registryWith(...types: string[]): IdentityProviderFactoryRegistry {
  const reg = new IdentityProviderFactoryRegistry();
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
  tempDir = await fs.mkdtemp(join(tmpdir(), 'nexus-id-manifest-'));
});

afterEach(async () => {
  for (const f of tempFiles.splice(0)) {
    await fs.unlink(f).catch(() => {});
  }
});

describe('Identity Manifest Loader', () => {
  it('loads valid manifest with one enabled provider', async () => {
    const path = await writeSignedManifest(
      {
        providers: [
          {
            providerId: 'ria',
            providerType: 'reference_adapter',
            configuration: {},
            enabled: true,
          },
        ],
      },
      'valid.yaml'
    );
    const records = await loadIdentityManifest({
      manifestPath: path,
      controlPlanePublicKey: publicKey,
      factoryRegistry: registryWith('reference_adapter'),
    });
    expect(records).toHaveLength(1);
    expect(records[0].providerId).toBe('ria');
    expect(records[0].providerType).toBe('reference_adapter');
  });

  it('skips disabled entries', async () => {
    const path = await writeSignedManifest(
      {
        providers: [
          {
            providerId: 'ria',
            providerType: 'reference_adapter',
            configuration: {},
            enabled: true,
          },
          {
            providerId: 'enterprise-iam',
            providerType: 'enterprise_iam',
            configuration: {},
            enabled: false,
          },
        ],
      },
      'disabled.yaml'
    );
    const records = await loadIdentityManifest({
      manifestPath: path,
      controlPlanePublicKey: publicKey,
      factoryRegistry: registryWith('reference_adapter', 'enterprise_iam'),
    });
    expect(records).toHaveLength(1);
    expect(records[0].providerId).toBe('ria');
  });

  it('rejects invalid signature', async () => {
    const envelope = await signManifest({
      body: {
        providers: [
          {
            providerId: 'ria',
            providerType: 'reference_adapter',
            configuration: {},
            enabled: true,
          },
        ],
      },
      privateKey,
      issuer: 'nexus-test',
      manifestVersion: '1.0',
    });
    // Corrupt signature
    const corrupted = { ...envelope, signature: 'AAAA' + envelope.signature.slice(4) };
    const path = join(tempDir, 'badsig.yaml');
    await fs.writeFile(path, yaml.dump(corrupted), 'utf-8');
    tempFiles.push(path);

    await expect(
      loadIdentityManifest({
        manifestPath: path,
        controlPlanePublicKey: publicKey,
        factoryRegistry: registryWith('reference_adapter'),
      })
    ).rejects.toThrow('signature verification failed');
  });

  it('rejects duplicate providerId', async () => {
    const path = await writeSignedManifest(
      {
        providers: [
          {
            providerId: 'ria',
            providerType: 'reference_adapter',
            configuration: {},
            enabled: true,
          },
          {
            providerId: 'ria',
            providerType: 'reference_adapter',
            configuration: {},
            enabled: true,
          },
        ],
      },
      'dup.yaml'
    );
    await expect(
      loadIdentityManifest({
        manifestPath: path,
        controlPlanePublicKey: publicKey,
        factoryRegistry: registryWith('reference_adapter'),
      })
    ).rejects.toThrow("duplicate providerId 'ria'");
  });

  it('rejects unknown providerType not in factory registry', async () => {
    const path = await writeSignedManifest(
      {
        providers: [
          {
            providerId: 'unknown-provider',
            providerType: 'nonexistent_type',
            configuration: {},
            enabled: true,
          },
        ],
      },
      'unknown-type.yaml'
    );
    await expect(
      loadIdentityManifest({
        manifestPath: path,
        controlPlanePublicKey: publicKey,
        factoryRegistry: registryWith('reference_adapter'),
      })
    ).rejects.toThrow("providerType 'nonexistent_type' not registered");
  });

  it('fails closed on zero enabled providers (§14.6.6)', async () => {
    const path = await writeSignedManifest(
      {
        providers: [
          {
            providerId: 'ria',
            providerType: 'reference_adapter',
            configuration: {},
            enabled: false,
          },
        ],
      },
      'all-disabled.yaml'
    );
    await expect(
      loadIdentityManifest({
        manifestPath: path,
        controlPlanePublicKey: publicKey,
        factoryRegistry: registryWith('reference_adapter'),
      })
    ).rejects.toThrow('zero enabled providers');
  });

  it('rejects schema-invalid body (missing required field)', async () => {
    const path = await writeSignedManifest(
      {
        providers: [
          {
            providerId: 'ria',
            // missing providerType
            configuration: {},
            enabled: true,
          },
        ],
      },
      'bad-schema.yaml'
    );
    await expect(
      loadIdentityManifest({
        manifestPath: path,
        controlPlanePublicKey: publicKey,
        factoryRegistry: registryWith('reference_adapter'),
      })
    ).rejects.toThrow('schema validation failed');
  });

  it('rejects schema-invalid body (unknown top-level field via .strict())', async () => {
    const path = await writeSignedManifest(
      {
        providers: [
          {
            providerId: 'ria',
            providerType: 'reference_adapter',
            configuration: {},
            enabled: true,
            extraField: 'should-fail',
          },
        ],
      },
      'strict-reject.yaml'
    );
    await expect(
      loadIdentityManifest({
        manifestPath: path,
        controlPlanePublicKey: publicKey,
        factoryRegistry: registryWith('reference_adapter'),
      })
    ).rejects.toThrow('schema validation failed');
  });

  it('loads real config/identity/providers.v1.yaml from repo', async () => {
    const records = await loadIdentityManifest({
      manifestPath: 'config/identity/providers.v1.yaml',
      controlPlanePublicKey: publicKey,
      factoryRegistry: registryWith('reference_adapter'),
    });
    expect(records).toHaveLength(1);
    expect(records[0].providerId).toBe('ria');
  });
});

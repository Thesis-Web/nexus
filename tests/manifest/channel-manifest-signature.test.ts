/**
 * Approval Channel Manifest Signature + Loader Tests — spec §38.11
 *
 * Parallel coverage to endpoint-manifest-signature.test.ts.
 * Exercises the full loadChannelManifest chain:
 *   signed YAML → loadSignedManifest → schema → factory registry → uniqueness → fail-closed
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { loadControlPlaneKey } from '../../packages/core/src/crypto/key-manager.js';
import { signManifest } from '../../packages/runtime-utils/src/manifest/sign-manifest.js';
import { loadChannelManifest } from '../../packages/core/src/manifest/channels/channel-manifest-loader.js';
import { ApprovalChannelFactoryRegistry } from '../../packages/core/src/manifest/channels/channel-factory-registry.js';
import type { ApprovalChannelFactory } from '@nexus/contracts';

let privateKey: string;
let publicKey: string;
let tempDir: string;
const tempFiles: string[] = [];

function stubFactory(channelType: string): ApprovalChannelFactory {
  return {
    channelType: channelType as import('@nexus/contracts').NonEmpty,
    create: async () => ({
      channelId: channelType as import('@nexus/contracts').NonEmpty,
      channelVersion: '1.0.0' as import('@nexus/contracts').NonEmpty,
      dispatch: async () => {},
      awaitDecision: async () => null,
    }),
  };
}

function registryWith(...types: string[]): ApprovalChannelFactoryRegistry {
  const reg = new ApprovalChannelFactoryRegistry();
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
  tempDir = await fs.mkdtemp(join(tmpdir(), 'nexus-chan-manifest-'));
});

afterEach(async () => {
  for (const f of tempFiles.splice(0)) {
    await fs.unlink(f).catch(() => {});
  }
});

describe('Channel Manifest Loader', () => {
  it('loads valid manifest with one enabled channel', async () => {
    const path = await writeSignedManifest(
      {
        channels: [
          {
            channelId: 'cli',
            channelType: 'cli',
            configuration: {},
            enabled: true,
          },
        ],
      },
      'valid.yaml'
    );
    const records = await loadChannelManifest({
      manifestPath: path,
      controlPlanePublicKey: publicKey,
      factoryRegistry: registryWith('cli'),
    });
    expect(records).toHaveLength(1);
    expect(records[0].channelId).toBe('cli');
    expect(records[0].channelType).toBe('cli');
  });

  it('skips disabled entries', async () => {
    const path = await writeSignedManifest(
      {
        channels: [
          {
            channelId: 'cli',
            channelType: 'cli',
            configuration: {},
            enabled: true,
          },
          {
            channelId: 'webhook',
            channelType: 'webhook',
            configuration: {},
            enabled: false,
          },
        ],
      },
      'disabled.yaml'
    );
    const records = await loadChannelManifest({
      manifestPath: path,
      controlPlanePublicKey: publicKey,
      factoryRegistry: registryWith('cli', 'webhook'),
    });
    expect(records).toHaveLength(1);
    expect(records[0].channelId).toBe('cli');
  });

  it('rejects invalid signature', async () => {
    const envelope = await signManifest({
      body: {
        channels: [
          {
            channelId: 'cli',
            channelType: 'cli',
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
      loadChannelManifest({
        manifestPath: path,
        controlPlanePublicKey: publicKey,
        factoryRegistry: registryWith('cli'),
      })
    ).rejects.toThrow('signature verification failed');
  });

  it('rejects duplicate channelId', async () => {
    const path = await writeSignedManifest(
      {
        channels: [
          {
            channelId: 'cli',
            channelType: 'cli',
            configuration: {},
            enabled: true,
          },
          {
            channelId: 'cli',
            channelType: 'cli',
            configuration: {},
            enabled: true,
          },
        ],
      },
      'dup.yaml'
    );
    await expect(
      loadChannelManifest({
        manifestPath: path,
        controlPlanePublicKey: publicKey,
        factoryRegistry: registryWith('cli'),
      })
    ).rejects.toThrow("duplicate channelId 'cli'");
  });

  it('rejects unknown channelType not in factory registry', async () => {
    const path = await writeSignedManifest(
      {
        channels: [
          {
            channelId: 'mystery',
            channelType: 'nonexistent',
            configuration: {},
            enabled: true,
          },
        ],
      },
      'unknown.yaml'
    );
    await expect(
      loadChannelManifest({
        manifestPath: path,
        controlPlanePublicKey: publicKey,
        factoryRegistry: registryWith('cli'),
      })
    ).rejects.toThrow("channelType 'nonexistent' not registered");
  });

  it('fails closed on zero enabled channels (§14.6.6)', async () => {
    const path = await writeSignedManifest(
      {
        channels: [
          {
            channelId: 'cli',
            channelType: 'cli',
            configuration: {},
            enabled: false,
          },
        ],
      },
      'all-disabled.yaml'
    );
    await expect(
      loadChannelManifest({
        manifestPath: path,
        controlPlanePublicKey: publicKey,
        factoryRegistry: registryWith('cli'),
      })
    ).rejects.toThrow('zero enabled channels');
  });

  it('loads real config/channels/channels.v1.yaml from repo', async () => {
    const records = await loadChannelManifest({
      manifestPath: 'config/channels/channels.v1.yaml',
      controlPlanePublicKey: publicKey,
      factoryRegistry: registryWith('cli'),
    });
    expect(records).toHaveLength(1);
    expect(records[0].channelId).toBe('cli');
  });
});

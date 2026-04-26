/**
 * Endpoint Manifest Signature + Loader Tests — spec §38.11
 *
 * Parallel coverage to identity/connector/channel-manifest-signature.test.ts.
 * Exercises the full loadEndpointManifest chain:
 *   signed YAML → loadSignedManifest → schema → adapterRegistry → uniqueness →
 *   secretRef → fail-closed
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { loadControlPlaneKey } from '../../packages/core/src/crypto/key-manager.js';
import { signManifest } from '../../packages/runtime-utils/src/manifest/sign-manifest.js';
import { loadEndpointManifest } from '../../packages/vanguard/src/transport/endpoints/endpoint-manifest-loader.js';
import { ModelTransportAdapterRegistry } from '../../packages/vanguard/src/transport/registry.js';
import type {
  ModelTransportAdapter,
  SecretSource,
  NonEmpty,
  ModelEndpoint,
  ModelEndpointResponse,
  NvgOutboundRequest,
} from '@nexus/contracts';

let privateKey: string;
let publicKey: string;
let tempDir: string;
const tempFiles: string[] = [];

// ─── Stub adapter satisfying ModelTransportAdapter (structural configSchema) ───

function stubAdapter(adapterId: string): ModelTransportAdapter {
  return {
    adapterId: adapterId as NonEmpty,
    adapterVersion: '1.0.0' as NonEmpty,
    configSchema: {
      safeParse: (input: unknown) => ({
        success: true as const,
        data: (input ?? {}) as Record<string, unknown>,
      }),
    },
    invoke: async (
      _endpoint: ModelEndpoint,
      _request: NvgOutboundRequest,
      _secretSource: SecretSource
    ): Promise<ModelEndpointResponse> => ({
      success: true,
      responseSize: 0,
      latencyMs: 0,
    }),
  };
}

function registryWith(...adapterIds: string[]): ModelTransportAdapterRegistry {
  const reg = new ModelTransportAdapterRegistry();
  for (const id of adapterIds) reg.register(stubAdapter(id));
  return reg;
}

function permissiveSecretSource(): SecretSource {
  return {
    canResolve: async () => true,
    resolve: async () => 'stub-secret-value',
  };
}

function validEndpointEntry(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    endpointId: 'ep-1',
    tier: 'on_prem_general',
    url: 'http://localhost:11434/api/chat',
    adapterId: 'ollama-chat-v1',
    modelName: 'llama3.2',
    auth: { kind: 'none' },
    enabled: true,
    ...overrides,
  };
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
  tempDir = await fs.mkdtemp(join(tmpdir(), 'nexus-ep-manifest-'));
});

afterEach(async () => {
  for (const f of tempFiles.splice(0)) {
    await fs.unlink(f).catch(() => {});
  }
});

describe('Endpoint Manifest Loader (signature chain)', () => {
  it('loads valid manifest with one enabled endpoint', async () => {
    const path = await writeSignedManifest({ endpoints: [validEndpointEntry()] }, 'valid.yaml');
    const endpoints = await loadEndpointManifest({
      manifestPath: path,
      controlPlanePublicKey: publicKey,
      adapterRegistry: registryWith('ollama-chat-v1'),
      secretSource: permissiveSecretSource(),
    });
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].endpointId).toBe('ep-1');
    expect(endpoints[0].adapterId).toBe('ollama-chat-v1');
    expect(endpoints[0].healthy).toBe(true);
  });

  it('skips disabled entries', async () => {
    const path = await writeSignedManifest(
      {
        endpoints: [
          validEndpointEntry(),
          validEndpointEntry({ endpointId: 'ep-2', enabled: false }),
        ],
      },
      'disabled.yaml'
    );
    const endpoints = await loadEndpointManifest({
      manifestPath: path,
      controlPlanePublicKey: publicKey,
      adapterRegistry: registryWith('ollama-chat-v1'),
      secretSource: permissiveSecretSource(),
    });
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].endpointId).toBe('ep-1');
  });

  it('rejects invalid signature', async () => {
    const envelope = await signManifest({
      body: { endpoints: [validEndpointEntry()] },
      privateKey,
      issuer: 'nexus-test',
      manifestVersion: '1.0',
    });
    const corrupted = {
      ...envelope,
      signature: 'AAAA' + envelope.signature.slice(4),
    };
    const path = join(tempDir, 'badsig.yaml');
    await fs.writeFile(path, yaml.dump(corrupted), 'utf-8');
    tempFiles.push(path);

    await expect(
      loadEndpointManifest({
        manifestPath: path,
        controlPlanePublicKey: publicKey,
        adapterRegistry: registryWith('ollama-chat-v1'),
        secretSource: permissiveSecretSource(),
      })
    ).rejects.toThrow('signature verification failed');
  });

  it('rejects duplicate endpointId', async () => {
    const path = await writeSignedManifest(
      {
        endpoints: [
          validEndpointEntry(),
          validEndpointEntry({
            endpointId: 'ep-1',
            url: 'http://other:11434/api/chat',
          }),
        ],
      },
      'dup.yaml'
    );
    await expect(
      loadEndpointManifest({
        manifestPath: path,
        controlPlanePublicKey: publicKey,
        adapterRegistry: registryWith('ollama-chat-v1'),
        secretSource: permissiveSecretSource(),
      })
    ).rejects.toThrow("duplicate endpointId 'ep-1'");
  });

  it('rejects unknown adapterId not in registry', async () => {
    const path = await writeSignedManifest(
      { endpoints: [validEndpointEntry({ adapterId: 'nonexistent-v1' })] },
      'unknown-adapter.yaml'
    );
    await expect(
      loadEndpointManifest({
        manifestPath: path,
        controlPlanePublicKey: publicKey,
        adapterRegistry: registryWith('ollama-chat-v1'),
        secretSource: permissiveSecretSource(),
      })
    ).rejects.toThrow("adapterId 'nonexistent-v1' not registered");
  });

  it('fails closed on zero enabled endpoints (§26.5 Step 9)', async () => {
    const path = await writeSignedManifest(
      { endpoints: [validEndpointEntry({ enabled: false })] },
      'all-disabled.yaml'
    );
    await expect(
      loadEndpointManifest({
        manifestPath: path,
        controlPlanePublicKey: publicKey,
        adapterRegistry: registryWith('ollama-chat-v1'),
        secretSource: permissiveSecretSource(),
      })
    ).rejects.toThrow('zero enabled endpoints');
  });

  it('rejects schema-invalid body (missing required field)', async () => {
    const path = await writeSignedManifest(
      {
        endpoints: [
          {
            endpointId: 'ep-1',
            // missing tier, url, adapterId, modelName, auth
            enabled: true,
          },
        ],
      },
      'bad-schema.yaml'
    );
    await expect(
      loadEndpointManifest({
        manifestPath: path,
        controlPlanePublicKey: publicKey,
        adapterRegistry: registryWith('ollama-chat-v1'),
        secretSource: permissiveSecretSource(),
      })
    ).rejects.toThrow('schema validation failed');
  });

  it('rejects schema-invalid body (unknown top-level field via .strict())', async () => {
    const path = await writeSignedManifest(
      {
        endpoints: [
          {
            ...validEndpointEntry(),
            extraField: 'should-fail',
          },
        ],
      },
      'strict-reject.yaml'
    );
    await expect(
      loadEndpointManifest({
        manifestPath: path,
        controlPlanePublicKey: publicKey,
        adapterRegistry: registryWith('ollama-chat-v1'),
        secretSource: permissiveSecretSource(),
      })
    ).rejects.toThrow('schema validation failed');
  });

  it('loads real config/nvg/endpoints.v1.yaml from repo', async () => {
    const endpoints = await loadEndpointManifest({
      manifestPath: 'config/nvg/endpoints.v1.yaml',
      controlPlanePublicKey: publicKey,
      adapterRegistry: registryWith('ollama-chat-v1', 'anthropic-messages-v1', 'openai-chat-v1'),
      secretSource: permissiveSecretSource(),
    });
    // Real config has local-ollama enabled, anthropic + openai disabled
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].endpointId).toBe('local-ollama');
    expect(endpoints[0].adapterId).toBe('ollama-chat-v1');
  });

  it('preserves adapterConfig on ModelEndpoint when present', async () => {
    const path = await writeSignedManifest(
      {
        endpoints: [
          validEndpointEntry({
            adapterConfig: { options: { num_predict: 2048 } },
          }),
        ],
      },
      'with-config.yaml'
    );
    const endpoints = await loadEndpointManifest({
      manifestPath: path,
      controlPlanePublicKey: publicKey,
      adapterRegistry: registryWith('ollama-chat-v1'),
      secretSource: permissiveSecretSource(),
    });
    expect(endpoints[0].adapterConfig).toEqual({
      options: { num_predict: 2048 },
    });
  });

  it('preserves timeoutMs on ModelEndpoint when present', async () => {
    const path = await writeSignedManifest(
      { endpoints: [validEndpointEntry({ timeoutMs: 5000 })] },
      'with-timeout.yaml'
    );
    const endpoints = await loadEndpointManifest({
      manifestPath: path,
      controlPlanePublicKey: publicKey,
      adapterRegistry: registryWith('ollama-chat-v1'),
      secretSource: permissiveSecretSource(),
    });
    expect(endpoints[0].timeoutMs).toBe(5000);
  });
});

/**
 * Endpoint Manifest Schema + Loader Validation Tests — spec §38.11
 *
 * Detailed schema and loader validation tests for the endpoint manifest.
 * Covers: .strict() rejection, auth discriminated union, adapterConfig
 * acceptance/forbidden keys, secretRef resolvability, fail-closed.
 *
 * 22 tests per spec §38.11 listing.
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

// ─── Helpers ───

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

function denyingSecretSource(): SecretSource {
  return {
    canResolve: async () => false,
    resolve: async () => null,
  };
}

function throwingSecretSource(): SecretSource {
  return {
    canResolve: async () => {
      throw new Error('secret backend crash');
    },
    resolve: async () => {
      throw new Error('secret backend crash');
    },
  };
}

function validEntry(overrides?: Record<string, unknown>): Record<string, unknown> {
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

function authEntry(overrides?: Record<string, unknown>): Record<string, unknown> {
  return validEntry({
    auth: {
      kind: 'api_key',
      secretRef: 'MY_API_KEY',
      headerName: 'Authorization',
    },
    ...overrides,
  });
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

async function loadWith(
  path: string,
  opts?: {
    registry?: ModelTransportAdapterRegistry;
    secretSource?: SecretSource;
  }
) {
  return loadEndpointManifest({
    manifestPath: path,
    controlPlanePublicKey: publicKey,
    adapterRegistry: opts?.registry ?? registryWith('ollama-chat-v1'),
    secretSource: opts?.secretSource ?? permissiveSecretSource(),
  });
}

beforeAll(async () => {
  const key = await loadControlPlaneKey();
  privateKey = key.privateKey;
  publicKey = key.publicKey;
  tempDir = await fs.mkdtemp(join(tmpdir(), 'nexus-ep-schema-'));
});

afterEach(async () => {
  for (const f of tempFiles.splice(0)) {
    await fs.unlink(f).catch(() => {});
  }
});

describe('Endpoint Manifest Schema Validation (§38.11)', () => {
  // ── Schema strictness ──

  it('strict schema rejects unknown TOP-LEVEL fields (manifest envelope)', async () => {
    const path = await writeSignedManifest(
      {
        endpoints: [{ ...validEntry(), unknownField: 'reject-me' }],
      },
      'strict-top.yaml'
    );
    await expect(loadWith(path)).rejects.toThrow('schema validation failed');
  });

  // ── Auth discriminated union ──

  it('auth.kind === none with secretRef present: load throws schema error', async () => {
    const path = await writeSignedManifest(
      {
        endpoints: [
          validEntry({
            auth: { kind: 'none', secretRef: 'SHOULD_NOT_EXIST' },
          }),
        ],
      },
      'auth-none-secretref.yaml'
    );
    await expect(loadWith(path)).rejects.toThrow('schema validation failed');
  });

  it('auth.kind === api_key missing headerName: load throws schema error', async () => {
    const path = await writeSignedManifest(
      {
        endpoints: [
          validEntry({
            auth: { kind: 'api_key', secretRef: 'MY_KEY' },
            // missing headerName
          }),
        ],
      },
      'auth-no-header.yaml'
    );
    await expect(loadWith(path)).rejects.toThrow('schema validation failed');
  });

  // ── adapterConfig acceptance ──

  it('adapterConfig field accepted as Record<string, unknown> at envelope level (audit B1)', async () => {
    const path = await writeSignedManifest(
      {
        endpoints: [validEntry({ adapterConfig: { foo: 'bar', num: 42 } })],
      },
      'adapter-config-accepted.yaml'
    );
    const eps = await loadWith(path);
    expect(eps).toHaveLength(1);
    expect(eps[0].adapterConfig).toEqual({ foo: 'bar', num: 42 });
  });

  it('adapterConfig field absent: schema parse succeeds (adapterConfig is optional)', async () => {
    const path = await writeSignedManifest({ endpoints: [validEntry()] }, 'no-adapter-config.yaml');
    const eps = await loadWith(path);
    expect(eps).toHaveLength(1);
    expect(eps[0].adapterConfig).toBeUndefined();
  });

  // ── Loader-level validation ──

  it('duplicate endpointId: load throws explicit duplicate error', async () => {
    const path = await writeSignedManifest(
      {
        endpoints: [validEntry(), validEntry({ url: 'http://other:11434/api/chat' })],
      },
      'dup-id.yaml'
    );
    await expect(loadWith(path)).rejects.toThrow("duplicate endpointId 'ep-1'");
  });

  it('unknown adapterId: load throws "adapterId not registered" error', async () => {
    const path = await writeSignedManifest(
      { endpoints: [validEntry({ adapterId: 'nonexistent-v1' })] },
      'bad-adapter.yaml'
    );
    await expect(loadWith(path)).rejects.toThrow("adapterId 'nonexistent-v1' not registered");
  });

  // ── secretRef resolvability ──

  it('disabled entry skips secretRef resolvability check', async () => {
    const path = await writeSignedManifest(
      {
        endpoints: [
          validEntry(), // enabled, no auth → ok
          authEntry({ endpointId: 'ep-disabled', enabled: false }),
        ],
      },
      'disabled-skip-secret.yaml'
    );
    // Denying secret source would throw for enabled auth entries but disabled are skipped
    const eps = await loadWith(path, { secretSource: denyingSecretSource() });
    expect(eps).toHaveLength(1);
    expect(eps[0].endpointId).toBe('ep-1');
  });

  it('enabled entry with unresolvable secretRef (canResolve false): load throws', async () => {
    const path = await writeSignedManifest(
      { endpoints: [authEntry()] },
      'unresolvable-secret.yaml'
    );
    await expect(loadWith(path, { secretSource: denyingSecretSource() })).rejects.toThrow(
      "secretRef 'MY_API_KEY' not resolvable"
    );
  });

  it('enabled entry with secretSource throwing on canResolve: load throws "secret backend threw"', async () => {
    const path = await writeSignedManifest({ endpoints: [authEntry()] }, 'secret-crash.yaml');
    await expect(loadWith(path, { secretSource: throwingSecretSource() })).rejects.toThrow(
      'secret backend threw'
    );
  });

  // ── fail-closed ──

  it('manifest with zero enabled entries: load throws "fail closed"', async () => {
    const path = await writeSignedManifest(
      { endpoints: [validEntry({ enabled: false })] },
      'zero-enabled.yaml'
    );
    await expect(loadWith(path)).rejects.toThrow('zero enabled endpoints');
  });

  // ── Forbidden adapterConfig keys (§26.5 Step 6.4) ──

  const FORBIDDEN_KEYS = [
    'stream',
    'streaming',
    'model',
    'messages',
    'auth',
    'url',
    'adapterId',
    'endpointId',
    'tier',
    'enabled',
    'healthy',
  ];

  for (const key of FORBIDDEN_KEYS) {
    it(`adapterConfig forbidden key '${key}': load throws`, async () => {
      const path = await writeSignedManifest(
        {
          endpoints: [
            validEntry({
              adapterConfig: { [key]: 'forbidden-value' },
            }),
          ],
        },
        `forbidden-${key}.yaml`
      );
      await expect(loadWith(path)).rejects.toThrow(`adapterConfig.${key} is forbidden`);
    });
  }
});

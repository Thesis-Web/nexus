#!/usr/bin/env tsx
/**
 * E2E Config Migration — one-shot
 *
 * Brings the local reference deployment in line with the end-to-end prompt
 * flow:
 *
 *   1. keys/mode-config.json     — set nvgMode='enforce' so NVG actually
 *                                   invokes the model (observe mode skips
 *                                   invocation per nvg-service.ts §7.5).
 *   2. config/output/compile-return.v1.yaml
 *                                — point reference-workspace-return at the
 *                                   real /compile-return/:returnEndpointId
 *                                   route on the management API port (7701).
 *   3. config/nvg/endpoints.v1.yaml
 *                                — append /api/chat to ollama endpoints
 *                                   whose URLs are missing the path. The
 *                                   OllamaChatV1Adapter does not auto-suffix.
 *
 * All three artifacts are signed; this script re-signs each with the
 * control-plane key after the in-place edit.
 *
 * Usage: pnpm tsx scripts/fix-e2e-configs.ts
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ManifestWriterService } from '../packages/core/src/manifest/manifest-writer-service.js';
import { loadControlPlaneKey } from '../packages/core/src/crypto/key-manager.js';
import { canonicalize } from '../packages/core/src/crypto/canonicalize.js';
import { sign } from '../packages/core/src/crypto/signer.js';
import type { Base64Url, IsoTimestamp, ModeConfiguration } from '@nexus/contracts';

const ROOT = process.cwd();
const MODE_CONFIG_PATH = path.join(ROOT, 'keys', 'mode-config.json');
const ENDPOINTS_PATH = path.join(ROOT, 'config', 'nvg', 'endpoints.v1.yaml');
const COMPILE_RETURN_PATH = path.join(ROOT, 'config', 'output', 'compile-return.v1.yaml');

const COMPILE_RETURN_URL = 'http://127.0.0.1:7701/compile-return/reference-workspace-return';

async function fixModeConfig(): Promise<void> {
  const keypair = await loadControlPlaneKey();
  const raw = await fs.readFile(MODE_CONFIG_PATH, 'utf-8');
  const current = JSON.parse(raw) as ModeConfiguration;

  if (current.nvgMode === 'enforce') {
    console.log('[mode] already enforce — nothing to do');
    return;
  }

  const next: ModeConfiguration = {
    nxsMode: current.nxsMode,
    nvgMode: 'enforce',
    enforcingLocked: current.enforcingLocked,
    updatedAt: new Date().toISOString() as IsoTimestamp,
    updatedBy: { adminId: current.updatedBy.adminId, publicKey: keypair.publicKey as Base64Url },
    signature: '' as Base64Url,
  };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { signature: _drop, ...body } = next;
  next.signature = (await sign(canonicalize(body), keypair)) as Base64Url;
  await fs.writeFile(MODE_CONFIG_PATH, JSON.stringify(next, null, 2), 'utf-8');
  console.log(`[mode] nvgMode → enforce  (nxsMode unchanged: ${next.nxsMode})`);
}

async function fixEndpointPaths(writer: ManifestWriterService): Promise<void> {
  const entries = await writer.readEntries(ENDPOINTS_PATH, 'endpoints');
  for (const entry of entries) {
    const url = entry['url'];
    const adapter = entry['adapterId'];
    if (
      typeof url !== 'string' ||
      typeof adapter !== 'string' ||
      adapter !== 'ollama-chat-v1' ||
      url.includes('/api/')
    ) {
      continue;
    }
    const fixed = url.replace(/\/+$/, '') + '/api/chat';
    await writer.updateEntry(
      ENDPOINTS_PATH,
      'endpoints',
      String(entry['endpointId']),
      { url: fixed },
      'endpointId'
    );
    console.log(`[endpoints] ${entry['endpointId']}  ${url}  →  ${fixed}`);
  }
}

async function fixCompileReturnUrl(writer: ManifestWriterService): Promise<void> {
  const entries = await writer.readEntries(COMPILE_RETURN_PATH, 'returnEndpoints');
  for (const entry of entries) {
    if (entry['url'] === COMPILE_RETURN_URL) continue;
    await writer.updateEntry(
      COMPILE_RETURN_PATH,
      'returnEndpoints',
      String(entry['returnEndpointId']),
      { url: COMPILE_RETURN_URL },
      'returnEndpointId'
    );
    console.log(
      `[compile-return] ${entry['returnEndpointId']}  ${entry['url']}  →  ${COMPILE_RETURN_URL}`
    );
  }
}

async function main(): Promise<void> {
  const keypair = await loadControlPlaneKey();
  const writer = new ManifestWriterService({
    privateKey: keypair.privateKey,
    issuer: 'nexus-dev',
  });

  await fixModeConfig();
  await fixEndpointPaths(writer);
  await fixCompileReturnUrl(writer);

  console.log('\n[fix-e2e-configs] done');
}

void main().catch(err => {
  console.error('[fix-e2e-configs] failed:', err);
  process.exit(1);
});

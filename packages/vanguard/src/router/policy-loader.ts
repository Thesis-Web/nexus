/**
 * NVG Routing Policy Loader — spec §25.1, blueprint §14.4
 * CONTRA-S29-001: Versioned, signed YAML with signature validation.
 * Crypto injected via DI — Layer 3 stays Layer 2-only.
 */
import yaml from 'js-yaml';
import { readFileSync } from 'fs';
import type { NvgRoutingPolicy, Base64Url } from '@nexus/contracts';
import { validateRoutingPolicy } from './routing-policy.js';

export interface PolicyLoaderCrypto {
  verify: (data: string, signature: string, publicKey: string) => Promise<boolean>;
  canonicalize: (obj: unknown) => string;
}

export async function loadNvgRoutingPolicy(
  filepath: string,
  publicKey: Base64Url,
  crypto: PolicyLoaderCrypto
): Promise<NvgRoutingPolicy> {
  let raw: string;
  try {
    raw = readFileSync(filepath, 'utf-8');
  } catch {
    throw new Error(`NVG_POLICY_NOT_FOUND: ${filepath}`);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = yaml.load(raw) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `NVG_POLICY_INVALID_YAML: ${filepath} — ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`NVG_POLICY_INVALID_YAML: ${filepath} — not a YAML object`);
  }

  const policy = parsed as unknown as NvgRoutingPolicy;

  const signature = policy.signature;
  if (!signature || typeof signature !== 'string' || signature.length === 0) {
    throw new Error(`NVG_POLICY_UNSIGNED: ${filepath} — signature missing or empty`);
  }

  const { signature: _sig, ...body } = policy;
  const valid = await crypto.verify(crypto.canonicalize(body), signature, publicKey);
  if (!valid) {
    throw new Error(`NVG_POLICY_SIG_INVALID: ${filepath} — Ed25519 signature verification failed`);
  }

  validateRoutingPolicy(policy);

  return policy;
}

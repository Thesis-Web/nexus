/**
 * NVG Threat Test 12 — Unsigned Routing Policy
 * Spec §38.3 item 2: unsigned routing policy → rejected at load
 *
 * Routing policies must carry valid Ed25519 signatures verified against
 * the control-plane public key. An unsigned or tampered policy must be
 * rejected before any routing decisions are made.
 *
 * Also tests §25.2: validateRoutingPolicy rejects rules that route
 * sensitive data to frontier tiers.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { validateRoutingPolicy } from './router/tier-registry.js';
import { canonicalize } from '../../core/src/crypto/canonicalize.js';
import { sign } from '../../core/src/crypto/signer.js';
import { verify } from '../../core/src/crypto/verifier.js';
import { loadControlPlaneKey } from '../../core/src/crypto/key-manager.js';
import type {
  NvgRoutingPolicy,
  KeyPair,
  IsoTimestamp,
  Uuid,
  NonEmpty,
  Base64Url,
} from '@nexus/contracts';

let controlPlanePair: KeyPair;
beforeAll(async () => {
  controlPlanePair = await loadControlPlaneKey();
});

function makePolicy(overrides: Partial<NvgRoutingPolicy> = {}): NvgRoutingPolicy {
  return {
    version: 'v0.1.0' as NonEmpty,
    policyId: randomUUID() as Uuid,
    issuer: 'nexus-admin' as NonEmpty,
    issuedAt: new Date().toISOString() as IsoTimestamp,
    defaultAction: 'deny',
    rules: [],
    signature: '' as Base64Url,
    ...overrides,
  };
}

describe('NVG Threat: Unsigned Routing Policy (§38.3)', () => {
  it('rejects a routing policy with empty signature', async () => {
    const policy = makePolicy({ signature: '' as Base64Url });
    const { signature: _, ...body } = policy;
    const isValid = await verify(canonicalize(body), '', controlPlanePair.publicKey);
    expect(isValid).toBe(false);
  });

  it('rejects a routing policy with tampered signature', async () => {
    const policy = makePolicy();
    const { signature: _, ...body } = policy;
    const tampered =
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const isValid = await verify(canonicalize(body), tampered, controlPlanePair.publicKey);
    expect(isValid).toBe(false);
  });

  it('accepts a correctly signed routing policy', async () => {
    const policy = makePolicy();
    const { signature: _, ...body } = policy;
    const sig = await sign(canonicalize(body), controlPlanePair);
    const isValid = await verify(canonicalize(body), sig, controlPlanePair.publicKey);
    expect(isValid).toBe(true);
  });

  it('rejects a policy body modified after signing', async () => {
    const policy = makePolicy();
    const { signature: _, ...body } = policy;
    const sig = await sign(canonicalize(body), controlPlanePair);
    // Tamper with the body after signing
    const tampered = { ...body, issuer: 'attacker' as NonEmpty };
    const isValid = await verify(canonicalize(tampered), sig, controlPlanePair.publicKey);
    expect(isValid).toBe(false);
  });
});

describe('NVG Threat: Routing Policy Classification Violation (§25.2)', () => {
  it('rejects policy that routes PII data to frontier_general', () => {
    const policy = makePolicy({
      rules: [
        {
          ruleId: 'bad-rule' as NonEmpty,
          priority: 100,
          conditions: { dataClasses: ['pii'] },
          routeTo: 'frontier_general',
        },
      ],
    });
    expect(() => validateRoutingPolicy(policy)).toThrow('ROUTING_POLICY_VIOLATION');
  });

  it('rejects policy whose fallback routes sensitive data to frontier', () => {
    const policy = makePolicy({
      rules: [
        {
          ruleId: 'bad-fallback' as NonEmpty,
          priority: 100,
          conditions: { dataClasses: ['phi'] },
          routeTo: 'on_prem_sensitive',
          fallbackTier: 'frontier_reasoning',
        },
      ],
    });
    expect(() => validateRoutingPolicy(policy)).toThrow('ROUTING_POLICY_VIOLATION');
  });

  it('accepts policy that routes sensitive data to on-prem only', () => {
    const policy = makePolicy({
      rules: [
        {
          ruleId: 'safe-rule' as NonEmpty,
          priority: 100,
          conditions: { dataClasses: ['pii', 'phi'] },
          routeTo: 'on_prem_sensitive',
        },
      ],
    });
    expect(() => validateRoutingPolicy(policy)).not.toThrow();
  });

  it('accepts policy that routes public data to frontier', () => {
    const policy = makePolicy({
      rules: [
        {
          ruleId: 'public-frontier' as NonEmpty,
          priority: 100,
          conditions: { dataClasses: ['public'] },
          routeTo: 'frontier_general',
        },
      ],
    });
    expect(() => validateRoutingPolicy(policy)).not.toThrow();
  });
});

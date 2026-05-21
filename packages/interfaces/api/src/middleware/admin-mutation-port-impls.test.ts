/**
 * Unit tests for the SignedAdminMutation port implementations
 * (server signer + verifier). Covers the sign→verify roundtrip and
 * each of the five distinct verifier failure modes the middleware
 * maps to denial codes.
 */
import { describe, it, expect } from 'vitest';
import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { Buffer } from 'node:buffer';
import type {
  AdminMutationKind,
  Base64Url,
  IsoTimestamp,
  NonEmpty,
  SignedAdminMutation,
} from '@nexus/contracts';
import {
  buildAdminMutationServerSigner,
  buildAdminMutationVerifier,
} from './admin-mutation-port-impls.js';

ed25519.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed25519.etc.concatBytes(...m));

const OPENER = '00000000-0000-4000-a000-000000000001' as NonEmpty;
const KIND: AdminMutationKind = 'actor_register';

interface Kp {
  publicKey: string;
  privateKey: string;
}

async function freshKeypair(): Promise<Kp> {
  const priv = ed25519.utils.randomPrivateKey();
  const pub = await ed25519.getPublicKeyAsync(priv);
  const enc = (b: Uint8Array): string => Buffer.from(b).toString('base64url');
  return { publicKey: enc(pub), privateKey: enc(priv) };
}

function basePayload(): { actorId: string; displayName: string } {
  return { actorId: 'aaaaaaaa-0000-4000-a000-000000000001', displayName: 'probe' };
}

function nowIso(): IsoTimestamp {
  return new Date().toISOString() as IsoTimestamp;
}

describe('AdminMutationServerSigner + Verifier — roundtrip', () => {
  it('sign-then-verify with a registered keypair returns ok with payloadDigest + signatureRef', async () => {
    const kp = await freshKeypair();
    const signer = buildAdminMutationServerSigner({
      loadAdminKeypair: async id => (id === (OPENER as unknown as string) ? kp : null),
    });
    const verifier = buildAdminMutationVerifier({
      loadAdminPublicKey: async id => (id === OPENER ? (kp.publicKey as Base64Url) : null),
    });

    const envelope: SignedAdminMutation<unknown> = await signer.sign({
      opener: OPENER,
      mutationKind: KIND,
      payload: basePayload(),
      issuedAt: nowIso(),
      nonce: 'nonce-roundtrip-001' as NonEmpty,
    });

    const result = await verifier.verify(envelope, KIND);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.opener).toBe(OPENER);
      expect(typeof result.payloadDigest).toBe('string');
      expect(result.payloadDigest.length).toBeGreaterThan(0);
      expect(result.signatureRef).toMatch(/^sha256:[A-Za-z0-9_-]{1,}$/);
    }
  });
});

describe('AdminMutationVerifier — failure modes', () => {
  it('returns malformed_envelope when a required field is missing', async () => {
    const verifier = buildAdminMutationVerifier({
      loadAdminPublicKey: async () => null,
    });
    const broken = {
      mutationKind: KIND,
      payload: basePayload(),
      opener: OPENER,
      issuedAt: nowIso(),
      // no nonce
      signature: 'whatever',
    } as unknown as SignedAdminMutation<unknown>;
    const result = await verifier.verify(broken, KIND);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('malformed_envelope');
  });

  it('returns kind_mismatch when expectedKind differs from envelope.mutationKind', async () => {
    const kp = await freshKeypair();
    const signer = buildAdminMutationServerSigner({ loadAdminKeypair: async () => kp });
    const verifier = buildAdminMutationVerifier({
      loadAdminPublicKey: async () => kp.publicKey as Base64Url,
    });
    const envelope = await signer.sign({
      opener: OPENER,
      mutationKind: 'actor_register',
      payload: basePayload(),
      issuedAt: nowIso(),
      nonce: 'nonce-kind' as NonEmpty,
    });
    const result = await verifier.verify(envelope, 'actor_deregister');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('kind_mismatch');
  });

  it('returns expired_envelope when issuedAt is older than maxEnvelopeAgeSeconds', async () => {
    const kp = await freshKeypair();
    const signer = buildAdminMutationServerSigner({ loadAdminKeypair: async () => kp });
    // Clock locked at now; envelope issuedAt 2 hours in the past (> 1h default).
    const envelope = await signer.sign({
      opener: OPENER,
      mutationKind: KIND,
      payload: basePayload(),
      issuedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() as IsoTimestamp,
      nonce: 'nonce-stale' as NonEmpty,
    });
    const verifier = buildAdminMutationVerifier({
      loadAdminPublicKey: async () => kp.publicKey as Base64Url,
    });
    const result = await verifier.verify(envelope, KIND);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('expired_envelope');
  });

  it('returns opener_unknown when no registered public key for the opener', async () => {
    const kp = await freshKeypair();
    const signer = buildAdminMutationServerSigner({ loadAdminKeypair: async () => kp });
    const verifier = buildAdminMutationVerifier({
      loadAdminPublicKey: async () => null,
    });
    const envelope = await signer.sign({
      opener: OPENER,
      mutationKind: KIND,
      payload: basePayload(),
      issuedAt: nowIso(),
      nonce: 'nonce-unknown-opener' as NonEmpty,
    });
    const result = await verifier.verify(envelope, KIND);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('opener_unknown');
  });

  it('returns invalid_signature when the public key does not match the signing private key', async () => {
    const signerKp = await freshKeypair();
    const wrongKp = await freshKeypair();
    const signer = buildAdminMutationServerSigner({ loadAdminKeypair: async () => signerKp });
    const verifier = buildAdminMutationVerifier({
      loadAdminPublicKey: async () => wrongKp.publicKey as Base64Url,
    });
    const envelope = await signer.sign({
      opener: OPENER,
      mutationKind: KIND,
      payload: basePayload(),
      issuedAt: nowIso(),
      nonce: 'nonce-bad-sig' as NonEmpty,
    });
    const result = await verifier.verify(envelope, KIND);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_signature');
  });

  it('returns invalid_signature when the envelope payload is tampered after signing', async () => {
    const kp = await freshKeypair();
    const signer = buildAdminMutationServerSigner({ loadAdminKeypair: async () => kp });
    const verifier = buildAdminMutationVerifier({
      loadAdminPublicKey: async () => kp.publicKey as Base64Url,
    });
    const envelope = await signer.sign({
      opener: OPENER,
      mutationKind: KIND,
      payload: basePayload(),
      issuedAt: nowIso(),
      nonce: 'nonce-tamper' as NonEmpty,
    });
    const tampered: SignedAdminMutation<unknown> = {
      ...envelope,
      payload: { ...(envelope.payload as object), actorId: 'evil-actor-id' },
    };
    const result = await verifier.verify(tampered, KIND);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_signature');
  });
});

describe('AdminMutationServerSigner — fail-closed on missing keypair', () => {
  it('throws statusCode 412 when no keypair is registered for the opener', async () => {
    const signer = buildAdminMutationServerSigner({
      loadAdminKeypair: async () => null,
    });
    await expect(
      signer.sign({
        opener: OPENER,
        mutationKind: KIND,
        payload: basePayload(),
        issuedAt: nowIso(),
        nonce: 'nonce-no-kp' as NonEmpty,
      })
    ).rejects.toMatchObject({ statusCode: 412 });
  });
});

/**
 * Key manager — spec §15.2
 *
 * Control plane key: keys/dev.keypair.json (dev). NEXUS_KEY_PATH overrides.
 * Admin token: keys/admin.token (always gitignored).
 * Approver keys: keys/approvers/<approverId>.keypair.json (always gitignored).
 *   Loaded exclusively by this module. No other code path loads approver private keys.
 *
 * SOLVE-006: Per-approver keypair law.
 */
import * as ed25519 from '@noble/ed25519';
import { promises as fs } from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import type { Base64Url, IsoTimestamp, NonEmpty } from '../types/index.js';
import { base64urlEncode, base64urlDecode } from './signer.js';

export interface KeyPair {
  publicKey: Base64Url; // Ed25519 public key, 32 bytes base64url
  privateKey: Base64Url; // Ed25519 private key, 32 bytes base64url
  generatedAt: IsoTimestamp;
  purpose: 'control_plane' | 'approver' | 'dev';
}

/**
 * Load the control-plane keypair.
 * In dev: keys/dev.keypair.json. Override with NEXUS_KEY_PATH env var.
 */
export async function loadControlPlaneKey(): Promise<KeyPair> {
  const keyPath = process.env['NEXUS_KEY_PATH'] ?? path.join('keys', 'dev.keypair.json');
  const raw = await fs.readFile(keyPath, 'utf-8');
  return JSON.parse(raw) as KeyPair;
}

/**
 * Load a per-approver keypair by approverId.
 * Path: keys/approvers/<approverId>.keypair.json
 * Throws if not found or purpose mismatch. (SOLVE-006)
 */
export async function loadApproverKey(approverId: NonEmpty): Promise<KeyPair> {
  const keyPath = path.join('keys', 'approvers', `${approverId}.keypair.json`);
  try {
    const raw = await fs.readFile(keyPath, 'utf-8');
    const pair = JSON.parse(raw) as KeyPair;
    if (pair.purpose !== 'approver') {
      throw new Error(`key at ${keyPath} has purpose '${pair.purpose}', expected 'approver'`);
    }
    return pair;
  } catch (err) {
    throw new Error(
      `Approver key not found for approverId '${approverId}': ${(err as Error).message}`
    );
  }
}

/**
 * Generate and persist a new Ed25519 keypair for an approver.
 * Writes to keys/approvers/<approverId>.keypair.json.
 */
export async function generateApproverKeypair(approverId: NonEmpty): Promise<KeyPair> {
  const privBytes = ed25519.utils.randomPrivateKey();
  const pubBytes = await ed25519.getPublicKeyAsync(privBytes);
  const pair: KeyPair = {
    publicKey: base64urlEncode(pubBytes),
    privateKey: base64urlEncode(privBytes),
    generatedAt: new Date().toISOString(),
    purpose: 'approver',
  };
  const keyPath = path.join('keys', 'approvers', `${approverId}.keypair.json`);
  await fs.mkdir(path.dirname(keyPath), { recursive: true });
  await fs.writeFile(keyPath, JSON.stringify(pair, null, 2), 'utf-8');
  return pair;
}

/**
 * Generate and persist the control-plane dev keypair.
 * Writes to keys/dev.keypair.json.
 */
export async function generateControlPlaneKeypair(): Promise<KeyPair> {
  const privBytes = ed25519.utils.randomPrivateKey();
  const pubBytes = await ed25519.getPublicKeyAsync(privBytes);
  const pair: KeyPair = {
    publicKey: base64urlEncode(pubBytes),
    privateKey: base64urlEncode(privBytes),
    generatedAt: new Date().toISOString(),
    purpose: 'dev',
  };
  await fs.mkdir('keys', { recursive: true });
  await fs.writeFile(path.join('keys', 'dev.keypair.json'), JSON.stringify(pair, null, 2), 'utf-8');
  return pair;
}

/**
 * Generate the admin bearer token.
 * Writes to keys/admin.token. Always gitignored.
 */
export async function generateAdminToken(): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await fs.mkdir('keys', { recursive: true });
  await fs.writeFile(path.join('keys', 'admin.token'), token, 'utf-8');
  return token;
}

/**
 * Load the admin bearer token from keys/admin.token.
 */
export async function loadAdminToken(): Promise<string> {
  return (await fs.readFile(path.join('keys', 'admin.token'), 'utf-8')).trim();
}

/**
 * Generate the workspace JWT HMAC-SHA256 signing secret.
 * 256-bit random, base64url encoded. Written to keys/workspace-jwt.secret.
 * Always gitignored. Same security posture as admin token.
 */
export async function generateWorkspaceJwtSecret(): Promise<string> {
  const secret = randomBytes(32).toString('base64url');
  await fs.mkdir('keys', { recursive: true });
  await fs.writeFile(path.join('keys', 'workspace-jwt.secret'), secret, 'utf-8');
  return secret;
}

/**
 * Load the workspace JWT HMAC-SHA256 signing secret.
 * Primary: keys/workspace-jwt.secret (file-based).
 * Override: NEXUS_WORKSPACE_JWT_SECRET env var.
 * Returns undefined if neither exists — fail-closed per §5.7.
 */
export async function loadWorkspaceJwtSecret(): Promise<string | undefined> {
  const envSecret = process.env['NEXUS_WORKSPACE_JWT_SECRET'];
  if (envSecret) return envSecret;
  try {
    return (await fs.readFile(path.join('keys', 'workspace-jwt.secret'), 'utf-8')).trim();
  } catch {
    return undefined;
  }
}

export { base64urlDecode };

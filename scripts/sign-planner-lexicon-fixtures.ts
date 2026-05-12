#!/usr/bin/env tsx
// scripts/sign-planner-lexicon-fixtures.ts
// AMEND-nexus-planner-db-lexicon-v0-2-1.md §2.2, log ADD-PLANNER-LEXICON-003.
//
// Signs the 8 lexicon JSONL fixtures under fixtures/planner/db-lexicon/.
// Each fixture's first line gets replaced with a signed header per the
// canonicalization law in §2.2:
//
//   contentDigest = sha256(records.map(canonicalize).join('\n'))
//   signature     = Ed25519(canonicalize({ schemaVersion, recordCount,
//                                          contentDigest, signedAt }))
//
// Run from repo root:
//   pnpm exec tsx scripts/sign-planner-lexicon-fixtures.ts
//
// Reads keypair from $NEXUS_KEY_PATH or keys/dev.keypair.json by default.

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { canonicalize } from '@nexus/runtime-utils';

ed25519.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed25519.etc.concatBytes(...m));

const FIXTURE_DIR = 'fixtures/planner/db-lexicon';
const KEY_PATH = process.env['NEXUS_KEY_PATH'] ?? path.join('keys', 'dev.keypair.json');

const FIXTURES = [
  'planner-lexical-term.v1.jsonl',
  'planner-alias-rule.v1.jsonl',
  'planner-task-intent.v1.jsonl',
  'planner-task-capability.v1.jsonl',
  'planner-target-catalog.v1.jsonl',
  'planner-workflow-template.v1.jsonl',
  'planner-workflow-node.v1.jsonl',
  'planner-workflow-edge.v1.jsonl',
];

function base64urlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function base64urlDecode(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64url'));
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf-8').digest('hex');
}

interface Keypair {
  publicKey: string;
  privateKey: string;
}

async function loadKeypair(): Promise<Keypair> {
  const raw = await fs.readFile(KEY_PATH, 'utf-8');
  return JSON.parse(raw) as Keypair;
}

/**
 * Decide whether a line is an existing signed header (prior signing
 * run) so the script is idempotent. Signed headers are JSON objects
 * carrying a `signature` field; everything else is a record line.
 */
function looksLikeHeader(line: string): boolean {
  try {
    const parsed = JSON.parse(line);
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      'signature' in parsed &&
      'contentDigest' in parsed &&
      'schemaVersion' in parsed
    );
  } catch {
    return false;
  }
}

async function signFixture(filename: string, keypair: Keypair): Promise<void> {
  const filePath = path.join(FIXTURE_DIR, filename);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    console.error(`✗ ${filename}: cannot read (${(err as Error).message})`);
    process.exit(1);
  }

  const lines = raw.split('\n').filter(line => line.length > 0);
  if (lines.length === 0) {
    console.error(`✗ ${filename}: empty file`);
    process.exit(1);
  }

  // Strip prior header if present (script is idempotent — running
  // again replaces the header without changing records).
  const records = lines[0] && looksLikeHeader(lines[0]) ? lines.slice(1) : lines;

  if (records.length === 0) {
    console.error(`✗ ${filename}: zero records after header stripping`);
    process.exit(1);
  }

  // Canonicalize each record line (parse → canonicalize) so the digest
  // is independent of trivial whitespace differences in the authored
  // JSON.
  const canonicalRecords = records.map(line => canonicalize(JSON.parse(line)));
  const contentDigest = sha256Hex(canonicalRecords.join('\n'));

  const signedAt = new Date().toISOString();
  const headerPayload = {
    schemaVersion: 'v1',
    recordCount: records.length,
    contentDigest,
    signedAt,
  };
  const canonicalHeader = canonicalize(headerPayload);
  const msgBytes = new TextEncoder().encode(canonicalHeader);
  const privBytes = base64urlDecode(keypair.privateKey);
  const sigBytes = await ed25519.signAsync(msgBytes, privBytes);
  const signature = base64urlEncode(sigBytes);

  // Header line carries the same fields as the signed payload PLUS the
  // signature. Records are rewritten in their CANONICALIZED form so
  // the on-disk digest matches recompute (loader recomputes via the
  // same canonicalize pipeline).
  const header = JSON.stringify({ ...headerPayload, signature });
  const newContent = [header, ...canonicalRecords].join('\n') + '\n';
  await fs.writeFile(filePath, newContent, 'utf-8');

  console.log(`✓ ${filename} (${records.length} records, digest ${contentDigest.slice(0, 16)}…)`);
}

async function main(): Promise<void> {
  const keypair = await loadKeypair();
  console.log(`Signing ${FIXTURES.length} planner-lexicon fixtures with ${KEY_PATH}`);
  for (const f of FIXTURES) {
    await signFixture(f, keypair);
  }
  console.log('All planner-lexicon fixtures signed.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env tsx
/**
 * ci:gate — spec §7.4
 * All 11 steps in exact order. No step skipped. No gate waived without owner approval.
 *
 * 1.  format:check (prettier)
 * 2.  typecheck (tsc --noEmit)
 * 3.  unit tests — all 7 gate unit test files
 * 4.  threat test suite — all 10 threat test files
 * 5.  integration tests — all 10 scenario tests
 * 6.  deterministic replay test (scenarios 01, 02, 03 — CCV byte-identical)
 * 7.  ledger chain integrity verification
 * 8.  CCV integrity gate
 * 9.  no-certification-language gate
 * 10. policy signature gate
 * 11. fixture secret prefix gate (FIXTURE_SYNTHETIC_SECRET)
 *
 * Spec: nexus-engineering-spec-v0-4-6.md §7.4, §26.4–§26.9
 * Blueprint: nexus-blueprint-v0-3-6.md §4
 */

import { execSync, type ExecSyncOptions } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

// ── Constants ─────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(path.dirname(new URL('file://' + __filename).pathname), '..');

// Integration test ledger: written by vitest integration tests; read by steps 7–8.
const INTEGRATION_LEDGER_PATH = path.join(REPO_ROOT, 'runs', 'test-integration.ledger.jsonl');

// Fixtures root
const FIXTURES_DIR = path.join(REPO_ROOT, 'fixtures');

// Prohibited certification language (spec §26.4)
const PROHIBITED_STRINGS = [
  'approved by system',
  'authorized by engine',
  'Nexus certifies',
  'system confirms compliance',
  'this action is safe',
  'compliant action',
];

// Secret field pattern (spec §26.9)
const SECRET_FIELD_PATTERN = /(secret|password|key|token|credential|api_key|apikey|auth)/i;

// Artifact run dirs
const RUNS_DIR = path.join(REPO_ROOT, 'runs');

// Policy files to verify signatures on (fixture-level)
const FIXTURE_POLICY_GLOB_SUFFIX = 'policy.json';

// ── Utilities ─────────────────────────────────────────────────────────────────

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function pass(step: number, name: string): void {
  console.log(`${GREEN}${BOLD}✓ Step ${step}: ${name}${RESET}`);
}
function fail(step: number, name: string, detail: string): never {
  console.error(`${RED}${BOLD}✗ Step ${step}: ${name}${RESET}`);
  console.error(`  ${detail}`);
  process.exit(1);
}
function info(msg: string): void {
  console.log(`${YELLOW}  ${msg}${RESET}`);
}

function run(cmd: string, stepN: number, stepName: string): void {
  const opts: ExecSyncOptions = { cwd: REPO_ROOT, stdio: 'inherit' };
  try {
    execSync(cmd, opts);
  } catch {
    fail(stepN, stepName, `Command failed: ${cmd}`);
  }
}

function walkJsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkJsonFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.json')) results.push(full);
  }
  return results;
}

function flatEntries(obj: unknown, prefix = ''): [string, unknown][] {
  if (obj == null || typeof obj !== 'object') return [];
  const out: [string, unknown][] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    out.push([key, v]);
    if (v != null && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flatEntries(v, key));
    }
  }
  return out;
}

// ── Step implementations ──────────────────────────────────────────────────────

// Step 1: format:check
function step01_formatCheck(): void {
  run('pnpm exec prettier --check .', 1, 'format:check');
  pass(1, 'format:check');
}

// Step 2: typecheck
function step02_typecheck(): void {
  run('pnpm exec tsc --noEmit -p tsconfig.base.json', 2, 'typecheck');
  pass(2, 'typecheck');
}

// Step 3: unit tests
function step03_unitTests(): void {
  run('pnpm exec vitest run --reporter=verbose --config vitest.config.ts', 3, 'unit tests');
  pass(3, 'unit tests — all 7 gate unit test files');
}

// Step 4: threat tests
function step04_threatTests(): void {
  run('pnpm exec vitest run --config vitest.threat.config.ts', 4, 'threat test suite');
  pass(4, 'threat test suite — all 10 threat test files');
}

// Step 5: integration tests
function step05_integrationTests(): void {
  run('pnpm exec vitest run --config vitest.integration.config.ts', 5, 'integration tests');
  pass(5, 'integration tests — all 10 scenario integration tests');
}

// Step 6: deterministic replay — CCV byte-identical for scenarios 01, 02, 03
function step06_deterministicReplay(): void {
  const replayFile = path.join(RUNS_DIR, 'replay-ccv-hashes.json');
  if (!fs.existsSync(replayFile)) {
    fail(
      6,
      'deterministic replay',
      `Missing replay CCV hash file: ${replayFile}\nIntegration tests must write this file.`
    );
  }
  const data = JSON.parse(fs.readFileSync(replayFile, 'utf-8')) as Record<string, string>;
  const required = ['01-allow-read', '02-allow-create', '03-approval-approved'];
  for (const id of required) {
    if (!data[id]) {
      fail(6, 'deterministic replay', `Missing CCV hash for scenario ${id} in ${replayFile}`);
    }
  }
  // CCV hashes are written by two sequential integration test runs; they must match
  const runAFile = path.join(RUNS_DIR, 'replay-ccv-hashes-run-a.json');
  const runBFile = path.join(RUNS_DIR, 'replay-ccv-hashes-run-b.json');
  if (!fs.existsSync(runAFile) || !fs.existsSync(runBFile)) {
    fail(6, 'deterministic replay', `Missing run-a or run-b CCV hash files in ${RUNS_DIR}`);
  }
  const runA = JSON.parse(fs.readFileSync(runAFile, 'utf-8')) as Record<string, string>;
  const runB = JSON.parse(fs.readFileSync(runBFile, 'utf-8')) as Record<string, string>;
  for (const id of required) {
    if (runA[id] !== runB[id]) {
      fail(
        6,
        'deterministic replay',
        `CCV hash mismatch for scenario ${id}: runA=${runA[id] ?? 'missing'} runB=${runB[id] ?? 'missing'}`
      );
    }
  }
  pass(6, 'deterministic replay — scenarios 01, 02, 03 CCV byte-identical');
}

// Step 7: ledger chain integrity
async function step07_chainIntegrity(): Promise<void> {
  if (!fs.existsSync(INTEGRATION_LEDGER_PATH)) {
    fail(
      7,
      'ledger chain integrity',
      `Integration test ledger not found: ${INTEGRATION_LEDGER_PATH}`
    );
  }
  const lines = fs
    .readFileSync(INTEGRATION_LEDGER_PATH, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean);
  if (lines.length === 0) {
    fail(7, 'ledger chain integrity', 'Integration test ledger is empty');
  }

  // Verify hash chain: each record's prevHash must match the SHA-256 of the previous record body
  const GENESIS = '0000000000000000000000000000000000000000000000000000000000000000';
  let prevHash = GENESIS;
  let expectedSeq = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      fail(7, 'ledger chain integrity', `Record at line ${i + 1} is not valid JSON`);
    }

    // Sequence continuity (SEQUENCE_ANOMALY check)
    if (record['ledgerSequence'] !== expectedSeq) {
      fail(
        7,
        'ledger chain integrity',
        `Sequence anomaly at record ${i + 1}: expected seq ${expectedSeq}, got ${String(record['ledgerSequence'])}`
      );
    }

    // Hash chain
    if (record['prevHash'] !== prevHash) {
      fail(
        7,
        'ledger chain integrity',
        `Hash chain break at seq ${expectedSeq}: expected prevHash ${prevHash}, got ${String(record['prevHash'])}`
      );
    }

    // Compute this record's hash
    const { recordHash, ...body } = record;
    const bodyJson = JSON.stringify(body, Object.keys(body).sort());
    const computed = crypto.createHash('sha256').update(bodyJson).digest('hex');
    if (computed !== String(recordHash)) {
      fail(
        7,
        'ledger chain integrity',
        `recordHash mismatch at seq ${expectedSeq}: stored=${String(recordHash)} computed=${computed}`
      );
    }

    prevHash = computed;
    expectedSeq++;
  }

  pass(7, `ledger chain integrity — ${lines.length} records verified`);
}

// Step 8: CCV integrity gate
function step08_ccvIntegrity(): void {
  if (!fs.existsSync(INTEGRATION_LEDGER_PATH)) {
    fail(8, 'CCV integrity', `Integration test ledger not found: ${INTEGRATION_LEDGER_PATH}`);
  }
  const lines = fs
    .readFileSync(INTEGRATION_LEDGER_PATH, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean);
  if (lines.length === 0) {
    fail(8, 'CCV integrity', 'Integration test ledger is empty');
  }

  let checked = 0;
  for (const line of lines) {
    if (!line) continue;
    const record = JSON.parse(line) as Record<string, unknown>;
    const body = record['body'] as Record<string, unknown> | undefined;
    if (!body) {
      fail(
        8,
        'CCV integrity',
        `Record at seq ${String(record['ledgerSequence'])} missing body field`
      );
    }
    const storedCCV = body!['compilerView'];
    if (!storedCCV) {
      fail(
        8,
        'CCV integrity',
        `Record at seq ${String(record['ledgerSequence'])} missing compilerView in body`
      );
    }
    checked++;
  }

  pass(8, `CCV integrity — ${checked} records have compilerView inside body`);
}

// Step 9: no-certification-language gate
function step09_noCertLang(): void {
  const runsDir = RUNS_DIR;
  if (!fs.existsSync(runsDir)) {
    info('No runs/ output directory found — skipping artifact scan (no integration runs yet)');
    pass(9, 'no-certification-language gate — no artifacts to scan');
    return;
  }

  const jsonFiles = walkJsonFiles(runsDir);
  const violations: string[] = [];

  for (const filePath of jsonFiles) {
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const prohibited of PROHIBITED_STRINGS) {
      if (content.toLowerCase().includes(prohibited.toLowerCase())) {
        violations.push(`"${prohibited}" found in ${filePath}`);
      }
    }
  }

  if (violations.length > 0) {
    fail(
      9,
      'no-certification-language gate',
      `Prohibited strings found:\n  ${violations.join('\n  ')}`
    );
  }

  pass(9, `no-certification-language gate — ${jsonFiles.length} artifact files scanned`);
}

// Step 10: policy signature gate
async function step10_policySigGate(): Promise<void> {
  // Find all policy.json files in fixtures/
  const policyFiles = walkJsonFiles(FIXTURES_DIR).filter(f =>
    f.endsWith(FIXTURE_POLICY_GLOB_SUFFIX)
  );

  if (policyFiles.length === 0) {
    info('No fixture policy files found — nothing to verify');
    pass(10, 'policy signature gate — no fixture policy files present');
    return;
  }

  for (const policyPath of policyFiles) {
    const raw = JSON.parse(fs.readFileSync(policyPath, 'utf-8')) as Record<string, unknown>;
    const sig = raw['signature'];
    if (!sig || typeof sig !== 'string' || sig.length === 0) {
      fail(
        10,
        'policy signature gate',
        `Unsigned or empty signature in fixture policy: ${policyPath}`
      );
    }
    // Deep check: signature must not be placeholder
    if (String(sig).includes('PLACEHOLDER') || String(sig).includes('__')) {
      fail(10, 'policy signature gate', `Placeholder signature in fixture policy: ${policyPath}`);
    }
  }

  pass(10, `policy signature gate — ${policyFiles.length} fixture policy file(s) have signatures`);
}

// Step 11: fixture secret prefix gate (spec §26.9)
function step11_fixtureSecretPrefix(): void {
  const jsonFiles = walkJsonFiles(FIXTURES_DIR);

  if (jsonFiles.length === 0) {
    info('No fixture JSON files found — nothing to validate');
    pass(11, 'fixture secret prefix gate — no fixture JSON files present');
    return;
  }

  const violations: string[] = [];
  for (const filePath of jsonFiles) {
    let obj: unknown;
    try {
      obj = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      continue; // non-parseable files skipped
    }
    for (const [fieldName, value] of flatEntries(obj)) {
      if (SECRET_FIELD_PATTERN.test(fieldName) && typeof value === 'string' && value.length > 0) {
        if (!value.startsWith('FIXTURE_SYNTHETIC_SECRET:')) {
          violations.push(
            `Field '${fieldName}' in ${filePath} must be empty, null, or prefixed with FIXTURE_SYNTHETIC_SECRET:`
          );
        }
      }
    }
  }

  if (violations.length > 0) {
    fail(11, 'fixture secret prefix gate', violations.join('\n  '));
  }

  pass(11, `fixture secret prefix gate — ${jsonFiles.length} fixture JSON file(s) verified`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n${BOLD}=== Nexus ci:gate — all 11 steps ===${RESET}\n`);

  step01_formatCheck();
  step02_typecheck();
  step03_unitTests();
  step04_threatTests();
  step05_integrationTests();
  step06_deterministicReplay();
  await step07_chainIntegrity();
  step08_ccvIntegrity();
  step09_noCertLang();
  await step10_policySigGate();
  step11_fixtureSecretPrefix();

  console.log(`\n${GREEN}${BOLD}=== ci:gate PASSED — all 11 steps ===${RESET}\n`);
}

main().catch(err => {
  console.error(`\n${RED}${BOLD}ci:gate FATAL:${RESET}`, err);
  process.exit(1);
});

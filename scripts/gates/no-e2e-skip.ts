#!/usr/bin/env tsx
/**
 * GOV-E2E-SKIP-GATE — scripts/gates/no-e2e-skip.ts
 *
 * Production CI gate. The acceptance wall does not tolerate hidden
 * failure. Any `it.skip(...)`, `it.todo(...)`, `describe.skip(...)`,
 * `test.skip(...)`, `xit(...)`, or `xdescribe(...)` in tests/e2e/**.*
 * is a hard fail.
 *
 * Owner directive 2026-05-21: "we stop faking green, we log every
 * failure, we build the wall of end-to-end tests... force ourselves
 * to never wildcard, never workaround, never fake a fix. Not because
 * we say we will stop, but because our wall of tests will never let
 * us commit push trash code anymore."
 *
 * Rule IDs:
 *   GOV-E2E-SKIP-001  it.skip / test.skip / xit  in tests/e2e/**
 *   GOV-E2E-SKIP-002  it.todo / test.todo        in tests/e2e/**
 *   GOV-E2E-SKIP-003  describe.skip / xdescribe  in tests/e2e/**
 *
 * Scope:
 *   - tests/e2e/*.e2e.test.ts (and any future e2e test file)
 *   - excluding tests/e2e/_acceptance/** (infrastructure files do not
 *     define tests)
 *
 * Allowlist mechanism: scripts/gates/no-e2e-skip.allowlist.json
 *   Same shape as the no-wildcard-authority allowlist:
 *   { ruleId, file, reason, owner, reviewBy (YYYY-MM-DD), exactMatch }
 *   Wildcard / broad allowlists are rejected. Every entry must have an
 *   owner + reviewBy. Past-date entries fail the gate.
 *
 * If a future E2E surface genuinely cannot be expressed as a real
 * failing test (e.g. cross-process invariant), the correct path is to
 * throw `AcceptanceWallFailure({...})` from a real `it(...)` so the
 * reporter logs it — not to skip.
 *
 * CLI:
 *   pnpm exec tsx scripts/gates/no-e2e-skip.ts
 *   pnpm exec tsx scripts/gates/no-e2e-skip.ts --json
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

// process.cwd() is the repo root for `pnpm gate:no-e2e-skip` (matches the
// existing no-wildcard-authority gate convention; sidesteps the
// `import.meta` CJS-target restriction).
const REPO_ROOT = process.cwd();
const SCAN_DIR = path.join(REPO_ROOT, 'tests', 'e2e');
const EXCLUDE_DIRS = new Set(['_acceptance']);
const ALLOWLIST_PATH = path.join(REPO_ROOT, 'scripts', 'gates', 'no-e2e-skip.allowlist.json');

interface Violation {
  ruleId: 'GOV-E2E-SKIP-001' | 'GOV-E2E-SKIP-002' | 'GOV-E2E-SKIP-003';
  file: string;
  line: number;
  snippet: string;
}

interface AllowlistEntry {
  ruleId: string;
  file: string;
  reason: string;
  owner: string;
  reviewBy: string;
  exactMatch: string;
}

const RULES: ReadonlyArray<{
  id: Violation['ruleId'];
  // Regex must match within a single line, anchored to call syntax.
  pattern: RegExp;
}> = [
  {
    id: 'GOV-E2E-SKIP-001',
    // `it.skip(` / `test.skip(` / `xit(`. The leading word boundary keeps
    // .it.skipNothing (hypothetical) from matching.
    pattern: /\b(?:it|test)\.skip\s*\(|\bxit\s*\(/,
  },
  {
    id: 'GOV-E2E-SKIP-002',
    pattern: /\b(?:it|test)\.todo\s*\(/,
  },
  {
    id: 'GOV-E2E-SKIP-003',
    pattern: /\bdescribe\.skip\s*\(|\bxdescribe\s*\(/,
  },
];

async function walk(dir: string, files: string[]): Promise<void> {
  let entries: ReadonlyArray<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (EXCLUDE_DIRS.has(ent.name)) continue;
      await walk(full, files);
      continue;
    }
    // Only scan TS / TSX test files; the allowlist itself lives in JSON
    // and is read separately.
    if (/\.(ts|tsx)$/.test(ent.name)) files.push(full);
  }
}

async function loadAllowlist(): Promise<ReadonlyArray<AllowlistEntry>> {
  try {
    const raw = await fs.readFile(ALLOWLIST_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error('allowlist root must be an array');
    }
    const today = new Date().toISOString().slice(0, 10);
    const entries: AllowlistEntry[] = [];
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) {
        throw new Error('allowlist entry must be an object');
      }
      const e = item as Record<string, unknown>;
      const required = ['ruleId', 'file', 'reason', 'owner', 'reviewBy', 'exactMatch'];
      for (const key of required) {
        if (typeof e[key] !== 'string' || (e[key] as string).trim() === '') {
          throw new Error(`allowlist entry missing required field '${key}'`);
        }
      }
      const reviewBy = e['reviewBy'] as string;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewBy)) {
        throw new Error(`allowlist entry reviewBy must be YYYY-MM-DD, got '${reviewBy}'`);
      }
      if (reviewBy < today) {
        throw new Error(
          `allowlist entry for ${e['file']} has expired (reviewBy=${reviewBy}, today=${today}); remove or renew with owner ratification`
        );
      }
      // Reject wildcard-style allowlist files (no "**", no "*").
      const filePat = e['file'] as string;
      if (filePat.includes('*') || filePat.includes('?')) {
        throw new Error(`allowlist file '${filePat}' must be an exact path, not a glob`);
      }
      const exactMatch = e['exactMatch'] as string;
      if (exactMatch.trim() === '' || exactMatch.includes('*')) {
        throw new Error(`allowlist exactMatch must be a literal snippet, not a glob`);
      }
      entries.push({
        ruleId: e['ruleId'] as string,
        file: e['file'] as string,
        reason: e['reason'] as string,
        owner: e['owner'] as string,
        reviewBy,
        exactMatch,
      });
    }
    return entries;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

function isAllowed(
  v: Violation,
  allowlist: ReadonlyArray<AllowlistEntry>,
  repoRoot: string
): boolean {
  const relFile = path.relative(repoRoot, v.file).replace(/\\/g, '/');
  return allowlist.some(
    a => a.ruleId === v.ruleId && a.file === relFile && v.snippet.includes(a.exactMatch)
  );
}

async function scan(): Promise<Violation[]> {
  const files: string[] = [];
  await walk(SCAN_DIR, files);
  const out: Violation[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = await fs.readFile(file, 'utf-8');
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      // Strip line comments (`// ...`) and the safe-mention pattern (the
      // owner directive comments quote "no `it.skip`" verbatim — we let
      // those through). The scanner is conservative: only matches actual
      // call syntax with a `(` open-paren.
      const stripped = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
      for (const rule of RULES) {
        if (rule.pattern.test(stripped)) {
          out.push({
            ruleId: rule.id,
            file,
            line: i + 1,
            snippet: line.trim(),
          });
        }
      }
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const allowlist = await loadAllowlist();
  const all = await scan();
  const unallowed = all.filter(v => !isAllowed(v, allowlist, REPO_ROOT));

  if (json) {
    process.stdout.write(
      JSON.stringify(
        {
          gate: 'GOV-E2E-SKIP-GATE',
          totalScanned: all.length,
          allowedCount: all.length - unallowed.length,
          violationCount: unallowed.length,
          violations: unallowed.map(v => ({
            ruleId: v.ruleId,
            file: path.relative(REPO_ROOT, v.file).replace(/\\/g, '/'),
            line: v.line,
            snippet: v.snippet,
          })),
        },
        null,
        2
      ) + '\n'
    );
  } else {
    if (unallowed.length === 0) {
      console.log(
        `GOV-E2E-SKIP-GATE: clean (${all.length} matched, ${all.length - unallowed.length} allowlisted, 0 unallowed)`
      );
    } else {
      console.error(
        `GOV-E2E-SKIP-GATE: ${unallowed.length} violation${unallowed.length === 1 ? '' : 's'} found`
      );
      for (const v of unallowed) {
        const rel = path.relative(REPO_ROOT, v.file).replace(/\\/g, '/');
        console.error(`  [${v.ruleId}] ${rel}:${v.line}  ${v.snippet}`);
      }
      console.error('');
      console.error(
        'The acceptance wall does not tolerate hidden failure. Convert the skip/todo to a real `it(...)` that throws AcceptanceWallFailure with structured metadata. See tests/e2e/_acceptance/failure.ts.'
      );
    }
  }

  if (unallowed.length > 0) process.exit(1);
}

main().catch(err => {
  console.error('GOV-E2E-SKIP-GATE: scanner crashed');
  console.error(err);
  process.exit(2);
});

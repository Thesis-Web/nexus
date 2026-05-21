/**
 * Unit tests for GOV-AUTHORITY-STRICTNESS-GATE.
 *
 * The test file MUST NOT contain literal violation snippets, because the
 * scanner walks scripts/**\/*.ts. The test fixtures below are built via
 * string concatenation so the source of this file never matches a rule.
 * The tmp files we WRITE for the scanner DO contain the assembled
 * snippets — and the scanner is verified against those.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  runScan,
  validateAllowlist,
  RULE_IDS,
  type AllowlistEntry,
  type Violation,
} from './no-wildcard-authority.js';

// Build snippets at runtime so this file's source does not match scanner regexes.
const W = "'" + '*' + "'"; // "'*'"
const WDQ = '"' + '*' + '"'; // '"*"'
const SNIP_ALLOWED_SYSTEMS_WILD = `allowedSystems: [${W}]`;
const SNIP_ALLOWED_SYSTEMS_WILD_JSON = `"allowedSystems": [${WDQ}]`;
const SNIP_ALLOWED_CAPS_WILD = `allowedCapabilities: [${W}]`;
const SNIP_CATCH_RETURN_TRUE = 'function f() { try { return false; } catch { return true; } }';
const SNIP_NULL_AS_ALLOW =
  'function decide(policy: unknown) { if (!policy) return true; return false; }';
const SNIP_NULLISH_TO_WILD = `const systems = input.systems ?? [${W}];`;
const SNIP_DANGEROUS_ID = 'function godMode() { return true; }';
const SNIP_DEFAULT_ALLOW = "const cfg = { defaultDecision: 'allow' };";
const SNIP_IMPORT_STAR = "import * as fs from 'node:fs';"; // legitimate
const SNIP_MULTIPLY = 'const area = width * height;'; // legitimate
const SNIP_SQL_SELECT_STAR = "const sql = 'SELECT * FROM customers WHERE id = $1';"; // legitimate

interface Tmp {
  readonly root: string;
}

async function makeTmp(): Promise<Tmp> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gov-wild-test-'));
  return { root };
}

async function writeFixture(t: Tmp, relPath: string, content: string): Promise<string> {
  const abs = path.join(t.root, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf-8');
  return relPath;
}

async function cleanup(t: Tmp): Promise<void> {
  await fs.rm(t.root, { recursive: true, force: true });
}

function hasRule(violations: ReadonlyArray<Violation>, ruleId: string): boolean {
  return violations.some(v => v.ruleId === ruleId);
}

describe('GOV-AUTHORITY-STRICTNESS-GATE — rule coverage', () => {
  let tmp: Tmp;
  beforeEach(async () => {
    tmp = await makeTmp();
  });
  afterEach(async () => {
    await cleanup(tmp);
  });

  it('GOV-WILD-001 — allowedSystems wildcard in TS fails', async () => {
    const rel = await writeFixture(
      tmp,
      'packages/foo/src/seed.ts',
      `export const cfg = { ${SNIP_ALLOWED_SYSTEMS_WILD} };\n`
    );
    const res = await runScan({ repoRoot: tmp.root, scanPaths: [rel] });
    expect(hasRule(res.violations, 'GOV-WILD-001')).toBe(true);
  });

  it('GOV-WILD-001 — allowedCapabilities wildcard in TS fails', async () => {
    const rel = await writeFixture(
      tmp,
      'packages/foo/src/seed.ts',
      `export const cfg = { ${SNIP_ALLOWED_CAPS_WILD} };\n`
    );
    const res = await runScan({ repoRoot: tmp.root, scanPaths: [rel] });
    expect(hasRule(res.violations, 'GOV-WILD-001')).toBe(true);
  });

  it('GOV-WILD-001 — allowedSystems wildcard inside JSON config fails', async () => {
    const rel = await writeFixture(
      tmp,
      'config/seed.json',
      JSON.stringify({ allowedSystems: ['*'] }, null, 2)
    );
    const res = await runScan({ repoRoot: tmp.root, scanPaths: [rel] });
    expect(hasRule(res.violations, 'GOV-WILD-001')).toBe(true);
  });

  it('GOV-WILD-001 — same wildcard inside a YAML config fails', async () => {
    const rel = await writeFixture(tmp, 'config/seed.yaml', `allowedCapabilities:\n  - ${W}\n`);
    const res = await runScan({ repoRoot: tmp.root, scanPaths: [rel] });
    expect(hasRule(res.violations, 'GOV-WILD-001')).toBe(true);
  });

  it('GOV-WILD-002 — godMode identifier fails', async () => {
    const rel = await writeFixture(tmp, 'packages/foo/src/x.ts', SNIP_DANGEROUS_ID + '\n');
    const res = await runScan({ repoRoot: tmp.root, scanPaths: [rel] });
    expect(hasRule(res.violations, 'GOV-WILD-002')).toBe(true);
  });

  it('GOV-WILD-002 — allowAny / bypassGovernance / failOpen all fail', async () => {
    const rel = await writeFixture(
      tmp,
      'packages/foo/src/x.ts',
      [
        'function allowAny() { return true; }',
        'function bypassGovernance() { return true; }',
        'const failOpen = true;',
        '',
      ].join('\n')
    );
    const res = await runScan({ repoRoot: tmp.root, scanPaths: [rel] });
    const ids = res.violations.filter(v => v.ruleId === 'GOV-WILD-002');
    expect(ids.length).toBeGreaterThanOrEqual(3);
  });

  it('GOV-WILD-003 — `if (!policy) return true` fails', async () => {
    const rel = await writeFixture(tmp, 'packages/foo/src/x.ts', SNIP_NULL_AS_ALLOW + '\n');
    const res = await runScan({ repoRoot: tmp.root, scanPaths: [rel] });
    expect(hasRule(res.violations, 'GOV-WILD-003')).toBe(true);
  });

  it("GOV-WILD-003 — `?? ['*']` fallback to wildcard fails", async () => {
    const rel = await writeFixture(tmp, 'packages/foo/src/x.ts', SNIP_NULLISH_TO_WILD + '\n');
    const res = await runScan({ repoRoot: tmp.root, scanPaths: [rel] });
    expect(hasRule(res.violations, 'GOV-WILD-003')).toBe(true);
  });

  it('GOV-WILD-004 — `catch { return true; }` fails', async () => {
    const rel = await writeFixture(tmp, 'packages/foo/src/x.ts', SNIP_CATCH_RETURN_TRUE + '\n');
    const res = await runScan({ repoRoot: tmp.root, scanPaths: [rel] });
    expect(hasRule(res.violations, 'GOV-WILD-004')).toBe(true);
  });

  it('GOV-WILD-005 — `defaultDecision: "allow"` fails', async () => {
    const rel = await writeFixture(tmp, 'packages/foo/src/x.ts', SNIP_DEFAULT_ALLOW + '\n');
    const res = await runScan({ repoRoot: tmp.root, scanPaths: [rel] });
    expect(hasRule(res.violations, 'GOV-WILD-005')).toBe(true);
  });
});

describe('GOV-AUTHORITY-STRICTNESS-GATE — legitimate patterns must NOT trigger', () => {
  let tmp: Tmp;
  beforeEach(async () => {
    tmp = await makeTmp();
  });
  afterEach(async () => {
    await cleanup(tmp);
  });

  it('`import * as fs` does not fail', async () => {
    const rel = await writeFixture(tmp, 'packages/foo/src/x.ts', SNIP_IMPORT_STAR + '\n');
    const res = await runScan({ repoRoot: tmp.root, scanPaths: [rel] });
    expect(res.violations).toHaveLength(0);
  });

  it('multiplication does not fail', async () => {
    const rel = await writeFixture(tmp, 'packages/foo/src/x.ts', SNIP_MULTIPLY + '\n');
    const res = await runScan({ repoRoot: tmp.root, scanPaths: [rel] });
    expect(res.violations).toHaveLength(0);
  });

  it('SQL SELECT * inside a string literal does not fail', async () => {
    const rel = await writeFixture(tmp, 'packages/foo/src/x.ts', SNIP_SQL_SELECT_STAR + '\n');
    const res = await runScan({ repoRoot: tmp.root, scanPaths: [rel] });
    expect(res.violations).toHaveLength(0);
  });

  it('markdown bullet `*` inside a .md file is out of scope (gate excludes docs)', async () => {
    const rel = await writeFixture(tmp, 'docs/notes.md', '* bullet point\n* another\n');
    const res = await runScan({ repoRoot: tmp.root, scanPaths: [rel] });
    expect(res.violations).toHaveLength(0);
  });

  it('non-authority object with `*` value (e.g. wildcard query param) does not fail JSON scanner', async () => {
    // 'foo' is NOT in the authority field list — JSON walker should not flag.
    const rel = await writeFixture(
      tmp,
      'config/sample.json',
      JSON.stringify({ foo: ['*'], bar: { foo: '*' } })
    );
    const res = await runScan({ repoRoot: tmp.root, scanPaths: [rel] });
    expect(res.violations).toHaveLength(0);
  });
});

describe('GOV-AUTHORITY-STRICTNESS-GATE — allowlist behavior', () => {
  let tmp: Tmp;
  beforeEach(async () => {
    tmp = await makeTmp();
  });
  afterEach(async () => {
    await cleanup(tmp);
  });

  it('allowlist exact match suppresses one specific violation', async () => {
    const rel = await writeFixture(
      tmp,
      'packages/foo/src/seed.ts',
      `export const cfg = { ${SNIP_ALLOWED_SYSTEMS_WILD} };\n`
    );
    const entry: AllowlistEntry = {
      ruleId: 'GOV-WILD-001',
      file: rel,
      exactMatch: SNIP_ALLOWED_SYSTEMS_WILD,
      reason: 'test fixture',
      owner: 'gate-tests',
      expiresAt: '2099-12-31',
    };
    const res = await runScan({
      repoRoot: tmp.root,
      scanPaths: [rel],
      allowlist: { entries: [entry] },
    });
    expect(res.violations).toHaveLength(0);
    expect(res.allowlisted.length).toBeGreaterThan(0);
  });

  it('allowlist with broad/wildcard file path is rejected at validation', () => {
    const broad = validateAllowlist({
      entries: [
        {
          ruleId: 'GOV-WILD-001',
          file: 'packages/*/src/foo.ts',
          exactMatch: SNIP_ALLOWED_SYSTEMS_WILD,
          reason: 'r',
          owner: 'o',
          expiresAt: '2099-12-31',
        },
      ],
    });
    expect(broad.errors.length).toBeGreaterThan(0);
    expect(broad.errors[0]!.reason).toMatch(/file glob disallowed/);
  });

  it('allowlist with relative-traversal file path is rejected', () => {
    const trav = validateAllowlist({
      entries: [
        {
          ruleId: 'GOV-WILD-001',
          file: '../etc/passwd',
          exactMatch: SNIP_ALLOWED_SYSTEMS_WILD,
          reason: 'r',
          owner: 'o',
          expiresAt: '2099-12-31',
        },
      ],
    });
    expect(trav.errors.length).toBeGreaterThan(0);
  });

  it('allowlist entry missing both expiresAt and reviewBy is rejected', () => {
    const noexp = validateAllowlist({
      entries: [
        {
          ruleId: 'GOV-WILD-001',
          file: 'packages/foo/src/seed.ts',
          exactMatch: SNIP_ALLOWED_SYSTEMS_WILD,
          reason: 'r',
          owner: 'o',
        },
      ],
    });
    expect(noexp.errors.length).toBeGreaterThan(0);
    expect(noexp.errors[0]!.reason).toMatch(/expiresAt or reviewBy/);
  });

  it('allowlist entry with unknown ruleId is rejected', () => {
    const unk = validateAllowlist({
      entries: [
        {
          ruleId: 'GOV-WILD-999',
          file: 'a.ts',
          exactMatch: 'xxx',
          reason: 'r',
          owner: 'o',
          expiresAt: '2099-12-31',
        },
      ],
    });
    expect(unk.errors.length).toBeGreaterThan(0);
  });

  it('allowlist entry whose exactMatch is itself a wildcard is rejected', () => {
    const wc = validateAllowlist({
      entries: [
        {
          ruleId: 'GOV-WILD-001',
          file: 'a.ts',
          exactMatch: '*',
          reason: 'r',
          owner: 'o',
          expiresAt: '2099-12-31',
        },
      ],
    });
    expect(wc.errors.length).toBeGreaterThan(0);
  });

  it('rule id set is exactly the five documented ids', () => {
    expect([...RULE_IDS].sort()).toEqual([
      'GOV-WILD-001',
      'GOV-WILD-002',
      'GOV-WILD-003',
      'GOV-WILD-004',
      'GOV-WILD-005',
    ]);
  });
});

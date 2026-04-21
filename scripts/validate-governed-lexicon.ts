/**
 * validate-governed-lexicon.ts — Amendment J-S1
 *
 * Spec: nexus-engineering-spec-v1-8-26.md §37.14–37.18
 * Blueprint: nexus-blueprint-v1-5-13.md §34
 *
 * Validates the governed lexical fixture against all five lexical
 * validation gates. This is the offline validator — the same checks
 * are also enforced by ci:gate Step 16.
 *
 * Usage:
 *   pnpm exec tsx scripts/validate-governed-lexicon.ts
 *
 * Gates checked:
 *   §37.14 — Governed Lexical Fixture Existence Gate
 *   §37.15 — Approved Alias Uniqueness Gate
 *   §37.16 — Hard-Separation Integrity Gate
 *   §37.17 — Canonical Verb Membership Gate
 *   §37.18 — Runtime Bundle Exclusion Gate
 */
import { promises as fs } from 'fs';
import { resolve, dirname } from 'path';

// Resolved at runtime — scripts always run from repo root via pnpm
// (no __dirname needed)
const ROOT = process.cwd();

// ─── Canonical verb set (§12.2) — duplicated to avoid importing from packages ───
const CANONICAL_VERBS: readonly string[] = [
  'read',
  'write',
  'create',
  'update',
  'delete',
  'execute',
  'query',
  'search',
  'publish',
  'export',
  'send',
  'synthesize',
  'transmit',
] as const;

// ─── Minimal type for validation (mirrors §12.5) ───
interface GovernedVerbLexicon {
  lexiconVersion: string;
  canonicalVerbTaxonomyVersion: string;
  wordnetSourceVersion: string;
  generatedAt: string;
  approved: Record<string, string>;
  forbidden: Record<string, string[]>;
  hardSeparated: Record<string, string[]>;
  reviewRequired: string[];
}

let failures = 0;
let passes = 0;

function pass(gate: string, detail: string): void {
  passes++;
  console.log(`  ✓ ${gate}: ${detail}`);
}

function fail(gate: string, detail: string): void {
  failures++;
  console.error(`  ✗ ${gate}: ${detail}`);
}

async function main(): Promise<void> {
  console.log('validate-governed-lexicon.ts — Amendment J-S1');
  console.log('──────────────────────────────────────────────');

  // ─── §37.14 — Governed Lexical Fixture Existence Gate ───
  console.log('\n§37.14 — Governed Lexical Fixture Existence Gate');
  const lexiconPath = resolve(ROOT, 'fixtures/lexicon/governed-verb-lexicon.v1.json');
  let lexicon: GovernedVerbLexicon;
  try {
    const raw = await fs.readFile(lexiconPath, 'utf-8');
    lexicon = JSON.parse(raw) as GovernedVerbLexicon;
  } catch (err) {
    fail('§37.14', `File missing or unparseable: ${(err as Error).message}`);
    console.error(`\n✗ VALIDATION FAILED — ${failures} failure(s)`);
    process.exit(1);
  }

  // Validate shape
  const requiredKeys = [
    'lexiconVersion',
    'canonicalVerbTaxonomyVersion',
    'wordnetSourceVersion',
    'generatedAt',
    'approved',
    'forbidden',
    'hardSeparated',
    'reviewRequired',
  ];
  const missingKeys = requiredKeys.filter(k => !(k in lexicon));
  if (missingKeys.length > 0) {
    fail('§37.14', `Missing required keys: ${missingKeys.join(', ')}`);
  } else if (typeof lexicon.approved !== 'object' || Array.isArray(lexicon.approved)) {
    fail('§37.14', 'approved must be a Record<string, string>');
  } else if (!Array.isArray(lexicon.reviewRequired)) {
    fail('§37.14', 'reviewRequired must be a string[]');
  } else {
    pass(
      '§37.14',
      `Fixture exists and parses — ${Object.keys(lexicon.approved).length} approved aliases`
    );
  }

  // ─── §37.15 — Approved Alias Uniqueness Gate ───
  console.log('\n§37.15 — Approved Alias Uniqueness Gate');
  const aliasToVerb = new Map<string, string>();
  let duplicates = 0;
  for (const [rawTerm, canonicalVerb] of Object.entries(lexicon.approved)) {
    const existing = aliasToVerb.get(rawTerm);
    if (existing !== undefined && existing !== canonicalVerb) {
      fail(
        '§37.15',
        `Duplicate alias: '${rawTerm}' maps to both '${existing}' and '${canonicalVerb}'`
      );
      duplicates++;
    }
    aliasToVerb.set(rawTerm, canonicalVerb);
  }
  if (duplicates === 0) {
    pass('§37.15', 'No duplicate alias mappings');
  }

  // ─── §37.16 — Hard-Separation Integrity Gate ───
  console.log('\n§37.16 — Hard-Separation Integrity Gate');
  let overlaps = 0;
  const allHardSeparated = new Set<string>();
  for (const terms of Object.values(lexicon.hardSeparated)) {
    for (const term of terms) {
      allHardSeparated.add(term);
    }
  }
  for (const term of allHardSeparated) {
    if (term in lexicon.approved) {
      fail('§37.16', `Hard-separated term '${term}' also appears in approved set`);
      overlaps++;
    }
  }
  if (overlaps === 0) {
    pass('§37.16', 'No overlap between hardSeparated and approved sets');
  }

  // ─── §37.17 — Canonical Verb Membership Gate ───
  console.log('\n§37.17 — Canonical Verb Membership Gate');
  let unknownVerbs = 0;
  const approvedVerbs = new Set(Object.values(lexicon.approved));
  for (const verb of approvedVerbs) {
    if (!CANONICAL_VERBS.includes(verb)) {
      fail('§37.17', `Approved alias maps to unknown canonical verb: '${verb}'`);
      unknownVerbs++;
    }
  }
  // Also check forbidden and hardSeparated keys
  for (const verb of Object.keys(lexicon.forbidden)) {
    if (verb !== '_forbidden' && !CANONICAL_VERBS.includes(verb)) {
      fail('§37.17', `Forbidden map references unknown canonical verb: '${verb}'`);
      unknownVerbs++;
    }
  }
  for (const verb of Object.keys(lexicon.hardSeparated)) {
    if (!CANONICAL_VERBS.includes(verb)) {
      fail('§37.17', `Hard-separated map references unknown canonical verb: '${verb}'`);
      unknownVerbs++;
    }
  }
  if (unknownVerbs === 0) {
    pass('§37.17', 'All referenced canonical verbs exist in ACTION_VERB set');
  }

  // ─── §37.18 — Runtime Bundle Exclusion Gate ───
  console.log('\n§37.18 — Runtime Bundle Exclusion Gate');
  const candidatesPath = resolve(ROOT, 'fixtures/lexicon/wordnet-candidate-aliases.v1.json');
  // Check common production output directories
  const prodPaths = [
    resolve(ROOT, 'dist'),
    resolve(ROOT, 'packages/core/dist'),
    resolve(ROOT, 'packages/contracts/dist'),
  ];
  let candidateInProd = false;
  for (const prodDir of prodPaths) {
    try {
      await fs.access(resolve(prodDir, 'wordnet-candidate-aliases.v1.json'));
      fail('§37.18', `wordnet-candidate-aliases.v1.json found in production output: ${prodDir}`);
      candidateInProd = true;
    } catch {
      // Expected — file should NOT be in production output
    }
  }
  // Also check if the file exists at all (it should, as a build artifact)
  try {
    await fs.access(candidatesPath);
    // File exists in fixtures — this is fine, it's build-time only
  } catch {
    console.log(
      '  NOTE: wordnet-candidate-aliases.v1.json not found in fixtures/ — ' +
        'run lexicon:build to generate it'
    );
  }
  if (!candidateInProd) {
    pass('§37.18', 'wordnet-candidate-aliases.v1.json absent from production output');
  }

  // ─── Summary ───
  console.log('\n──────────────────────────────────────────────');
  if (failures === 0) {
    console.log(`✓ All ${passes} lexical validation gates passed.`);
    process.exit(0);
  } else {
    console.error(`✗ ${failures} failure(s), ${passes} pass(es).`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('validate-governed-lexicon.ts fatal:', (err as Error).message);
  process.exit(1);
});

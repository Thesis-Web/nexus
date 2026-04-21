/**
 * build-wordnet-lexicon.ts — Amendment J-S1
 *
 * Spec: nexus-engineering-spec-v1-8-26.md §12.5, §40 step 9a
 * Blueprint: nexus-blueprint-v1-5-13.md §34
 *
 * Build-time WordNet integration. Reads pinned WordNet source data,
 * extracts verb relationships, applies governance overrides and hard
 * separations, outputs two fixture files:
 *
 *   1. fixtures/lexicon/wordnet-candidate-aliases.v1.json  (build-time only)
 *   2. fixtures/lexicon/governed-verb-lexicon.v1.json       (runtime authority)
 *
 * Runtime NEVER calls WordNet. Only the governed lexical fixture is used.
 *
 * Usage:
 *   pnpm exec tsx scripts/build-wordnet-lexicon.ts
 *
 * Requires devDependencies: wndb-with-samples, yaml
 */
import { promises as fs } from 'fs';
import { createReadStream } from 'fs';
import { resolve, dirname } from 'path';
import { createInterface } from 'readline';

// ─── Resolve project root ───
// Resolved at runtime — scripts always run from repo root via pnpm
// (no __dirname needed)
const ROOT = process.cwd();

// ─── Types (mirrored from contracts — build script does not import from packages) ───
interface LexicalAliasCandidate {
  rawTerm: string;
  candidateCanonicalVerb: string;
  source: 'wordnet';
  relation: 'synonym' | 'troponym' | 'hypernym' | 'derivational' | 'related';
  confidenceClass: 'direct' | 'near' | 'ambiguous';
  sourceVersion: string;
}

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

interface GovernanceOverrides {
  version: string;
  approved: Record<string, string>;
  forbidden: Record<string, string>;
}

interface HardSeparationConfig {
  version: string;
  separations: [string, string][];
}

// ─── Canonical verb set (§12.2) — duplicated here to avoid importing from packages ───
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

const WORDNET_VERSION = '3.0';

// ─── WordNet parsing ───

interface WordNetSynset {
  offset: number;
  words: string[];
  pointers: WordNetPointer[];
  gloss: string;
}

interface WordNetPointer {
  symbol: string;
  targetOffset: number;
  pos: string;
  sourceTarget: string;
}

async function readLines(filepath: string): Promise<string[]> {
  const lines: string[] = [];
  const stream = createReadStream(filepath, 'utf-8');
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    // Skip comment lines (start with spaces in WordNet format)
    if (!line.startsWith(' ') && line.trim().length > 0) {
      lines.push(line);
    }
  }
  return lines;
}

function parseDataVerbLine(line: string): WordNetSynset | null {
  // Format: offset lex_filenum ss_type w_cnt word lex_id [...] p_cnt [ptr...] | gloss
  const glossSplit = line.split(' | ');
  const gloss = glossSplit.length > 1 ? glossSplit.slice(1).join(' | ').trim() : '';
  const dataPart = (glossSplit[0] ?? '').trim();
  const tokens = dataPart.split(/\s+/);

  if (tokens.length < 4) return null;

  const offset = parseInt(tokens[0] ?? '0', 10);
  // tokens[1] = lex_filenum, tokens[2] = ss_type
  const ssType = tokens[2];
  if (ssType !== 'v') return null; // only verbs

  const wCnt = parseInt(tokens[3] ?? '0', 16); // hex
  const words: string[] = [];
  let idx = 4;
  for (let i = 0; i < wCnt; i++) {
    const word = tokens[idx];
    if (word !== undefined) {
      words.push(word.toLowerCase().replace(/_/g, ' '));
    }
    idx += 2; // skip lex_id
  }

  const pCnt = parseInt(tokens[idx] ?? '0', 10);
  idx++;
  const pointers: WordNetPointer[] = [];
  for (let i = 0; i < pCnt; i++) {
    const sym = tokens[idx] ?? '';
    const tOff = parseInt(tokens[idx + 1] ?? '0', 10);
    const pos = tokens[idx + 2] ?? '';
    const st = tokens[idx + 3] ?? '';
    pointers.push({ symbol: sym, targetOffset: tOff, pos, sourceTarget: st });
    idx += 4;
  }

  return { offset, words, pointers, gloss };
}

function parseIndexVerbLine(line: string): { lemma: string; offsets: number[] } | null {
  const tokens = line.trim().split(/\s+/);
  if (tokens.length < 4) return null;
  const lemma = (tokens[0] ?? '').toLowerCase().replace(/_/g, ' ');
  const pos = tokens[1];
  if (pos !== 'v') return null;

  const synsetCnt = parseInt(tokens[2] ?? '0', 10);
  const pCnt = parseInt(tokens[3] ?? '0', 10);
  // Skip pointer symbols + sense_cnt + tagsense_cnt
  const offsetStart = 4 + pCnt + 2;
  const offsets: number[] = [];
  for (let i = 0; i < synsetCnt; i++) {
    const val = tokens[offsetStart + i];
    if (val !== undefined) {
      offsets.push(parseInt(val, 10));
    }
  }
  return { lemma, offsets };
}

function classifyRelation(
  pointerSymbol: string
): 'synonym' | 'troponym' | 'hypernym' | 'derivational' | 'related' {
  switch (pointerSymbol) {
    case '~':
      return 'troponym';
    case '@':
      return 'hypernym';
    case '+':
      return 'derivational';
    case '$':
    case '^':
    case '>':
    case '*':
      return 'related';
    default:
      return 'related';
  }
}

// ─── YAML parsing (minimal — avoids dependency) ───
// Handles the simple flat/list YAML structures used by governance configs.

function parseSimpleYaml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentSection: string | null = null;
  let currentMap: Record<string, string> | null = null;
  let currentList: unknown[] | null = null;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/#.*$/, '').trimEnd();
    if (line.trim() === '' || line.trim().startsWith('#')) continue;

    // Top-level key
    const topMatch = /^([a-zA-Z_]+):\s*(.*)$/.exec(line);
    if (topMatch) {
      const key = topMatch[1] ?? '';
      const value = (topMatch[2] ?? '').trim();

      if (currentSection && currentMap) {
        result[currentSection] = currentMap;
      } else if (currentSection && currentList) {
        result[currentSection] = currentList;
      }

      if (value) {
        result[key] = value.replace(/^['"]|['"]$/g, '');
        currentSection = null;
        currentMap = null;
        currentList = null;
      } else {
        currentSection = key;
        currentMap = null;
        currentList = null;
      }
      continue;
    }

    // Indented key: value (map entry)
    const mapMatch = /^\s+([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.+)$/.exec(line);
    if (mapMatch && currentSection) {
      if (!currentMap) currentMap = {};
      const val = (mapMatch[2] ?? '').trim().replace(/^['"]|['"]$/g, '');
      currentMap[mapMatch[1] ?? ''] = val;
      continue;
    }

    // Indented list item: - value or - [a, b]
    const listMatch = /^\s+-\s+(.+)$/.exec(line);
    if (listMatch && currentSection) {
      if (!currentList) currentList = [];
      const val = (listMatch[1] ?? '').trim();
      // Check for inline array [a, b]
      const arrMatch = /^\[(.+)]$/.exec(val);
      if (arrMatch) {
        currentList.push(
          (arrMatch[1] ?? '').split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''))
        );
      } else {
        currentList.push(val.replace(/^['"]|['"]$/g, ''));
      }
      continue;
    }
  }

  // Flush last section
  if (currentSection && currentMap) {
    result[currentSection] = currentMap;
  } else if (currentSection && currentList) {
    result[currentSection] = currentList;
  }

  return result;
}

// ─── Main build pipeline ───

async function loadGovernanceOverrides(): Promise<GovernanceOverrides> {
  const filepath = resolve(ROOT, 'config/lexicon/governed-verb-overrides.v1.yaml');
  const raw = await fs.readFile(filepath, 'utf-8');
  const parsed = parseSimpleYaml(raw);
  return {
    version: String(parsed['version'] ?? 'v1'),
    approved: (parsed['approved'] as Record<string, string>) ?? {},
    forbidden: (parsed['forbidden'] as Record<string, string>) ?? {},
  };
}

async function loadHardSeparations(): Promise<HardSeparationConfig> {
  const filepath = resolve(ROOT, 'config/lexicon/governed-verb-hard-separations.v1.yaml');
  const raw = await fs.readFile(filepath, 'utf-8');
  const parsed = parseSimpleYaml(raw);
  const rawSeps = (parsed['separations'] as unknown[]) ?? [];
  const separations: [string, string][] = rawSeps
    .filter((s): s is string[] => Array.isArray(s) && s.length === 2)
    .map(s => [s[0] ?? '', s[1] ?? '']);
  return {
    version: String(parsed['version'] ?? 'v1'),
    separations,
  };
}

function resolveWndbPath(): string {
  try {
    // wndb-with-samples exports a path property
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const wndb = require('wndb-with-samples') as { path: string };
    return wndb.path;
  } catch {
    // Fallback: try common locations
    const fallback = resolve(ROOT, 'node_modules/wndb-with-samples/dict');
    try {
      require('fs').accessSync(fallback);
      return fallback;
    } catch {
      console.error(
        'ERROR: wndb-with-samples not found.\n' +
          'Install it: pnpm add -D wndb-with-samples\n' +
          'This is a build-time dependency only — not needed at runtime.'
      );
      process.exit(1);
    }
  }
}

async function extractWordNetCandidates(wndbPath: string): Promise<LexicalAliasCandidate[]> {
  console.log(`  Reading WordNet verb data from: ${wndbPath}`);

  // Parse data.verb to build synset map
  const dataLines = await readLines(resolve(wndbPath, 'data.verb'));
  const synsetMap = new Map<number, WordNetSynset>();
  for (const line of dataLines) {
    const synset = parseDataVerbLine(line);
    if (synset) synsetMap.set(synset.offset, synset);
  }
  console.log(`  Parsed ${synsetMap.size} verb synsets`);

  // Parse index.verb to map lemmas to synsets
  const indexLines = await readLines(resolve(wndbPath, 'index.verb'));
  const lemmaIndex = new Map<string, number[]>();
  for (const line of indexLines) {
    const entry = parseIndexVerbLine(line);
    if (entry) lemmaIndex.set(entry.lemma, entry.offsets);
  }
  console.log(`  Indexed ${lemmaIndex.size} verb lemmas`);

  const candidates: LexicalAliasCandidate[] = [];
  const seen = new Set<string>();

  for (const canonicalVerb of CANONICAL_VERBS) {
    const offsets = lemmaIndex.get(canonicalVerb);
    if (!offsets) {
      console.log(`  WARNING: canonical verb '${canonicalVerb}' not found in WordNet index`);
      continue;
    }

    // Collect words from same synsets (synonyms)
    for (const offset of offsets) {
      const synset = synsetMap.get(offset);
      if (!synset) continue;

      for (const word of synset.words) {
        if (word === canonicalVerb) continue;
        const key = `${word}:${canonicalVerb}:synonym`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({
          rawTerm: word,
          candidateCanonicalVerb: canonicalVerb,
          source: 'wordnet',
          relation: 'synonym',
          confidenceClass: 'direct',
          sourceVersion: WORDNET_VERSION,
        });
      }

      // Follow pointers for troponyms, hypernyms, derivational forms
      for (const ptr of synset.pointers) {
        if (!['~', '@', '+', '$'].includes(ptr.symbol)) continue;
        if (ptr.pos !== 'v' && ptr.pos !== '') continue;

        const targetSynset = synsetMap.get(ptr.targetOffset);
        if (!targetSynset) continue;

        const relation = classifyRelation(ptr.symbol);
        const confidence = ptr.symbol === '~' || ptr.symbol === '@' ? 'near' : 'ambiguous';

        for (const word of targetSynset.words) {
          if (word === canonicalVerb) continue;
          if (CANONICAL_VERBS.includes(word)) continue; // don't alias one canonical verb to another
          const key = `${word}:${canonicalVerb}:${relation}`;
          if (seen.has(key)) continue;
          seen.add(key);
          candidates.push({
            rawTerm: word,
            candidateCanonicalVerb: canonicalVerb,
            source: 'wordnet',
            relation,
            confidenceClass: confidence,
            sourceVersion: WORDNET_VERSION,
          });
        }
      }
    }
  }

  console.log(`  Extracted ${candidates.length} candidate aliases`);
  return candidates;
}

function buildGovernedLexicon(
  candidates: LexicalAliasCandidate[],
  overrides: GovernanceOverrides,
  hardSeps: HardSeparationConfig
): GovernedVerbLexicon {
  // Build hard separation sets: for each canonical verb, which other
  // canonical verbs are hard-separated from it
  const hardSepPairs = new Set<string>();
  for (const [a, b] of hardSeps.separations) {
    hardSepPairs.add(`${a}:${b}`);
    hardSepPairs.add(`${b}:${a}`);
  }

  // Track which raw terms map to multiple canonical verbs
  const termToVerbs = new Map<string, Set<string>>();
  for (const c of candidates) {
    const existing = termToVerbs.get(c.rawTerm) ?? new Set<string>();
    existing.add(c.candidateCanonicalVerb);
    termToVerbs.set(c.rawTerm, existing);
  }

  const approved: Record<string, string> = {};
  const forbidden: Record<string, string[]> = {};
  const hardSeparated: Record<string, string[]> = {};
  const reviewRequired: string[] = [];
  const reviewSet = new Set<string>();

  // 1. Apply governance overrides first — these are authoritative
  for (const [rawTerm, canonicalVerb] of Object.entries(overrides.approved)) {
    if (!CANONICAL_VERBS.includes(canonicalVerb)) {
      console.log(
        `  WARNING: override maps '${rawTerm}' to unknown verb '${canonicalVerb}' — skipping`
      );
      continue;
    }
    approved[rawTerm] = canonicalVerb;
  }

  // 2. Apply forbidden overrides
  for (const [rawTerm, reason] of Object.entries(overrides.forbidden)) {
    const verb = '_forbidden';
    const existing = forbidden[verb] ?? [];
    existing.push(rawTerm);
    forbidden[verb] = existing;
  }

  // 3. Process WordNet candidates with hard separation enforcement
  for (const candidate of candidates) {
    const { rawTerm, candidateCanonicalVerb } = candidate;

    // Skip if already approved by governance override
    if (rawTerm in approved) continue;

    // Check if this raw term is a canonical verb that is hard-separated
    // from the candidate mapping
    const verbs = termToVerbs.get(rawTerm);
    if (verbs && verbs.size > 1) {
      // Multiple canonical verbs claim this term — check hard separations
      let isHardSep = false;
      for (const v of verbs) {
        if (v !== candidateCanonicalVerb && hardSepPairs.has(`${v}:${candidateCanonicalVerb}`)) {
          isHardSep = true;
          break;
        }
      }

      if (isHardSep) {
        // Term is ambiguous across hard-separated verbs → review_required
        if (!reviewSet.has(rawTerm)) {
          reviewSet.add(rawTerm);
          reviewRequired.push(rawTerm);
        }
        // Also record in hardSeparated map
        const existing = hardSeparated[candidateCanonicalVerb] ?? [];
        if (!existing.includes(rawTerm)) {
          existing.push(rawTerm);
          hardSeparated[candidateCanonicalVerb] = existing;
        }
        continue;
      }
    }

    // Check if the term itself is forbidden
    const allForbidden = Object.values(forbidden).flat();
    if (allForbidden.includes(rawTerm)) continue;

    // Approve if confidence is direct and no conflicts
    if (candidate.confidenceClass === 'direct' && !(rawTerm in approved)) {
      approved[rawTerm] = candidateCanonicalVerb;
    } else if (candidate.confidenceClass === 'ambiguous') {
      if (!reviewSet.has(rawTerm)) {
        reviewSet.add(rawTerm);
        reviewRequired.push(rawTerm);
      }
    }
    // 'near' confidence with no conflicts — approve
    else if (candidate.confidenceClass === 'near' && !(rawTerm in approved)) {
      approved[rawTerm] = candidateCanonicalVerb;
    }
  }

  // 4. Enforce hard separations: ensure no canonical verb is in another's approved set
  for (const [a, b] of hardSeps.separations) {
    // Ensure 'a' is not approved as alias for 'b'
    if (approved[a] === b) {
      delete approved[a];
      const existing = hardSeparated[b] ?? [];
      if (!existing.includes(a)) {
        existing.push(a);
        hardSeparated[b] = existing;
      }
    }
    // Ensure 'b' is not approved as alias for 'a'
    if (approved[b] === a) {
      delete approved[b];
      const existing = hardSeparated[a] ?? [];
      if (!existing.includes(b)) {
        existing.push(b);
        hardSeparated[a] = existing;
      }
    }
  }

  return {
    lexiconVersion: 'v1',
    canonicalVerbTaxonomyVersion: 'v1.0.0',
    wordnetSourceVersion: WORDNET_VERSION,
    generatedAt: new Date().toISOString(),
    approved,
    forbidden,
    hardSeparated,
    reviewRequired,
  };
}

async function main(): Promise<void> {
  console.log('build-wordnet-lexicon.ts — Amendment J-S1');
  console.log('─────────────────────────────────────────');

  // 1. Load governance configs
  console.log('\n[1/5] Loading governance overrides...');
  const overrides = await loadGovernanceOverrides();
  console.log(`  ${Object.keys(overrides.approved).length} approved overrides`);
  console.log(`  ${Object.keys(overrides.forbidden).length} forbidden overrides`);

  console.log('\n[2/5] Loading hard separations...');
  const hardSeps = await loadHardSeparations();
  console.log(`  ${hardSeps.separations.length} hard separation pairs`);

  // 2. Extract WordNet candidates
  console.log('\n[3/5] Extracting WordNet verb candidates...');
  const wndbPath = resolveWndbPath();
  const candidates = await extractWordNetCandidates(wndbPath);

  // 3. Write candidate aliases (build-time only)
  const candidatesPath = resolve(ROOT, 'fixtures/lexicon/wordnet-candidate-aliases.v1.json');
  await fs.mkdir(dirname(candidatesPath), { recursive: true });
  await fs.writeFile(candidatesPath, JSON.stringify(candidates, null, 2) + '\n', 'utf-8');
  console.log(`\n[4/5] Wrote candidate aliases: ${candidatesPath}`);
  console.log(`  ${candidates.length} candidates`);

  // 4. Build governed lexicon
  console.log('\n[5/5] Building governed lexicon...');
  const lexicon = buildGovernedLexicon(candidates, overrides, hardSeps);

  const lexiconPath = resolve(ROOT, 'fixtures/lexicon/governed-verb-lexicon.v1.json');
  await fs.writeFile(lexiconPath, JSON.stringify(lexicon, null, 2) + '\n', 'utf-8');
  console.log(`  Wrote governed lexicon: ${lexiconPath}`);
  console.log(`  ${Object.keys(lexicon.approved).length} approved aliases`);
  console.log(`  ${Object.values(lexicon.forbidden).flat().length} forbidden terms`);
  console.log(`  ${Object.values(lexicon.hardSeparated).flat().length} hard-separated terms`);
  console.log(`  ${lexicon.reviewRequired.length} review-required terms`);

  console.log('\n✓ Lexicon build complete.');
  console.log('  Run "pnpm lexicon:validate" to verify fixture integrity.');
}

main().catch(err => {
  console.error('build-wordnet-lexicon.ts fatal:', (err as Error).message);
  process.exit(1);
});

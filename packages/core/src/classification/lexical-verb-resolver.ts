/**
 * Lexical Verb Resolver — Amendment J-S1
 *
 * Spec: nexus-engineering-spec-v1-8-26.md §13.3.1
 * Blueprint: nexus-blueprint-v1-5-13.md §34
 *
 * Loads only the governed lexical fixture at startup.
 * Does NOT accept WordNet source file paths.
 * Does NOT call WordNet at runtime.
 *
 * Resolution order (§13.3.1):
 *   1. Exact governed verb match — raw verb IS a canonical ACTION_VERB
 *   2. Exact approved alias match — raw verb in governed lexical fixture
 *   3. Tool/endpoint deterministic override — explicit tool→verb mapping
 *   4. Hard-separated or forbidden — emit null (unresolvable)
 *   5. Unresolved — emit null (never guess)
 *
 * Hard separation law (§13.3.1, blueprint §34.3):
 *   - search vs read
 *   - query vs execute
 *   - send vs publish
 *   - publish vs transmit
 *   These are NEVER collapsed by the resolver.
 */
import { ACTION_VERB, type ActionVerb, type GovernedVerbLexicon } from '../types/index.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ─── Governed verb set for exact match (step 1) ───
const CANONICAL_VERB_SET = new Set<string>(Object.values(ACTION_VERB));

export class LexicalVerbResolver {
  private readonly approved: ReadonlyMap<string, string>;
  private readonly forbidden: ReadonlySet<string>;
  private readonly hardSeparated: ReadonlySet<string>;

  constructor(lexicon: GovernedVerbLexicon) {
    this.approved = new Map(Object.entries(lexicon.approved));

    // Flatten forbidden terms from all verb categories
    const forbiddenTerms = new Set<string>();
    for (const terms of Object.values(lexicon.forbidden)) {
      for (const term of terms) {
        forbiddenTerms.add(term);
      }
    }
    this.forbidden = forbiddenTerms;

    // Flatten hard-separated terms from all verb categories
    const hardSepTerms = new Set<string>();
    for (const terms of Object.values(lexicon.hardSeparated)) {
      for (const term of terms) {
        hardSepTerms.add(term);
      }
    }
    this.hardSeparated = hardSepTerms;
  }

  /**
   * Full five-step resolution (§13.3.1 steps 1, 2, 4, 5).
   * Step 3 (tool/endpoint override) is owned by VerbNormalizer.
   * Returns null if unresolvable — never throws on ambiguity, never guesses.
   */
  resolve(rawVerb: string): ActionVerb | null {
    const lower = rawVerb.toLowerCase().trim();

    // Step 1: Exact governed verb match
    if (CANONICAL_VERB_SET.has(lower)) {
      return lower as ActionVerb;
    }

    // Step 2: Exact approved alias match from governed lexical fixture
    const approved = this.approved.get(lower);
    if (approved !== undefined) {
      return approved as ActionVerb;
    }

    // Steps 4+5: hard-separated, forbidden, or unresolved → null
    return null;
  }

  /**
   * Steps 1 + 2 only — used by VerbNormalizer before trying the prefix map (step 3).
   */
  resolveApprovedOnly(rawVerb: string): ActionVerb | null {
    const lower = rawVerb.toLowerCase().trim();
    if (CANONICAL_VERB_SET.has(lower)) return lower as ActionVerb;
    const approved = this.approved.get(lower);
    return approved !== undefined ? (approved as ActionVerb) : null;
  }

  /**
   * Step 4 — returns true if the term is hard-separated or forbidden.
   * Used by VerbNormalizer to block resolution AFTER the prefix map (step 3).
   */
  isBlocked(rawVerb: string): boolean {
    const lower = rawVerb.toLowerCase().trim();
    return this.hardSeparated.has(lower) || this.forbidden.has(lower);
  }

  /**
   * Load the governed lexical fixture from the standard path.
   * Throws if the fixture file is missing or malformed.
   */
  static loadFromFixture(rootDir: string): LexicalVerbResolver {
    const fixturePath = resolve(rootDir, 'fixtures/lexicon/governed-verb-lexicon.v1.json');
    let raw: string;
    try {
      raw = readFileSync(fixturePath, 'utf-8');
    } catch {
      throw new Error(
        `Governed lexical fixture not found: ${fixturePath}\n` +
          `Run 'pnpm lexicon:build' to generate it.`
      );
    }
    const lexicon = JSON.parse(raw) as GovernedVerbLexicon;
    return new LexicalVerbResolver(lexicon);
  }
}

/**
 * Lexical Normalizer — subordinate lexical helper — Amendment J-S1
 *
 * Spec: nexus-engineering-spec-v1-8-26.md §28.2
 * Blueprint: nexus-blueprint-v1-5-13.md §34.6
 *
 * This module is a subordinate lexical helper used by the
 * Post-Inference Action Normalizer. It is NOT the Post-Inference
 * Action Normalizer and does not replace it.
 *
 * Performs lexical cleanup of raw verb strings from model output
 * by consulting only the governed lexical fixture. Gate 02 is the
 * authority on verb resolution.
 *
 * This module shall NOT:
 *   - assign policy outcome
 *   - assign risk tier
 *   - assign OCT ceiling
 *   - resolve identity-provider claims
 *   - collapse ambiguous verbs by guess
 *   - consult WordNet source files directly at runtime
 *
 * If it cannot deterministically resolve a raw verb, it returns
 * the raw verb unchanged. Gate 02 handles denial.
 */
import { type ActionVerb, type GovernedVerbLexicon } from '../types/index.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

export class LexicalNormalizer {
  private readonly approved: ReadonlyMap<string, string>;
  private readonly canonicalVerbs: ReadonlySet<string>;

  constructor(lexicon: GovernedVerbLexicon, canonicalVerbs: readonly string[]) {
    this.approved = new Map(Object.entries(lexicon.approved));
    this.canonicalVerbs = new Set(canonicalVerbs);
  }

  /**
   * Attempt lexical cleanup of a raw verb string from model output.
   *
   * Returns the canonical verb if deterministically resolvable.
   * Returns the raw verb unchanged if unresolvable — does not guess.
   * Gate 02 is the authority on verb resolution and will emit
   * UNRESOLVABLE_VERB if this normalizer's output is still unresolvable.
   */
  normalizeVerb(rawVerb: string): string {
    const lower = rawVerb.toLowerCase().trim();

    // Already a canonical verb — no cleanup needed
    if (this.canonicalVerbs.has(lower)) {
      return lower;
    }

    // Check governed approved aliases
    const approved = this.approved.get(lower);
    if (approved !== undefined) {
      return approved;
    }

    // Cannot deterministically resolve — return unchanged
    // Gate 02 handles the denial via UNRESOLVABLE_VERB
    return rawVerb;
  }

  /**
   * Load from the standard governed lexical fixture path.
   */
  static loadFromFixture(rootDir: string, canonicalVerbs: readonly string[]): LexicalNormalizer {
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
    return new LexicalNormalizer(lexicon, canonicalVerbs);
  }
}

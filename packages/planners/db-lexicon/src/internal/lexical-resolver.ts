// packages/planners/db-lexicon/src/internal/lexical-resolver.ts
// AMEND-nexus-planner-db-lexicon-v0-2-1.md §3.3.4 Layer B, log
// DIFF-PLANNER-LEXICON-003.
//
// The planner's OWN tokenizer + (verb, target, operand) resolver.
// NOT LexicalNormalizer — that's a Gate-02-subordinate single-verb
// canonicalizer with explicit scope constraints and cannot tokenize
// prompts. Widening it would violate /mem-export-path.
//
// V1 behavior:
//   - Lowercase normalization on input.
//   - Greedy longest-match against `planner_lexical_term.rawTerm` —
//     multi-word phrases preferred over single words.
//   - For each match, optionally apply `planner_alias_rule` to remap
//     the rawTerm → canonicalTerm (alias status tracked for trace).
//   - Three output streams by `phraseClass`:
//       'verb'            → ResolvedVerb       (canonicalVerb)
//       'noun'            → ResolvedTarget     (targetTerm)
//       'business_phrase' → ResolvedOperand    (operand)
//   - Stop words and punctuation are skipped silently.
//   - Anything that looks like a meaningful word but didn't match is
//     recorded under `unmatched` for trace / debugging.
//   - V2 feature: value-extraction templating (e.g. "product A" → value 'A')
//     is NOT in V1. Fixtures use literal phrases (rawTerm must match
//     exactly).

import type { NonEmpty } from '@nexus/contracts';
import { ACTION_VERB } from '@nexus/contracts';
import type {
  LexicalResolutionResult,
  LexiconTablesV1,
  PlannerAliasRule,
  PlannerLexicalTerm,
  ResolvedOperand,
  ResolvedTarget,
  ResolvedVerb,
} from './types.js';

// ─── Stop words ───
// Common English filler the resolver ignores between meaningful phrases.
// Intentionally small — V1 lexicon fixtures should carry the meaningful
// phrases; stop-word filtering is just to keep `unmatched` clean.

const STOP_WORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'to',
  'for',
  'of',
  'in',
  'on',
  'at',
  'by',
  'with',
  'from',
  'into',
  'onto',
  'this',
  'that',
  'these',
  'those',
  'it',
  'its',
]);

// Punctuation that splits tokens but contributes no semantic value.
// Periods, commas, semicolons, etc. are stripped during normalization.
const PUNCTUATION_RE = /[.,;:!?()\[\]{}"']/g;

const ACTION_VERB_SET: ReadonlySet<string> = new Set(Object.values(ACTION_VERB));

/**
 * Tokenize a prompt into lowercase whitespace-separated tokens with
 * punctuation removed.
 */
function tokenize(prompt: string): string[] {
  const cleaned = prompt.toLowerCase().replace(PUNCTUATION_RE, ' ');
  return cleaned.split(/\s+/).filter(t => t.length > 0);
}

/**
 * Build a lookup of `phrase` → max number of tokens. Used by the
 * greedy matcher to know how many tokens to consider at each position.
 * Considers BOTH lex-terms AND alias-rule rawTerms so blocked aliases
 * fire even when no lex-term matches the same phrase (defense in
 * depth — explicit prohibition).
 */
function buildMaxPhraseLength(tables: LexiconTablesV1): number {
  let max = 1;
  for (const term of tables.lexicalTerms) {
    const len = term.rawTerm.toLowerCase().split(/\s+/).length;
    if (len > max) max = len;
  }
  for (const rule of tables.aliasRules) {
    const len = rule.rawTerm.toLowerCase().split(/\s+/).length;
    if (len > max) max = len;
  }
  return max;
}

/**
 * Apply alias rule if one exists. Returns the canonical term to use
 * (rule's `canonicalTerm` for approved, original for missing or
 * review-required) plus the alias rule status for trace.
 *
 * Blocked aliases: returns `null` to signal "this term is forbidden".
 */
function applyAlias(
  rawTerm: string,
  matchedTerm: PlannerLexicalTerm,
  tables: LexiconTablesV1
): { canonicalTerm: string; aliasStatus: PlannerAliasRule['status'] | null } | null {
  const rule = tables.aliasByRaw.get(rawTerm.toLowerCase());
  if (!rule) {
    return { canonicalTerm: matchedTerm.canonicalTerm, aliasStatus: null };
  }
  if (rule.status === 'blocked') {
    return null;
  }
  // 'approved' or 'review_required' both pass through with status tracked
  return { canonicalTerm: rule.canonicalTerm, aliasStatus: rule.status };
}

/**
 * Resolve a prompt against the in-memory lexicon tables.
 *
 * Returns three distinct streams (verbs, targets, operands) plus any
 * unmatched tokens and a flag indicating whether any blocked alias was
 * encountered. The caller (Layer C) consumes the streams to build
 * intent candidates.
 */
export function resolveLexical(prompt: string, tables: LexiconTablesV1): LexicalResolutionResult {
  const tokens = tokenize(prompt);
  const maxPhraseLen = buildMaxPhraseLength(tables);

  const verbs: ResolvedVerb[] = [];
  const targets: ResolvedTarget[] = [];
  const operands: ResolvedOperand[] = [];
  const unmatched: string[] = [];
  let hasBlockedAlias = false;

  let i = 0;
  while (i < tokens.length) {
    // Try greedy longest-match starting at position i.
    let matched = false;
    const upperBound = Math.min(maxPhraseLen, tokens.length - i);

    for (let phraseLen = upperBound; phraseLen >= 1; phraseLen--) {
      const slice = tokens.slice(i, i + phraseLen).join(' ');
      const candidates = tables.termByRaw.get(slice);
      if (!candidates || candidates.length === 0) continue;

      // Pick the first candidate. V1 ambiguity tie-break: authored order.
      // V2 may add scored disambiguation by frequency / recency.
      const term = candidates[0]!;
      const aliasResult = applyAlias(slice, term, tables);

      if (aliasResult === null) {
        // Blocked alias — skip this match, record + continue past it.
        hasBlockedAlias = true;
        i += phraseLen;
        matched = true;
        break;
      }

      // Categorize by phraseClass into the three output streams.
      switch (term.phraseClass) {
        case 'verb': {
          // Enforce the §2.4 invariant at resolve-time too — defense in
          // depth against a fixture that slipped past the loader check.
          if (!ACTION_VERB_SET.has(aliasResult.canonicalTerm)) {
            throw new Error(
              `lexical-resolver: verb canonicalTerm '${aliasResult.canonicalTerm}' (rawTerm '${slice}') is NOT a member of ACTION_VERB; ` +
                `cross-fixture invariant §2.4 violated. Fixture should have failed loader check.`
            );
          }
          verbs.push({
            rawTerm: slice,
            canonicalVerb: aliasResult.canonicalTerm as NonEmpty,
            aliasRule: aliasResult.aliasStatus,
          });
          break;
        }
        case 'noun':
          targets.push({
            rawTerm: slice,
            targetTerm: aliasResult.canonicalTerm,
            value: null,
          });
          break;
        case 'business_phrase':
          operands.push({
            rawTerm: slice,
            operand: aliasResult.canonicalTerm,
          });
          break;
      }

      i += phraseLen;
      matched = true;
      break;
    }

    if (!matched) {
      // Second-pass scan — blocked aliases without a corresponding
      // lex-term still need to fire as defense in depth. Greedy
      // longest-match against alias rawTerms; only `blocked` rules
      // trigger here (approved / review_required without a lex-term
      // have nothing to remap and are inert).
      let aliasMatched = false;
      for (let phraseLen = Math.min(maxPhraseLen, tokens.length - i); phraseLen >= 1; phraseLen--) {
        const slice = tokens.slice(i, i + phraseLen).join(' ');
        const rule = tables.aliasByRaw.get(slice);
        if (rule && rule.status === 'blocked') {
          hasBlockedAlias = true;
          i += phraseLen;
          aliasMatched = true;
          break;
        }
      }
      if (aliasMatched) continue;

      const token = tokens[i]!;
      if (!STOP_WORDS.has(token)) {
        unmatched.push(token);
      }
      i += 1;
    }
  }

  return {
    verbs,
    targets,
    operands,
    unmatched,
    hasBlockedAlias,
  };
}

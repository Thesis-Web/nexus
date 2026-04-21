/**
 * Governed Lexical Types — Amendment J-S1
 *
 * Spec: nexus-engineering-spec-v1-8-26.md §12.5
 * Blueprint: nexus-blueprint-v1-5-13.md §34
 *
 * Build-time and fixture contracts only.
 * Runtime code loads only the generated governed lexical fixture —
 * never WordNet source files.
 */

// ─── Lexical alias candidate — build-time only ───
// Produced by scripts/build-wordnet-lexicon.ts from WordNet source data.
// Never used at runtime. Stored only in fixtures/lexicon/wordnet-candidate-aliases.v1.json.
export interface LexicalAliasCandidate {
  rawTerm: string;
  candidateCanonicalVerb: string;
  source: 'wordnet';
  relation: 'synonym' | 'troponym' | 'hypernym' | 'derivational' | 'related';
  confidenceClass: 'direct' | 'near' | 'ambiguous';
  sourceVersion: string;
}

// ─── Governed verb alias rule — runtime law ───
// Produced by applying governance override files to LexicalAliasCandidates.
// Stored in fixtures/lexicon/governed-verb-lexicon.v1.json.
// This is the runtime authority artifact for lexical resolution.
export interface GovernedVerbAliasRule {
  rawTerm: string;
  canonicalVerb: string | null;
  decision: 'approve' | 'forbid' | 'hard_separate' | 'review_required';
  rationale: string;
  source: 'governance_override';
}

// ─── Governed verb lexicon — the runtime fixture ───
// The complete versioned output of the build-time lexicon generation pipeline.
// Runtime resolver loads this file only. WordNet is never consulted at runtime.
export interface GovernedVerbLexicon {
  lexiconVersion: string;
  canonicalVerbTaxonomyVersion: string;
  wordnetSourceVersion: string;
  generatedAt: string;
  approved: Record<string, string>; // rawTerm → canonicalVerb
  forbidden: Record<string, string[]>; // canonicalVerb → forbidden raw terms
  hardSeparated: Record<string, string[]>; // canonicalVerb → hard-separated raw terms
  reviewRequired: string[]; // raw terms requiring operator review
}

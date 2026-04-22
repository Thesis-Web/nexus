/**
 * Verb normalizer — spec §13.3.1 (Amendment J-S1)
 *
 * Resolution order (§13.3.1):
 *   1. Exact governed verb match — raw verb IS a canonical ACTION_VERB
 *   2. Exact approved alias match — raw verb in governed lexical fixture
 *   3. Tool/endpoint deterministic override — prefix map
 *   4. Hard-separated or forbidden — return null (unresolvable)
 *   5. Unresolved — return null (never guess)
 *
 * The lexical resolver is optional. If the governed fixture is not available,
 * the normalizer falls back to prefix/exact map behavior (steps 1 + 3 only).
 */
import { ACTION_VERB, type ActionVerb } from '../types/index.js';
import { LexicalVerbResolver } from './lexical-verb-resolver.js';

// ─── Step 3: Tool/endpoint prefix map ───
const VERB_PREFIX_MAP: [string[], ActionVerb][] = [
  [['get_', 'fetch_', 'read_', 'list_', 'retrieve_'], ACTION_VERB.READ],
  [['create_', 'add_', 'insert_', 'new_', 'post_'], ACTION_VERB.CREATE],
  [['update_', 'edit_', 'modify_', 'patch_', 'set_', 'put_'], ACTION_VERB.UPDATE],
  [['delete_', 'remove_', 'destroy_', 'purge_'], ACTION_VERB.DELETE],
  [['send_', 'message_', 'email_', 'notify_', 'alert_'], ACTION_VERB.SEND],
  [['publish_', 'broadcast_', 'release_'], ACTION_VERB.PUBLISH],
  [['export_', 'download_', 'dump_'], ACTION_VERB.EXPORT],
  [['execute_', 'run_', 'invoke_', 'trigger_', 'call_'], ACTION_VERB.EXECUTE],
  [['search_', 'find_', 'scan_', 'browse_'], ACTION_VERB.SEARCH],
  [['query_', 'ask_', 'request_'], ACTION_VERB.QUERY],
  [['write_', 'record_', 'log_', 'store_', 'save_'], ACTION_VERB.WRITE],
  [['synthesize_', 'summarize_', 'combine_', 'merge_'], ACTION_VERB.SYNTHESIZE],
  [['transmit_', 'transfer_', 'relay_', 'forward_'], ACTION_VERB.TRANSMIT],
];

export class VerbNormalizer {
  private readonly resolver: LexicalVerbResolver | null;

  constructor(resolver?: LexicalVerbResolver | null) {
    this.resolver = resolver ?? null;
  }

  normalize(rawVerb: string): ActionVerb | null {
    const lower = rawVerb.toLowerCase().trim();

    // DEF-S29-003: Governed lexical fixture is mandatory for runtime paths.
    // No fallback behavior — all five steps of §13.3.1 must execute.
    if (!this.resolver) {
      throw new Error(
        'LexicalVerbResolver not configured. ' +
          'Governed lexical fixture is mandatory for runtime paths (DEF-S29-003). ' +
          'Run pnpm lexicon:build and pass LexicalVerbResolver.loadFromFixture() to VerbNormalizer.'
      );
    }

    // §13.3.1 five-step resolution order:
    // Step 1 + 2: Exact canonical match + approved alias
    const resolved = this.resolver.resolveApprovedOnly(lower);
    if (resolved !== null) return resolved;

    // Step 3: Tool/endpoint prefix map
    const prefixMatch = this.matchPrefix(lower);
    if (prefixMatch !== null) return prefixMatch;

    // Step 4: Hard-separated or forbidden — governance blocks resolution
    if (this.resolver.isBlocked(lower)) return null;

    // Step 5: Unresolved — no match, no guess
    return null;
  }

  private matchPrefix(lower: string): ActionVerb | null {
    for (const [prefixes, verb] of VERB_PREFIX_MAP) {
      if (prefixes.some(p => lower.startsWith(p))) return verb;
    }
    return null;
  }
}

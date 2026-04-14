/**
 * Verb normalizer — spec §19.2 VERB_PREFIX_MAP + §13.9.1
 */
import { ACTION_VERB, type ActionVerb } from '../types/index.js';

const VERB_PREFIX_MAP: [string[], ActionVerb][] = [
  [['get_', 'fetch_', 'read_', 'list_', 'search_', 'find_', 'retrieve_'], ACTION_VERB.READ],
  [['create_', 'add_', 'insert_', 'new_', 'post_'],                       ACTION_VERB.CREATE],
  [['update_', 'edit_', 'modify_', 'patch_', 'set_', 'put_'],             ACTION_VERB.UPDATE],
  [['delete_', 'remove_', 'destroy_', 'purge_'],                          ACTION_VERB.DELETE],
  [['send_', 'message_', 'email_', 'notify_', 'alert_'],                  ACTION_VERB.SEND],
  [['publish_', 'broadcast_', 'release_'],                                 ACTION_VERB.PUBLISH],
  [['export_', 'download_', 'dump_'],                                      ACTION_VERB.EXPORT],
  [['execute_', 'run_', 'invoke_', 'trigger_', 'call_'],                  ACTION_VERB.EXECUTE],
];

const EXACT_MAP: Record<string, ActionVerb> = {
  read: ACTION_VERB.READ, get: ACTION_VERB.READ, fetch: ACTION_VERB.READ,
  list: ACTION_VERB.READ, find: ACTION_VERB.READ,
  create: ACTION_VERB.CREATE, add: ACTION_VERB.CREATE, insert: ACTION_VERB.CREATE,
  update: ACTION_VERB.UPDATE, edit: ACTION_VERB.UPDATE, patch: ACTION_VERB.UPDATE,
  delete: ACTION_VERB.DELETE, remove: ACTION_VERB.DELETE, destroy: ACTION_VERB.DELETE,
  send: ACTION_VERB.SEND, email: ACTION_VERB.SEND, notify: ACTION_VERB.SEND,
  publish: ACTION_VERB.PUBLISH, broadcast: ACTION_VERB.PUBLISH,
  export: ACTION_VERB.EXPORT, download: ACTION_VERB.EXPORT,
  execute: ACTION_VERB.EXECUTE, run: ACTION_VERB.EXECUTE, invoke: ACTION_VERB.EXECUTE,
};

export class VerbNormalizer {
  normalize(rawVerb: string): ActionVerb | null {
    const lower = rawVerb.toLowerCase().trim();

    // Exact match first
    const exact = EXACT_MAP[lower];
    if (exact) return exact;

    // Prefix match
    for (const [prefixes, verb] of VERB_PREFIX_MAP) {
      if (prefixes.some(p => lower.startsWith(p))) return verb;
    }

    // Single-word verbs that are action verbs themselves
    for (const verb of Object.values(ACTION_VERB)) {
      if (lower === verb) return verb;
    }

    return null;
  }
}

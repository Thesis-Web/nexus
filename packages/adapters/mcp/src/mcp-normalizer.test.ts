/**
 * MCP Normalizer Tests — DEF-D2-001
 * Spec: §19.2 (verb prefix map, inferVerbFromMcp)
 *
 * Covers:
 *   - Original verb prefix groups (READ, CREATE, UPDATE, DELETE, SEND, PUBLISH, EXPORT, EXECUTE)
 *   - v1.4.12 additions (WRITE, QUERY, SEARCH, SYNTHESIZE, TRANSMIT)
 *   - Prefix collision resolution (search_/find_ → SEARCH, not READ)
 *   - EXECUTE fallback annotation in objectiveSummary
 *   - Positive prefix match — no annotation
 */
import { describe, it, expect } from 'vitest';
import { McpAdapter } from './mcp-normalizer.js';
import { ACTION_VERB } from '@nexus/contracts';
import type { NonEmpty } from '@nexus/contracts';

/** Build a minimal McpRequest with required headers and a tool name. */
function makeRequest(toolName: string) {
  return {
    method: toolName,
    headers: {
      'x-nexus-actor-id': 'actor-001',
      'x-nexus-principal-id': 'principal-001',
      'x-nexus-session-id': 'session-001',
      'x-nexus-delegation-id': 'delegation-001',
      'x-nexus-run-id': 'run-001',
    },
  };
}

describe('MCP Normalizer — verb prefix map', () => {
  const adapter = new McpAdapter();

  // ── Original verb groups ──────────────────────────────────────────────────

  it('maps get_ prefix to READ', async () => {
    const r = await adapter.normalize(makeRequest('get_users'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action.rawVerb).toBe(ACTION_VERB.READ);
  });

  it('maps fetch_ prefix to READ', async () => {
    const r = await adapter.normalize(makeRequest('fetch_data'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action.rawVerb).toBe(ACTION_VERB.READ);
  });

  it('maps read_ prefix to READ', async () => {
    const r = await adapter.normalize(makeRequest('read_document'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action.rawVerb).toBe(ACTION_VERB.READ);
  });

  it('maps create_ prefix to CREATE', async () => {
    const r = await adapter.normalize(makeRequest('create_ticket'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action.rawVerb).toBe(ACTION_VERB.CREATE);
  });

  it('maps update_ prefix to UPDATE', async () => {
    const r = await adapter.normalize(makeRequest('update_record'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action.rawVerb).toBe(ACTION_VERB.UPDATE);
  });

  it('maps delete_ prefix to DELETE', async () => {
    const r = await adapter.normalize(makeRequest('delete_item'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action.rawVerb).toBe(ACTION_VERB.DELETE);
  });

  it('maps send_ prefix to SEND', async () => {
    const r = await adapter.normalize(makeRequest('send_notification'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action.rawVerb).toBe(ACTION_VERB.SEND);
  });

  it('maps publish_ prefix to PUBLISH', async () => {
    const r = await adapter.normalize(makeRequest('publish_report'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action.rawVerb).toBe(ACTION_VERB.PUBLISH);
  });

  it('maps export_ prefix to EXPORT', async () => {
    const r = await adapter.normalize(makeRequest('export_csv'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action.rawVerb).toBe(ACTION_VERB.EXPORT);
  });

  it('maps execute_ prefix to EXECUTE (positive match)', async () => {
    const r = await adapter.normalize(makeRequest('execute_script'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action.rawVerb).toBe(ACTION_VERB.EXECUTE);
  });

  // ── v1.4.12 additions (DEF-D2-001) ───────────────────────────────────────

  it('maps write_ prefix to WRITE (v1.4.12)', async () => {
    const r = await adapter.normalize(makeRequest('write_config'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action.rawVerb).toBe(ACTION_VERB.WRITE);
  });

  it('maps overwrite_ prefix to WRITE (v1.4.12)', async () => {
    const r = await adapter.normalize(makeRequest('overwrite_settings'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action.rawVerb).toBe(ACTION_VERB.WRITE);
  });

  it('maps query_ prefix to QUERY (v1.4.12)', async () => {
    const r = await adapter.normalize(makeRequest('query_database'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action.rawVerb).toBe(ACTION_VERB.QUERY);
  });

  it('maps lookup_ prefix to QUERY (v1.4.12)', async () => {
    const r = await adapter.normalize(makeRequest('lookup_user'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action.rawVerb).toBe(ACTION_VERB.QUERY);
  });

  it('maps search_ prefix to SEARCH (v1.4.12 — moved from READ)', async () => {
    const r = await adapter.normalize(makeRequest('search_records'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action.rawVerb).toBe(ACTION_VERB.SEARCH);
  });

  it('maps find_ prefix to SEARCH (v1.4.12 — moved from READ)', async () => {
    const r = await adapter.normalize(makeRequest('find_contacts'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action.rawVerb).toBe(ACTION_VERB.SEARCH);
  });

  it('maps browse_ prefix to SEARCH (v1.4.12)', async () => {
    const r = await adapter.normalize(makeRequest('browse_catalog'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action.rawVerb).toBe(ACTION_VERB.SEARCH);
  });

  it('maps synthesize_ prefix to SYNTHESIZE (v1.4.12)', async () => {
    const r = await adapter.normalize(makeRequest('synthesize_summary'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action.rawVerb).toBe(ACTION_VERB.SYNTHESIZE);
  });

  it('maps compose_ prefix to SYNTHESIZE (v1.4.12)', async () => {
    const r = await adapter.normalize(makeRequest('compose_email'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action.rawVerb).toBe(ACTION_VERB.SYNTHESIZE);
  });

  it('maps generate_ prefix to SYNTHESIZE (v1.4.12)', async () => {
    const r = await adapter.normalize(makeRequest('generate_report'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action.rawVerb).toBe(ACTION_VERB.SYNTHESIZE);
  });

  it('maps transmit_ prefix to TRANSMIT (v1.4.12)', async () => {
    const r = await adapter.normalize(makeRequest('transmit_payload'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action.rawVerb).toBe(ACTION_VERB.TRANSMIT);
  });

  it('maps stream_ prefix to TRANSMIT (v1.4.12)', async () => {
    const r = await adapter.normalize(makeRequest('stream_events'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action.rawVerb).toBe(ACTION_VERB.TRANSMIT);
  });

  // ── EXECUTE fallback annotation (DEF-D2-001) ─────────────────────────────

  it('defaults to EXECUTE when no prefix matches', async () => {
    const r = await adapter.normalize(makeRequest('unknown_operation'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action.rawVerb).toBe(ACTION_VERB.EXECUTE);
  });

  it('annotates objectiveSummary with fallback-default on unmatched verb', async () => {
    const r = await adapter.normalize(makeRequest('foobar_something'));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.action.intent.objectiveSummary).toContain('[verb-inference: fallback-default]');
    }
  });

  it('does NOT annotate objectiveSummary on positive prefix match', async () => {
    const r = await adapter.normalize(makeRequest('get_users'));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.action.intent.objectiveSummary).not.toContain('fallback-default');
    }
  });

  it('rejects missing X-Nexus-Run-Id header — workspace must assign runId (ADAPTER-001)', async () => {
    const r = await adapter.normalize({
      method: 'get_users',
      headers: {
        'x-nexus-actor-id': 'actor-001',
        'x-nexus-principal-id': 'principal-001',
        'x-nexus-session-id': 'session-001',
        'x-nexus-delegation-id': 'delegation-001',
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.error).toContain('X-Nexus-Run-Id');
  });

  it('preserves workspace-assigned runId from X-Nexus-Run-Id header (ADAPTER-001)', async () => {
    const r = await adapter.normalize(makeRequest('get_users'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action.runId).toBe('run-001');
  });

  it('execute_ prefix is a positive match, not a fallback', async () => {
    const r = await adapter.normalize(makeRequest('execute_script'));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.action.rawVerb).toBe(ACTION_VERB.EXECUTE);
      expect(r.action.intent.objectiveSummary).not.toContain('fallback-default');
    }
  });
});

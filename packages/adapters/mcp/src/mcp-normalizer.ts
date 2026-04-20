/**
 * MCP normalizer — spec §19.2, §11.2
 *
 * Implements the Adapter interface. Converts a raw McpRequest (HTTP body + headers)
 * into a NormalizationResult containing an AgentAction with all classification
 * fields set to null/[] (Gate 02 resolves them).
 *
 * ADAPTER ENVIRONMENT NON-OVERRIDE LAW (blueprint §5.4 / spec §19.2):
 *   Adapters MUST NOT set or override environment.
 *   The sentinel string 'ACTOR_ENVIRONMENT' is placed in rawTarget.
 *   Gate 02 calls targetNormalizer.normalize(action.rawTarget, action.tool,
 *   context.actor.environment), which replaces the sentinel with the actor's
 *   authoritative environment from the actor registry.
 *   X-Nexus-Environment header is intentionally absent from the header table
 *   and is NOT read here.
 *
 * MCP SESSION LAW (spec §19.2 / SOLVE-007):
 *   The normalizer does NOT create sessions. If a session does not exist,
 *   Gate 01 returns SESSION_NOT_FOUND. There is no auto-create path here.
 *
 * Blueprint: nexus-blueprint-v0-3-6.md §5.4
 * Spec: nexus-engineering-spec-v0-4-6.md §11.2, §13.9.1, §19.2
 * MODULAR-001: adapter never imports pipeline internals — calls pipeline.process() only.
 */

import {
  ACTION_VERB,
  type Adapter,
  type NormalizationResult,
  type AgentAction,
  type ActionVerb,
  type Uuid,
  nowIso,
  newUuid,
} from '@nexus/contracts';
import { extractIntentContext, type McpRequestHeaders } from './mcp-intent-extractor.js';

// ── Adapter identity ─────────────────────────────────────────────────────────

const ADAPTER_PROTOCOL = 'mcp/1.0' as const;
const ADAPTER_VERSION = 'v0.1.0' as const;
const ADAPTER_LABEL = `mcp-adapter/${ADAPTER_VERSION}` as const;

// ── McpRequest shape ─────────────────────────────────────────────────────────
// Represents the normalized HTTP body + header bundle handed to the normalizer.
// The MCP JSON-RPC 2.0 body uses "method" for the tool name.
// Some clients use "tool" directly. Both are supported per §19.2 spec code.

export interface McpRequest {
  method?: string;
  tool?: string;
  params?: Record<string, unknown>;
  headers: McpRequestHeaders;
  // JSON-RPC 2.0 fields
  jsonrpc?: string;
  id?: string | number | null;
}

// ── §19.2 VERB_PREFIX_MAP (spec-exact) ───────────────────────────────────────

const VERB_PREFIX_MAP: [string[], ActionVerb][] = [
  [['get_', 'fetch_', 'read_', 'list_', 'search_', 'find_', 'retrieve_'], ACTION_VERB.READ],
  [['create_', 'add_', 'insert_', 'new_', 'post_'], ACTION_VERB.CREATE],
  [['update_', 'edit_', 'modify_', 'patch_', 'set_', 'put_'], ACTION_VERB.UPDATE],
  [['delete_', 'remove_', 'destroy_', 'purge_'], ACTION_VERB.DELETE],
  [['send_', 'message_', 'email_', 'notify_', 'alert_'], ACTION_VERB.SEND],
  [['publish_', 'broadcast_', 'release_'], ACTION_VERB.PUBLISH],
  [['export_', 'download_', 'dump_'], ACTION_VERB.EXPORT],
  [['execute_', 'run_', 'invoke_', 'trigger_', 'call_'], ACTION_VERB.EXECUTE],
];

// ── §19.2 helper functions (spec-exact names and logic) ──────────────────────

/** Extract a header value from the request headers map (case-insensitive). */
function extractHeader(mcp: McpRequest, name: string): string | null {
  const key = name.toLowerCase();
  const val = mcp.headers[key];
  if (val == null) return null;
  if (Array.isArray(val)) return val[0] ?? null;
  return val;
}

/** §19.2 inferVerbFromMcp — spec-exact. */
function inferVerbFromMcp(mcp: McpRequest): string {
  const tool = (mcp.method ?? mcp.tool ?? '').toLowerCase();
  for (const [prefixes, verb] of VERB_PREFIX_MAP) {
    if (prefixes.some(p => tool.startsWith(p))) return verb;
  }
  return ACTION_VERB.EXECUTE;
}

/** §19.2 extractToolNameSuffix — spec-exact. */
function extractToolNameSuffix(toolName: string): string {
  const parts = toolName.toLowerCase().split('_').filter(Boolean);
  return parts[parts.length - 1] ?? 'resource';
}

/** §19.2 inferResourceScope — spec-exact. */
function inferResourceScope(mcp: McpRequest): 'single' | 'bulk' | 'collection' | 'system' {
  if (Array.isArray(mcp.params?.['ids'])) return 'bulk';
  if (mcp.params?.['filter'] !== undefined || mcp.params?.['query'] !== undefined)
    return 'collection';
  if (mcp.params?.['id'] !== undefined) return 'single';
  return 'single';
}

/** §19.2 isExternalFacingMcp — spec-exact. */
function isExternalFacingMcp(mcp: McpRequest): boolean {
  if (extractHeader(mcp, 'X-Nexus-External-Facing') === 'true') return true;
  const tool = (mcp.method ?? mcp.tool ?? '').toLowerCase();
  return (
    tool.includes('_external') ||
    tool.includes('_email') ||
    tool.includes('_webhook') ||
    tool.includes('_publish')
  );
}

/**
 * §19.2 inferTargetFromMcp — spec-exact.
 *
 * ADAPTER ENVIRONMENT LAW: Sets environment to the sentinel 'ACTOR_ENVIRONMENT'.
 * Gate 02 replaces this sentinel with context.actor.environment when calling
 * targetNormalizer.normalize(action.rawTarget, action.tool, context.actor.environment).
 * X-Nexus-Environment header is intentionally NOT read here.
 */
function inferTargetFromMcp(mcp: McpRequest): string {
  const resourceType =
    (mcp.params?.['resourceType'] as string | undefined) ??
    (mcp.params?.['resource'] as string | undefined) ??
    extractToolNameSuffix(mcp.method ?? mcp.tool ?? '');
  const system = extractHeader(mcp, 'X-Nexus-Target-System') ?? 'unknown';
  const scope = inferResourceScope(mcp);
  const ext = isExternalFacingMcp(mcp);
  // ACTOR_ENVIRONMENT sentinel — Gate 02 replaces with actor.environment
  return JSON.stringify({
    system,
    resourceType,
    resourceScope: scope,
    environment: 'ACTOR_ENVIRONMENT',
    externalFacing: ext,
  });
}

// ── Required header extraction ───────────────────────────────────────────────

interface RequiredHeaders {
  actorId: string;
  principalId: string;
  sessionId: string;
  delegationId: string;
}

function extractRequiredHeaders(mcp: McpRequest): RequiredHeaders | { error: string } {
  const actorId = extractHeader(mcp, 'X-Nexus-Actor-Id');
  const principalId = extractHeader(mcp, 'X-Nexus-Principal-Id');
  const sessionId = extractHeader(mcp, 'X-Nexus-Session-Id');
  const delegationId = extractHeader(mcp, 'X-Nexus-Delegation-Id');

  if (!actorId) return { error: 'Missing required header: X-Nexus-Actor-Id' };
  if (!principalId) return { error: 'Missing required header: X-Nexus-Principal-Id' };
  if (!sessionId) return { error: 'Missing required header: X-Nexus-Session-Id' };
  if (!delegationId) return { error: 'Missing required header: X-Nexus-Delegation-Id' };

  return { actorId, principalId, sessionId, delegationId };
}

// ── McpAdapter class — implements Adapter interface ──────────────────────────

export class McpAdapter implements Adapter {
  readonly adapterProtocol = ADAPTER_PROTOCOL;
  readonly adapterVersion = ADAPTER_VERSION;

  async normalize(rawRequest: unknown): Promise<NormalizationResult> {
    // Validate that rawRequest has the expected shape
    if (rawRequest == null || typeof rawRequest !== 'object' || !('headers' in rawRequest)) {
      return { ok: false, error: 'Invalid MCP request: missing headers field' };
    }

    const mcp = rawRequest as McpRequest;

    // Required headers
    const hdrs = extractRequiredHeaders(mcp);
    if ('error' in hdrs) {
      return { ok: false, error: hdrs.error };
    }

    // Tool name — at least one of method or tool must be present
    const toolName = (mcp.method ?? mcp.tool ?? '').trim();
    if (toolName.length === 0) {
      return { ok: false, error: 'Invalid MCP request: missing method/tool name' };
    }

    // Intent extraction
    const intent = extractIntentContext(mcp.headers, toolName, ADAPTER_LABEL, nowIso);

    // Build the AgentAction with all classification fields null (Gate 02 resolves)
    // delegationSequence is assigned by the pipeline at ingress — never by the adapter
    const action: Omit<
      AgentAction,
      | 'resolvedVerb'
      | 'resolvedCapability'
      | 'resolvedTarget'
      | 'resolvedDataClasses'
      | 'resolvedRiskTier'
    > & {
      resolvedVerb: null;
      resolvedCapability: null;
      resolvedTarget: null;
      resolvedDataClasses: [];
      resolvedRiskTier: null;
    } = {
      actionId: newUuid() as Uuid,
      runId: newUuid() as Uuid,
      receivedAt: nowIso(),
      protocol: ADAPTER_PROTOCOL,
      adapterVersion: ADAPTER_VERSION,
      actorId: hdrs.actorId as Uuid,
      principalId: hdrs.principalId as Uuid,
      sessionId: hdrs.sessionId as Uuid,
      delegationId: hdrs.delegationId as Uuid,
      delegationSequence: 0, // pipeline.process() assigns real sequence at ingress
      tool: toolName,
      rawVerb: inferVerbFromMcp(mcp),
      rawTarget: inferTargetFromMcp(mcp),
      rawPayload: mcp.params ?? {},
      intent,
      resolvedVerb: null,
      resolvedCapability: null,
      resolvedTarget: null,
      resolvedDataClasses: [],
      resolvedRiskTier: null,
    };

    return { ok: true, action };
  }
}

/**
 * MCP proxy — spec §19.1, §19.2
 *
 * HTTP request handler that sits between MCP clients and the Nexus pipeline.
 * Responsibility: transport and normalization only. This layer MUST NOT resolve
 * actor, principal, or delegationContext — that is Gate 01 authority (HOLE-002).
 *
 * Flow:
 *   1. Parse incoming HTTP body as McpRequest (JSON-RPC 2.0 or raw body)
 *   2. Attach request headers to the McpRequest object
 *   3. Call McpAdapter.normalize() → NormalizationResult
 *      - If normalize fails (malformed transport/schema): return HTTP 422 with error JSON
 *        (short-circuit is permitted before a valid canonical AgentAction exists)
 *   4. Build a PipelineContext shell with base runtime dependencies only.
 *      actor/principal/delegationContext are NOT set here — Gate 01 resolves them.
 *   5. Call pipeline.process(action, context) → EvidenceRecord
 *   6. Return JSON response based on EvidenceRecord.finalOutcome:
 *      - 'executed'  → HTTP 200, success body
 *      - all denials → HTTP 403, denial body
 *      - 'error'     → HTTP 500, error body
 *
 * MCP SESSION LAW (SOLVE-007): No auto-create session path. If session not found,
 * Gate 01 returns SESSION_NOT_FOUND, Gate 07 writes evidence, proxy returns 403.
 *
 * ADAPTER ENVIRONMENT LAW (blueprint §5.4): Environment is not a header adapters may
 * supply. X-Nexus-Environment is intentionally absent. The ACTOR_ENVIRONMENT sentinel
 * set by the normalizer is replaced by Gate 02 using context.actor.environment.
 *
 * MODULAR-001 FIXED: This file imports PipelineInterface from @nexus/contracts —
 * it does NOT import any core implementation directly. All gate logic is encapsulated
 * in the Pipeline class, accessed only through the PipelineInterface contract.
 *
 * Spec: nexus-engineering-spec-v1-8-26.md §19.1, §19.2
 * Blueprint: nexus-blueprint-v1-5-13.md §5.1, §5.4, §8.1
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  FINAL_OUTCOME,
  type PipelineInterface,
  type PipelineContext,
  type PipelineResult,
  type DelegationStore,
  type LoadedPolicyFile,
  type ApproverRegistry,
  type ConnectorRegistry,
  type ChannelRegistry,
  type EvidenceRecord,
  nowIso,
} from '@nexus/contracts';
import type { McpAdapter } from './mcp-normalizer.js';

// ── NexusMcpProxy ────────────────────────────────────────────────────────────

export interface ProxyDependencies {
  pipeline: PipelineInterface;
  adapter: McpAdapter;
  delegationStore: DelegationStore; // injected; Gate 01 reads it to resolve delegationContext
  policyFile: LoadedPolicyFile | null;
  approverRegistry: ApproverRegistry;
  connectorRegistry: ConnectorRegistry;
  channelRegistry: ChannelRegistry;
}

export class NexusMcpProxy {
  private readonly pipeline: PipelineInterface;
  private readonly adapter: McpAdapter;
  private readonly delegationStore: DelegationStore;
  private readonly policyFile: LoadedPolicyFile | null;
  private readonly approverRegistry: ApproverRegistry;
  private readonly connectorRegistry: ConnectorRegistry;
  private readonly channelRegistry: ChannelRegistry;

  constructor(deps: ProxyDependencies) {
    this.pipeline = deps.pipeline;
    this.adapter = deps.adapter;
    this.delegationStore = deps.delegationStore;
    this.policyFile = deps.policyFile;
    this.approverRegistry = deps.approverRegistry;
    this.connectorRegistry = deps.connectorRegistry;
    this.channelRegistry = deps.channelRegistry;
  }

  // ── Request handler ────────────────────────────────────────────────────────

  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // 1. Read body
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { ok: false, error: 'Request body must be valid JSON' });
      return;
    }

    // 2. Attach lowercase headers to the body object for the normalizer
    const headers = lowerCaseHeaders(req.headers as Record<string, string | string[] | undefined>);
    const mcpRequest = { ...(body as Record<string, unknown>), headers };

    // 3. Normalize — short-circuit 422 on malformed transport input (pre-AgentAction)
    const normalized = await this.adapter.normalize(mcpRequest);
    if (!normalized.ok || !normalized.action) {
      sendJson(res, 422, {
        ok: false,
        error: normalized.error ?? 'Normalization failed',
      });
      return;
    }

    const action = normalized.action;

    // 4. Build PipelineContext shell — transport dependencies only.
    //    actor, principal, delegationContext are intentionally absent (HOLE-002).
    //    Gate 01 resolves the identity tuple using delegationStore and other registries.
    const context = {
      sessionId: action.sessionId,
      delegationContext: undefined as any,
      actor: undefined as any,
      principal: undefined as any,
      delegationStore: this.delegationStore,
      policyFile: this.policyFile,
      approverRegistry: this.approverRegistry,
      connectorRegistry: this.connectorRegistry,
      channelRegistry: this.channelRegistry,
      threatLog: [],
      startedAt: nowIso(),
    };

    // 5. Run the pipeline
    let pipelineResult: PipelineResult;
    try {
      pipelineResult = await this.pipeline.process(action, context);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, {
        ok: false,
        error: `Pipeline error: ${message}`,
      });
      return;
    }

    const evidenceRecord = pipelineResult.evidenceRecord;
    const disposition = pipelineResult.disposition;

    // 6. Return response based on finalOutcome + mode disposition
    // MODE-001: In observe/advisory modes, denials are NOT hard blocks.
    // Caller receives the evidence record with disposition indicator.
    const outcome = evidenceRecord.finalOutcome;
    if (outcome === FINAL_OUTCOME.EXECUTED) {
      sendJson(res, 200, {
        ok: true,
        finalOutcome: outcome,
        disposition,
        evidenceRecord,
      });
    } else if (disposition === 'observe' || disposition === 'advisory') {
      // Non-enforcing mode: return 200 with the evaluated decision.
      // The decision is real and logged — caller decides whether to block.
      sendJson(res, 200, {
        ok: true,
        finalOutcome: outcome,
        disposition,
        evidenceRecord,
      });
    } else {
      // Enforcing mode: denial/error → 403
      sendJson(res, 403, {
        ok: false,
        finalOutcome: outcome,
        disposition,
        evidenceRecord,
      });
    }
  }
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw.length > 0 ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function lowerCaseHeaders(
  headers: Record<string, string | string[] | undefined>
): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k.toLowerCase()] = v;
  }
  return out;
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * NXS slot-binding resolver — composition-boundary helper.
 *
 * File: scripts/nxs-slot-binding-resolver.ts
 *
 * Resolves an `NxsActionTemplate.slotBindings[]` against the run mailbox
 * before the composition root builds the `AgentAction` for an
 * `nxs_dispatch` node. This is the mechanism by which **orch** (not NXS,
 * not the LLM, not the planner-at-plan-time) supplies runtime-computed
 * parameters — e.g. an LLM-adjusted inventory value — into the next
 * NXS write call's payload. NXS itself never sees a binding; it only
 * sees the resolved payload.
 *
 * Failure modes are surfaced as typed reasons; no "best effort" fallback.
 * The caller (`dispatchNxsNode`) turns failures into
 * `NodeDispatchResult { success: false, failureReason: 'slot_binding_resolve_failed: ...' }`
 * so the DAG executor's existing dependency_failed propagation handles
 * downstream nodes correctly.
 *
 * Lives in `scripts/` next to the other composition-root helpers
 * (`nxs-result-mailbox-bridge.ts`, `dispatch-round-trip.ts`) because the
 * coordination is composition mechanics, not engine internals.
 */
import { promises as fs } from 'node:fs';
import type {
  ExecutionPlan,
  MailboxService,
  NonEmpty,
  NxsActionTemplate,
  NxsSlotBinding,
  PlanNode,
  Uuid,
} from '@nexus/contracts';

export interface ResolveSlotBindingsInput {
  /** The nxs_dispatch node being dispatched. Its actionTemplate is
   *  the substitution target; its inputSlotReads is the audit guard. */
  readonly node: PlanNode;
  /** Full execution plan — required because slotBindings address upstream
   *  sub-tasks by `subTaskKey`, which the dispatcher resolves to an
   *  upstream nodeId via the plan. */
  readonly plan: ExecutionPlan;
  /** Same MailboxService instance the rest of the loop uses. */
  readonly mailboxService: MailboxService;
  /** Primary mailbox id — same one writes used. */
  readonly mailboxId: NonEmpty;
  /** Run id for slot lookups. */
  readonly runId: Uuid;
}

export type ResolveSlotBindingsResult =
  | { readonly resolved: true; readonly payload: unknown }
  | { readonly resolved: false; readonly reason: string };

/**
 * Resolve every binding on the node's actionTemplate. Returns the deep-
 * cloned `rawPayload` with each binding's leaf overwritten by the
 * upstream slot value. Returns `{ resolved: false, reason }` on the
 * first failure — partial substitution is never observable.
 *
 * When `slotBindings` is empty / undefined the original `rawPayload`
 * is returned unchanged (still deep-cloned defensively so the caller
 * can mutate without leaking back into the plan).
 */
export async function resolveNxsSlotBindings(
  input: ResolveSlotBindingsInput
): Promise<ResolveSlotBindingsResult> {
  const tmpl = input.node.actionTemplate;
  if (!tmpl) {
    return { resolved: false, reason: 'missing_action_template' };
  }

  const clone = deepClone(tmpl.rawPayload);
  const bindings = tmpl.slotBindings ?? [];
  if (bindings.length === 0) {
    return { resolved: true, payload: clone };
  }

  for (const binding of bindings) {
    const value = await readBindingValue(binding, input);
    if (!value.ok) {
      return {
        resolved: false,
        reason: `${value.reason} (fromSubTaskKey='${binding.fromSubTaskKey}', slotId='${binding.slotId}')`,
      };
    }
    const written = writeByDottedPath(clone, binding.payloadPath, value.value);
    if (!written.ok) {
      return {
        resolved: false,
        reason: `${written.reason} (payloadPath='${binding.payloadPath}')`,
      };
    }
  }

  return { resolved: true, payload: clone };
}

// ─── helpers (exported for unit tests) ───

interface ReadOk {
  readonly ok: true;
  readonly value: unknown;
}
interface ReadFail {
  readonly ok: false;
  readonly reason: string;
}
type ReadResult = ReadOk | ReadFail;

async function readBindingValue(
  binding: NxsSlotBinding,
  input: ResolveSlotBindingsInput
): Promise<ReadResult> {
  // Resolve upstream node by subTaskKey
  const upstream = input.plan.nodes.find(n => n.subTaskKey === binding.fromSubTaskKey);
  if (!upstream) {
    return { ok: false, reason: 'upstream_subtask_not_in_plan' };
  }

  // Find the latest available mailbox item for (runId, upstreamNodeId, slotId)
  const item = await input.mailboxService.findBySlot(
    input.mailboxId,
    input.runId,
    upstream.nodeId,
    binding.slotId
  );
  if (item === null) {
    return { ok: false, reason: 'upstream_slot_item_missing' };
  }

  if (!item.resultRef.startsWith('file://')) {
    return { ok: false, reason: 'unsupported_result_ref_scheme' };
  }

  const filePath = item.resultRef.slice('file://'.length);
  let body: string;
  try {
    body = await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `payload_read_failed: ${msg}` };
  }

  if (binding.sourceJsonPath === undefined || binding.sourceJsonPath === null) {
    // Full utf-8 body verbatim. Common for prose / single-value slots.
    return { ok: true, value: body };
  }

  // Drill into the JSON body by dotted path
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `upstream_body_not_json: ${msg}` };
  }

  const drilled = readByDottedPath(parsed, binding.sourceJsonPath);
  if (!drilled.ok) {
    return { ok: false, reason: `${drilled.reason} (sourceJsonPath='${binding.sourceJsonPath}')` };
  }
  return { ok: true, value: drilled.value };
}

/**
 * Walk a dotted path through a JSON value. Numeric segments index into
 * arrays. Returns the leaf or a typed failure when any segment misses.
 */
export function readByDottedPath(
  root: unknown,
  path: string
): { ok: true; value: unknown } | { ok: false; reason: string } {
  if (path.length === 0) {
    return { ok: false, reason: 'empty_path' };
  }
  const segments = path.split('.');
  let cursor: unknown = root;
  for (const seg of segments) {
    if (cursor === null || cursor === undefined) {
      return { ok: false, reason: 'path_segment_missing' };
    }
    if (Array.isArray(cursor)) {
      const idx = Number.parseInt(seg, 10);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cursor.length) {
        return { ok: false, reason: 'array_index_out_of_range' };
      }
      cursor = cursor[idx];
      continue;
    }
    if (typeof cursor === 'object') {
      if (!Object.prototype.hasOwnProperty.call(cursor, seg)) {
        return { ok: false, reason: 'object_key_missing' };
      }
      cursor = (cursor as Record<string, unknown>)[seg];
      continue;
    }
    return { ok: false, reason: 'cannot_traverse_scalar' };
  }
  return { ok: true, value: cursor };
}

/**
 * Overwrite a dotted-path leaf in an existing structure. Intermediate
 * segments MUST already exist — the binding is a substitution, not a
 * creation. Returns a typed failure when any intermediate segment is
 * missing or the parent at the leaf is not a writable container.
 */
export function writeByDottedPath(
  root: unknown,
  path: string,
  value: unknown
): { ok: true } | { ok: false; reason: string } {
  if (path.length === 0) {
    return { ok: false, reason: 'empty_payload_path' };
  }
  const segments = path.split('.');
  if (segments.length === 0) {
    return { ok: false, reason: 'empty_payload_path' };
  }
  const leafSeg = segments[segments.length - 1];
  if (leafSeg === undefined || leafSeg.length === 0) {
    return { ok: false, reason: 'empty_payload_path' };
  }
  let cursor: unknown = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i] as string;
    if (cursor === null || cursor === undefined) {
      return { ok: false, reason: 'payload_path_intermediate_missing' };
    }
    if (Array.isArray(cursor)) {
      const idx = Number.parseInt(seg, 10);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cursor.length) {
        return { ok: false, reason: 'payload_array_index_out_of_range' };
      }
      cursor = cursor[idx];
      continue;
    }
    if (typeof cursor === 'object') {
      if (!Object.prototype.hasOwnProperty.call(cursor, seg)) {
        return { ok: false, reason: 'payload_path_intermediate_missing' };
      }
      cursor = (cursor as Record<string, unknown>)[seg];
      continue;
    }
    return { ok: false, reason: 'payload_cannot_traverse_scalar' };
  }

  if (cursor === null || cursor === undefined) {
    return { ok: false, reason: 'payload_path_leaf_parent_missing' };
  }
  if (Array.isArray(cursor)) {
    const idx = Number.parseInt(leafSeg, 10);
    if (!Number.isInteger(idx) || idx < 0 || idx >= cursor.length) {
      return { ok: false, reason: 'payload_array_index_out_of_range' };
    }
    cursor[idx] = value;
    return { ok: true };
  }
  if (typeof cursor === 'object') {
    if (!Object.prototype.hasOwnProperty.call(cursor, leafSeg)) {
      return { ok: false, reason: 'payload_path_leaf_missing' };
    }
    (cursor as Record<string, unknown>)[leafSeg] = value;
    return { ok: true };
  }
  return { ok: false, reason: 'payload_cannot_write_to_scalar' };
}

function deepClone(value: unknown): unknown {
  // Structured clone is available in Node 18+; the repo's runtime is
  // newer than that. Falls back to JSON round-trip only if SC throws on
  // exotic inputs (functions, Date, etc.) — none expected in rawPayload.
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // Fall through.
    }
  }
  return JSON.parse(JSON.stringify(value));
}

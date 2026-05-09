// packages/workspace-ref/src/client/components/run-stage-reducer.ts
//
// Pure reducer: RunEvent[] (as produced by the SSE bus / replay) → RunStage[]
// for the workspace play-by-play timeline.
//
// SPEC: CLAUDE-CODE-PLAY-BY-PLAY-SPEC.md §"THE RUN LEDGER EVENT SEQUENCE",
// §"Stage Mapping", §"WHAT'S FORBIDDEN" (no fabricated events, no fake data).
//
// The reducer is deterministic and has no side effects. It can be called on
// any prefix of the event stream — pending stages stay 'pending' until their
// first event lands. SSE replay on resubscribe re-delivers prior events, so
// running the reducer over the replayed prefix reconstructs the full timeline.
//
// Event taxonomy authority: packages/contracts/src/interfaces/index.ts
// (RunEventType union — §30 / §6.4 of the engineering spec). New event types
// that fall outside the stage map are buffered onto the closest stage but
// never crash the timeline.
//
// Failure rendering (spec §"Denial Rendering"):
//   - node_failed with governanceDenied=true     → 'denied' at NVG Wall
//   - node_failed with governanceDenied=false    → 'error'  at NVG Wall
//   - plan_rejected                              → 'denied' at Planning
//   - dag_failed                                 → 'error'  at Agent Response
//   - compile_skipped                            → 'skipped' at Compile
//   - compile_guard_halt                         → 'error'  at Compile
//   - run_closed with closeReason !== 'completed' → 'error' at Run Closed
//
// Layer rule: this file lives in workspace-ref/client and depends on the
// workspace SSE event shape (use-run-events.ts) and the Layer 2 RunEventType
// taxonomy (via string literals). It MUST NOT import from packages/core or
// packages/orch-ref (workspace layer firewall — spec §"WHAT'S FORBIDDEN" #8).

import type { RunEvent } from '../hooks/use-run-events.js';

export type StageStatus = 'pending' | 'active' | 'complete' | 'denied' | 'error' | 'skipped';

export type StageId =
  | 'prompt_received'
  | 'planning'
  | 'plan_review'
  | 'delegation'
  | 'nvg_wall'
  | 'agent_response'
  | 'compile'
  | 'final_response'
  | 'run_closed';

export interface RunStage {
  id: StageId;
  label: string;
  status: StageStatus;
  startedAt: string | null;
  completedAt: string | null;
  /** Human-readable summary lines extracted from the event details. */
  detailLines: string[];
  /** Denial / error code for denied|error stages, otherwise null. */
  failureCode: string | null;
  /** Denial / error message for denied|error stages, otherwise null. */
  failureMessage: string | null;
  /** Raw events that landed in this stage, preserved for debug / inspection. */
  events: RunEvent[];
}

export interface RunTimelineState {
  stages: RunStage[];
  /** ISO timestamp of the first event in the run (used as stage-relative t=0). */
  runStartedAt: string | null;
  /** ISO timestamp of run_closed (or last event if no run_closed). */
  runEndedAt: string | null;
  /** True iff a run_closed event has landed. */
  closed: boolean;
  /** Set when the run terminated abnormally — drives the denial card. */
  failure: {
    stageId: StageId;
    code: string;
    message: string;
    governanceDenied: boolean;
  } | null;
  /**
   * If the last event we know about is a `final_response`, its body is here
   * so the timeline can hand it back to the existing Governed Response card.
   */
  finalResponseBody: string | null;
  /** Final-response artifact id (when present). */
  finalArtifactId: string | null;
  /**
   * CHECKBACK-spec — when a plan_checkback_required event has landed and no
   * matching plan_checkback_resolved has yet, this carries the detail the
   * checkback card needs to render. Null otherwise.
   */
  pendingCheckback: PendingCheckback | null;
}

export interface PendingCheckback {
  primaryTier: string | null;
  primaryHealthy: boolean;
  fallbackTier: string | null;
  fallbackHealthy: boolean;
  alternativeTier: string | null;
  alternativeEndpoint: { endpointId: string; modelName: string; tier: string } | null;
  message: string;
  denialReason: string | null;
}

// ─── Stage definitions — strict event → stage map ──────────────────────────
// Each event type belongs to exactly one stage. Unknown types fall into
// `unknownStageEvents` (returned as-is on the closest stage they share a
// prefix with) so the timeline never crashes on a new event type.

interface StageDef {
  id: StageId;
  label: string;
  /** Event types whose presence triggers / belongs to this stage. */
  events: ReadonlySet<string>;
}

const STAGE_DEFS: ReadonlyArray<StageDef> = [
  {
    id: 'prompt_received',
    label: 'Prompt received',
    events: new Set(['run_opened']),
  },
  {
    id: 'planning',
    label: 'Planning execution',
    events: new Set(['plan_created', 'plan_checkback_sent', 'plan_confirmed', 'plan_rejected']),
  },
  {
    id: 'plan_review',
    label: 'Plan Review Required',
    // Stage stays 'pending' (and visually skipped) when no checkback fires.
    // Becomes 'active' on plan_checkback_required and resolves on
    // plan_checkback_resolved (decision: allow|deny).
    events: new Set(['plan_checkback_required', 'plan_checkback_resolved']),
  },
  {
    id: 'delegation',
    label: 'Delegation issued',
    events: new Set(['orchestrator_dispatched', 'delegation_issued']),
  },
  {
    id: 'nvg_wall',
    label: 'NVG Wall — Model invocation',
    events: new Set(['node_dispatched', 'node_failed', 'node_timed_out', 'node_skipped']),
  },
  {
    id: 'agent_response',
    label: 'Agent response received',
    events: new Set([
      'partial_result',
      'node_completed',
      'dag_completed',
      'dag_failed',
      'dag_partial_complete',
    ]),
  },
  {
    id: 'compile',
    label: 'Compiling governed response',
    events: new Set([
      'compile_triggered',
      'compile_started',
      'compile_mode_selected',
      'compile_template_loaded',
      'compile_slot_matched',
      'compile_slot_missing',
      'compile_guard_fired',
      'compile_guard_halt',
      'compile_assembly_complete',
      'compile_skipped',
    ]),
  },
  {
    id: 'final_response',
    label: 'Governed Response',
    events: new Set(['final_response']),
  },
  {
    id: 'run_closed',
    label: 'Run closed',
    events: new Set(['run_closed']),
  },
];

// ─── Helpers ───────────────────────────────────────────────────────────────

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

function shortId(value: unknown): string {
  const s = str(value);
  if (!s) return '';
  return s.length > 8 ? s.slice(0, 8) + '…' : s;
}

/** Split a "<code>: <message>" failureReason into its parts. */
function splitFailure(reason: string | null): { code: string; message: string } {
  if (!reason) return { code: 'unknown', message: '' };
  const idx = reason.indexOf(':');
  if (idx < 0) return { code: reason.trim(), message: '' };
  return {
    code: reason.slice(0, idx).trim(),
    message: reason.slice(idx + 1).trim(),
  };
}

function bucketEvents(events: RunEvent[]): Map<StageId, RunEvent[]> {
  const buckets = new Map<StageId, RunEvent[]>();
  for (const def of STAGE_DEFS) buckets.set(def.id, []);

  for (const ev of events) {
    let placed = false;
    for (const def of STAGE_DEFS) {
      if (def.events.has(ev.type)) {
        buckets.get(def.id)!.push(ev);
        placed = true;
        break;
      }
    }
    if (!placed) {
      // Unknown event type — preserve under the closest known prefix so it
      // surfaces somewhere in the timeline rather than vanishing. The rule:
      // anything that starts with `compile_` rides Stage 6; anything starting
      // with `node_`/`dag_` rides Stage 4 or 5; otherwise it goes onto the
      // last-touched stage (best-effort visibility, never crash).
      // Spec §"WHAT'S FORBIDDEN" #2: log unknown types, do not crash.
      // eslint-disable-next-line no-console
      console.warn('[run-timeline] unknown event type — surfacing on last stage:', ev.type);
      const fallback: StageId = ev.type.startsWith('compile_')
        ? 'compile'
        : ev.type.startsWith('dag_')
          ? 'agent_response'
          : ev.type.startsWith('node_')
            ? 'nvg_wall'
            : 'run_closed';
      buckets.get(fallback)!.push(ev);
    }
  }
  return buckets;
}

// ─── Per-stage detail extraction ───────────────────────────────────────────
// Each branch reads ONLY the keys the producer actually writes (verified
// against runs/infra.run-ledger.jsonl). Missing keys fall back to dashes —
// never invent data (spec §"WHAT'S FORBIDDEN" #1, #6).

function describePrompt(events: RunEvent[]): string[] {
  const opened = events.find(e => e.type === 'run_opened');
  if (!opened?.detail) return [];
  const lines: string[] = [];
  const agentIds = opened.detail['selectedAgentIds'];
  if (Array.isArray(agentIds) && agentIds.length > 0) {
    lines.push(
      `Agent: ${shortId(agentIds[0])}${agentIds.length > 1 ? ` (+${agentIds.length - 1})` : ''}`
    );
  }
  const principalId = str(opened.detail['principalId']);
  if (principalId) lines.push(`Principal: ${shortId(principalId)}`);
  return lines;
}

function describePlanning(events: RunEvent[]): string[] {
  const created = events.find(e => e.type === 'plan_created');
  const lines: string[] = [];
  if (created?.detail) {
    const nodeCount = num(created.detail['nodeCount']);
    const planId = str(created.detail['planId']);
    if (planId) lines.push(`Plan: ${shortId(planId)}`);
    if (nodeCount !== null) lines.push(`Nodes: ${nodeCount}`);
  }
  return lines;
}

function describePlanReview(events: RunEvent[]): string[] {
  const required = events.find(e => e.type === 'plan_checkback_required');
  const resolved = events.find(e => e.type === 'plan_checkback_resolved');
  const lines: string[] = [];
  if (required?.detail) {
    const primary = str(required.detail['primaryTier']);
    const alt = str(required.detail['alternativeTier']);
    if (primary) lines.push(`Selected: ${primary}`);
    if (alt) lines.push(`Alternative: ${alt}`);
  }
  if (resolved?.detail) {
    const decision = str(resolved.detail['decision']);
    if (decision) lines.push(`Decision: ${decision}`);
    const reason = str(resolved.detail['reason']);
    if (reason) lines.push(`Reason: ${reason}`);
  }
  return lines;
}

function extractPendingCheckback(events: RunEvent[]): PendingCheckback | null {
  // The "pending" checkback is the most recent plan_checkback_required that
  // does NOT have a corresponding plan_checkback_resolved after it. Multiple
  // checkbacks per run are not expected today, but the resolver-after-marker
  // logic is correct for any sequence.
  let lastRequired: RunEvent | null = null;
  for (const ev of events) {
    if (ev.type === 'plan_checkback_required') lastRequired = ev;
    else if (ev.type === 'plan_checkback_resolved') lastRequired = null;
  }
  if (!lastRequired || !lastRequired.detail) return null;
  const detail = lastRequired.detail;
  const altEp = detail['alternativeEndpoint'] as
    | { endpointId?: unknown; modelName?: unknown; tier?: unknown }
    | null
    | undefined;
  return {
    primaryTier: str(detail['primaryTier']),
    primaryHealthy: detail['primaryHealthy'] === true,
    fallbackTier: str(detail['fallbackTier']),
    fallbackHealthy: detail['fallbackHealthy'] === true,
    alternativeTier: str(detail['alternativeTier']),
    alternativeEndpoint:
      altEp && typeof altEp === 'object'
        ? {
            endpointId: str(altEp.endpointId) ?? '',
            modelName: str(altEp.modelName) ?? '',
            tier: str(altEp.tier) ?? '',
          }
        : null,
    message: str(detail['message']) ?? 'Plan review required.',
    denialReason: str(detail['denialReason']),
  };
}

function describeDelegation(events: RunEvent[]): string[] {
  const dispatched = events.find(e => e.type === 'orchestrator_dispatched');
  const issued = events.find(e => e.type === 'delegation_issued');
  const lines: string[] = [];
  if (dispatched?.detail) {
    const agents = dispatched.detail['selectedAgents'];
    if (Array.isArray(agents) && agents.length > 0) {
      const a0 = agents[0] as Record<string, unknown> | undefined;
      const agentId = str(a0?.['agentId']);
      const slots = a0?.['expectedOutputSlots'];
      if (agentId) lines.push(`Agent: ${shortId(agentId)}`);
      if (Array.isArray(slots) && slots.length > 0) {
        lines.push(`Slots: [${slots.map(s => str(s) ?? '?').join(', ')}]`);
      }
    }
  }
  if (issued?.detail) {
    const delegationId = str(issued.detail['delegationId']);
    if (delegationId) lines.push(`Delegation: ${shortId(delegationId)}`);
  }
  return lines;
}

/**
 * CLAUDE-CODE-MODEL-PREFERENCE-TRANSPARENCY §4 — extract preference-vs-actual
 * model selection from `node_completed.completionMetadata`. Returns `null`
 * when no preference was supplied or the preference was honored — only the
 * substituted case produces detail. The metadata is written by
 * makeDispatchToGovernance (scripts/nexus-main.ts §5) and is on the wire
 * already; this reader is the UI surface for the operator.
 */
function describePreferenceSubstitution(completed: RunEvent | undefined, prefix: string): string[] {
  if (!completed?.detail) return [];
  const meta = completed.detail['completionMetadata'];
  if (!meta || typeof meta !== 'object') return [];
  const m = meta as Record<string, unknown>;
  if (m['preferenceHonored'] !== false) return [];
  const lines: string[] = [];
  const preferred = str(m['preferredEndpointId']);
  const actual = str(m['actualEndpointId']);
  const reason = str(m['switchReason']);
  if (prefix === 'nvg_wall') {
    if (preferred) lines.push(`Preferred: ${preferred}`);
    if (actual) lines.push(`Actual: ${actual}`);
    if (reason) lines.push(`Reason: ${reason.replace(/_/g, ' ')}`);
  } else {
    // agent_response stage: shorter signal, the NVG wall has the full breakdown.
    if (actual) lines.push(`⚠ Model substituted: ${actual}`);
  }
  return lines;
}

function describeNvg(
  events: RunEvent[],
  partial: RunEvent | undefined,
  completed: RunEvent | undefined
): string[] {
  const dispatched = events.find(e => e.type === 'node_dispatched');
  const lines: string[] = [];
  if (dispatched?.detail) {
    const agentId = str(dispatched.detail['agentId']);
    if (agentId) lines.push(`Agent: ${shortId(agentId)}`);
  }
  if (partial?.detail) {
    const classes = partial.detail['resultClassifications'];
    if (Array.isArray(classes) && classes.length > 0) {
      lines.push(`Classification: ${classes.map(c => str(c) ?? '?').join(', ')}`);
    }
    const responseSize = num(partial.detail['responseSize']);
    if (responseSize !== null) lines.push(`Response: ${responseSize} bytes`);
  }
  // Preference substitution surfaces under the green check — Option A.
  lines.push(...describePreferenceSubstitution(completed, 'nvg_wall'));
  return lines;
}

function describeAgentResponse(events: RunEvent[]): string[] {
  const partial = events.find(e => e.type === 'partial_result');
  const dag = events.find(e => e.type === 'dag_completed');
  const completed = events.find(e => e.type === 'node_completed');
  const lines: string[] = [];
  if (partial?.detail) {
    const mailboxItemId = str(partial.detail['mailboxItemId']);
    const slotId = str(partial.detail['slotId']);
    if (slotId) lines.push(`Slot: ${slotId}`);
    if (mailboxItemId) lines.push(`Mailbox: ${shortId(mailboxItemId)}`);
  }
  if (dag?.detail) {
    const completed = num(dag.detail['completedCount']);
    if (completed !== null) lines.push(`Nodes completed: ${completed}`);
  }
  lines.push(...describePreferenceSubstitution(completed, 'agent_response'));
  return lines;
}

function describeCompile(events: RunEvent[]): string[] {
  const modeSel = events.find(e => e.type === 'compile_mode_selected');
  const template = events.find(e => e.type === 'compile_template_loaded');
  const assembly = events.find(e => e.type === 'compile_assembly_complete');
  const skipped = events.find(e => e.type === 'compile_skipped');
  const lines: string[] = [];
  if (skipped?.detail) {
    const reason = str(skipped.detail['reason']);
    if (reason) lines.push(`Skipped: ${reason}`);
    return lines;
  }
  if (modeSel?.detail) {
    const mode = str(modeSel.detail['compileMode']);
    if (mode) lines.push(`Mode: ${mode}`);
  }
  if (template?.detail) {
    const tplId = str(template.detail['templateId']);
    if (tplId) lines.push(`Template: ${shortId(tplId)}`);
  }
  if (assembly?.detail) {
    const format = str(assembly.detail['format']);
    if (format) lines.push(`Format: ${format}`);
  }
  return lines;
}

function describeFinalResponse(events: RunEvent[]): {
  lines: string[];
  body: string | null;
  artifactId: string | null;
} {
  const final = events.find(e => e.type === 'final_response');
  if (!final?.detail) return { lines: [], body: null, artifactId: null };
  const lines: string[] = [];
  const artifactId = str(final.detail['artifactId']);
  if (artifactId) lines.push(`Artifact: ${shortId(artifactId)}`);
  const compileMode = str(final.detail['compileMode']);
  if (compileMode) lines.push(`Mode: ${compileMode}`);
  return {
    lines,
    body: str(final.detail['body']),
    artifactId,
  };
}

function describeRunClosed(closedEvent: RunEvent | undefined): {
  lines: string[];
  status: StageStatus;
  failureCode: string | null;
  failureMessage: string | null;
} {
  if (!closedEvent?.detail) {
    return { lines: [], status: 'pending', failureCode: null, failureMessage: null };
  }
  const closeReason = str(closedEvent.detail['closeReason']);
  const reason = str(closedEvent.detail['reason']);
  const error = str(closedEvent.detail['error']);
  const isSuccess = closeReason === 'completed' || closeReason === 'success';
  const lines: string[] = [];
  if (closeReason) lines.push(`Reason: ${closeReason}`);
  else if (reason) lines.push(`Reason: ${reason}`);
  if (error) lines.push(error);
  if (isSuccess) {
    return { lines, status: 'complete', failureCode: null, failureMessage: null };
  }
  // Non-success closure → error stage. Surface the most specific signal we have.
  const code = closeReason ?? reason ?? 'error';
  const message = error ?? reason ?? closeReason ?? '';
  return {
    lines,
    status: 'error',
    failureCode: code,
    failureMessage: message,
  };
}

// ─── Status determination ──────────────────────────────────────────────────

interface StageStatusContext {
  /** Stage events for this stage. */
  own: RunEvent[];
  /** Whether any later stage has at least one event. */
  hasLaterEvents: boolean;
  /** Whether run_closed has landed. */
  runClosed: boolean;
  /** Whether the run failed somewhere (anywhere in the timeline). */
  runFailed: boolean;
}

function statusForStage(stageId: StageId, ctx: StageStatusContext): StageStatus {
  const { own, hasLaterEvents, runClosed, runFailed } = ctx;

  // Stage-specific failure detection comes first — failure events are
  // unambiguous and must override the implicit-completion logic below.
  switch (stageId) {
    case 'planning': {
      if (own.some(e => e.type === 'plan_rejected')) return 'denied';
      break;
    }
    case 'plan_review': {
      const resolved = own.find(e => e.type === 'plan_checkback_resolved');
      if (resolved) {
        const decision = str(resolved.detail?.['decision']);
        if (decision === 'allow') return 'complete';
        if (decision === 'deny') return 'denied';
      }
      // plan_checkback_required without a resolution = active (waiting on user)
      if (own.some(e => e.type === 'plan_checkback_required')) return 'active';
      break;
    }
    case 'nvg_wall': {
      const failed = own.find(e => e.type === 'node_failed');
      if (failed) {
        const governanceDenied =
          (failed.detail?.['governanceDenied'] as boolean | undefined) === true;
        return governanceDenied ? 'denied' : 'error';
      }
      if (own.some(e => e.type === 'node_timed_out')) return 'error';
      if (own.some(e => e.type === 'node_skipped')) return 'skipped';
      break;
    }
    case 'agent_response': {
      if (own.some(e => e.type === 'dag_failed')) return 'error';
      break;
    }
    case 'compile': {
      if (own.some(e => e.type === 'compile_guard_halt')) return 'error';
      if (own.some(e => e.type === 'compile_skipped')) return 'skipped';
      break;
    }
    default:
      break;
  }

  // plan_review is opt-in: if no own events ever land for it, the stage is
  // 'skipped' (the orchestrator auto-approved without asking). Don't promote
  // it to 'complete' just because later stages have events.
  if (stageId === 'plan_review' && own.length === 0) {
    return hasLaterEvents ? 'skipped' : runClosed ? 'skipped' : 'pending';
  }

  // Implicit completion: any later stage having events means we passed
  // through this one cleanly (the orchestrator only advances on success).
  if (hasLaterEvents) return 'complete';

  // Stage-specific completion markers when no later stage has fired yet.
  if (own.length > 0) {
    switch (stageId) {
      case 'prompt_received':
        return 'complete'; // run_opened is a one-shot stage marker
      case 'planning':
        if (own.some(e => e.type === 'plan_confirmed')) return 'complete';
        return 'active';
      case 'delegation':
        if (own.some(e => e.type === 'delegation_issued')) return 'complete';
        return 'active';
      case 'nvg_wall':
        // node_dispatched fired but no terminal event yet → in-flight
        return 'active';
      case 'agent_response':
        if (own.some(e => e.type === 'dag_completed')) return 'complete';
        if (own.some(e => e.type === 'dag_partial_complete')) return 'complete';
        return 'active';
      case 'compile':
        if (own.some(e => e.type === 'compile_assembly_complete')) return 'complete';
        return 'active';
      case 'final_response':
        return 'complete';
      case 'run_closed':
        // Decided by describeRunClosed elsewhere; placeholder here.
        return 'complete';
    }
  }

  // No events for this stage. If the run failed earlier OR closed without
  // reaching here, this stage is 'pending' visually (gray). When the run
  // closed cleanly without us, treat as 'skipped' (e.g. compile_skipped path
  // can leave compile/final_response empty).
  if (runClosed && runFailed) return 'pending';
  if (runClosed) return 'skipped';
  return 'pending';
}

// ─── Public entrypoint ─────────────────────────────────────────────────────

export function computeRunTimeline(events: RunEvent[]): RunTimelineState {
  const buckets = bucketEvents(events);

  // Detect run-closed early so per-stage status can take it into account.
  const closedEvents = buckets.get('run_closed') ?? [];
  const closedEvent = closedEvents[closedEvents.length - 1];
  const runClosed = closedEvent !== undefined;

  // Determine whether the run failed anywhere — used to greyscale unreached
  // stages instead of marking them 'skipped'.
  const failureSignals = (() => {
    if (closedEvent) {
      const closeReason = str(closedEvent.detail?.['closeReason']);
      const reason = str(closedEvent.detail?.['reason']);
      if (closeReason && closeReason !== 'completed' && closeReason !== 'success') return true;
      if (!closeReason && reason && reason !== 'completed' && reason !== 'success') return true;
    }
    if ((buckets.get('planning') ?? []).some(e => e.type === 'plan_rejected')) return true;
    // Plan-review denial = user clicked Deny on the checkback card.
    if (
      (buckets.get('plan_review') ?? []).some(
        e => e.type === 'plan_checkback_resolved' && str(e.detail?.['decision']) === 'deny'
      )
    )
      return true;
    if (
      (buckets.get('nvg_wall') ?? []).some(
        e => e.type === 'node_failed' || e.type === 'node_timed_out'
      )
    )
      return true;
    if ((buckets.get('agent_response') ?? []).some(e => e.type === 'dag_failed')) return true;
    if ((buckets.get('compile') ?? []).some(e => e.type === 'compile_guard_halt')) return true;
    return false;
  })();

  const stages: RunStage[] = [];
  let firstFailure: RunTimelineState['failure'] = null;

  STAGE_DEFS.forEach((def, idx) => {
    const own = buckets.get(def.id) ?? [];
    const hasLaterEvents = STAGE_DEFS.slice(idx + 1).some(
      later => (buckets.get(later.id) ?? []).length > 0
    );

    let status = statusForStage(def.id, {
      own,
      hasLaterEvents,
      runClosed,
      runFailed: failureSignals,
    });

    // Detail extraction per stage.
    let detailLines: string[] = [];
    let failureCode: string | null = null;
    let failureMessage: string | null = null;

    switch (def.id) {
      case 'prompt_received':
        detailLines = describePrompt(own);
        break;
      case 'planning': {
        detailLines = describePlanning(own);
        if (status === 'denied') {
          const rejected = own.find(e => e.type === 'plan_rejected');
          const reason = str(rejected?.detail?.['reason']);
          const reasonDetail = str(rejected?.detail?.['reasonDetail']);
          failureCode = reason ?? 'plan_rejected';
          failureMessage = reasonDetail ?? '';
        }
        break;
      }
      case 'plan_review': {
        detailLines = describePlanReview(own);
        if (status === 'denied') {
          const resolved = own.find(e => e.type === 'plan_checkback_resolved');
          failureCode = str(resolved?.detail?.['reason']) ?? 'user_denied';
          const required = own.find(e => e.type === 'plan_checkback_required');
          failureMessage = str(required?.detail?.['message']) ?? '';
        }
        break;
      }
      case 'delegation':
        detailLines = describeDelegation(own);
        break;
      case 'nvg_wall': {
        const agentResponseBucket = buckets.get('agent_response') ?? [];
        const partial = agentResponseBucket.find(e => e.type === 'partial_result');
        // node_completed lives on the agent_response stage but its
        // completionMetadata describes what happened *at* the NVG wall — pass
        // it through so the model-substitution warning lands where the user
        // expects to see it (next to the "Classification / Response" lines).
        const completed = agentResponseBucket.find(e => e.type === 'node_completed');
        detailLines = describeNvg(own, partial, completed);
        if (status === 'denied' || status === 'error') {
          const failed = own.find(e => e.type === 'node_failed' || e.type === 'node_timed_out');
          const reasonStr = str(failed?.detail?.['failureReason']) ?? '';
          const split = splitFailure(reasonStr);
          failureCode = split.code || (failed?.type ?? 'node_failure');
          failureMessage = split.message;
        }
        if (status === 'active' && own.length > 0) {
          // While we're waiting for the model: show the in-flight phases.
          detailLines = [...detailLines, 'Classifying → Routing → Invoking model…'];
        }
        break;
      }
      case 'agent_response': {
        detailLines = describeAgentResponse(own);
        if (status === 'error') {
          const failed = own.find(e => e.type === 'dag_failed');
          const reason = str(failed?.detail?.['reason']);
          failureCode = reason ?? 'dag_failed';
          failureMessage = '';
        }
        break;
      }
      case 'compile': {
        detailLines = describeCompile(own);
        if (status === 'error') {
          const halt = own.find(e => e.type === 'compile_guard_halt');
          const haltReason = str(halt?.detail?.['reason']);
          failureCode = haltReason ?? 'compile_guard_halt';
          failureMessage = '';
        } else if (status === 'skipped') {
          const skipped = own.find(e => e.type === 'compile_skipped');
          const reason = str(skipped?.detail?.['reason']);
          failureCode = reason ?? 'compile_skipped';
          failureMessage = '';
        }
        break;
      }
      case 'final_response': {
        const fr = describeFinalResponse(own);
        detailLines = fr.lines;
        break;
      }
      case 'run_closed': {
        const rc = describeRunClosed(closedEvent);
        detailLines = rc.lines;
        if (own.length > 0 || runClosed) status = rc.status;
        if (rc.status === 'error') {
          failureCode = rc.failureCode;
          failureMessage = rc.failureMessage;
        }
        break;
      }
    }

    const startedAt = own.length > 0 ? (own[0]?.timestamp ?? null) : null;
    const completedAt =
      status === 'complete' || status === 'denied' || status === 'error' || status === 'skipped'
        ? (own[own.length - 1]?.timestamp ?? null)
        : null;

    if (firstFailure === null && (status === 'denied' || status === 'error')) {
      firstFailure = {
        stageId: def.id,
        code: failureCode ?? def.id,
        message: failureMessage ?? '',
        governanceDenied: status === 'denied',
      };
    }

    stages.push({
      id: def.id,
      label: def.label,
      status,
      startedAt,
      completedAt,
      detailLines,
      failureCode,
      failureMessage,
      events: own,
    });
  });

  // Run start / end timestamps for relative-time display.
  const allEvents = events.filter(e => typeof e.timestamp === 'string');
  const runStartedAt = allEvents[0]?.timestamp ?? null;
  const runEndedAt = closedEvent?.timestamp ?? allEvents[allEvents.length - 1]?.timestamp ?? null;

  // Final-response body / artifact id, threaded so the existing Governed
  // Response card can keep rendering the inline body without re-fetching.
  const finalDescribe = describeFinalResponse(buckets.get('final_response') ?? []);

  return {
    stages,
    runStartedAt: runStartedAt ?? null,
    runEndedAt: runEndedAt ?? null,
    closed: runClosed,
    failure: firstFailure,
    finalResponseBody: finalDescribe.body,
    finalArtifactId: finalDescribe.artifactId,
    pendingCheckback: extractPendingCheckback(events),
  };
}

/** Format milliseconds since runStartedAt as `Xs` (e.g. "0.0s", "4.1s"). */
export function formatStageOffset(
  stageStartIso: string | null,
  runStartIso: string | null
): string {
  if (!stageStartIso || !runStartIso) return '';
  const start = new Date(runStartIso).getTime();
  const at = new Date(stageStartIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(at)) return '';
  const seconds = Math.max(0, (at - start) / 1000);
  return seconds.toFixed(seconds < 10 ? 1 : 0) + 's';
}

/** Format an in-flight elapsed duration (used while a stage is 'active'). */
export function formatElapsed(stageStartIso: string | null, nowMs: number): string {
  if (!stageStartIso) return '';
  const start = new Date(stageStartIso).getTime();
  if (!Number.isFinite(start)) return '';
  const seconds = Math.max(0, (nowMs - start) / 1000);
  return seconds.toFixed(1) + 's elapsed';
}

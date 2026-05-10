// packages/workspace-ref/src/client/components/run-dag-section.tsx
//
// Per-node DAG visualization for multi-node planner runs.
// AMEND-spec-nexus-orch §5 extension.
//
// Renders only when timeline.dag.isMultiNode === true. The legacy
// single-prompt path keeps the existing single-stage timeline view,
// which is the right level of detail for a 1-node plan.
//
// Layout (Phase 1): a vertical list of node cards in planOrderIndex
// order, with each card showing per-node identity (subTaskKey / agent /
// nodeType), data-flow context (inputSlotReads / writtenSlots), and
// status (icon, tool-turn metadata when applicable, failure reason
// when failed). Edges are described inside each card's "Reads from"
// section rather than drawn between cards — this scales to any DAG
// topology (fan-out, fan-in, conditional) without graph-layout
// machinery, and matches the existing timeline aesthetic.
//
// Phase 2 may add a graph-layout view (slot-flow arrows, node
// positioning) when DAG shapes get complex enough to need it.

import type { RunDagNode, RunDagState, DagNodeStatus, DagNodeType } from './run-stage-reducer.js';
import { formatStageOffset } from './run-stage-reducer.js';

interface RunDagSectionProps {
  dag: RunDagState;
  runStartedAt: string | null;
}

const STATUS_GLYPH: Record<DagNodeStatus, string> = {
  pending: '○',
  dispatched: '◎',
  completed: '✓',
  failed: '✗',
  skipped: '–',
  timed_out: '⏱',
};

const NODE_TYPE_LABEL: Record<DagNodeType, string> = {
  nvg_dispatch: 'nvg',
  nxs_dispatch: 'nxs',
  local_control: 'local',
  secure_agent_handoff: 'secure',
};

const NODE_TYPE_HINT: Record<DagNodeType, string> = {
  nvg_dispatch: 'LLM model dispatch (round-trip enabled)',
  nxs_dispatch: 'Deterministic NXS action — no LLM',
  local_control: 'Orchestrator-local control node',
  secure_agent_handoff: 'OCT-redaction-aware agent handoff',
};

function shortId(value: string | null | undefined): string {
  if (!value) return '—';
  return value.length > 8 ? `${value.slice(0, 8)}…` : value;
}

export function RunDagSection({ dag, runStartedAt }: RunDagSectionProps) {
  if (!dag.isMultiNode) return null;

  return (
    <section className="nx-rundag" aria-label="Plan execution graph">
      <header className="nx-rundag__header">
        <h3 className="nx-rundag__title">Plan Execution</h3>
        <span className="nx-rundag__meta">
          {dag.nodes.length} nodes · {dag.edges.length} {dag.edges.length === 1 ? 'edge' : 'edges'}
        </span>
      </header>
      <ol className="nx-rundag__list">
        {dag.nodes.map((node, idx) => (
          <RunDagNodeCard
            key={node.nodeId}
            node={node}
            runStartedAt={runStartedAt}
            isLast={idx === dag.nodes.length - 1}
          />
        ))}
      </ol>
    </section>
  );
}

interface RunDagNodeCardProps {
  node: RunDagNode;
  runStartedAt: string | null;
  isLast: boolean;
}

function RunDagNodeCard({ node, runStartedAt, isLast }: RunDagNodeCardProps) {
  const offset = formatStageOffset(node.dispatchedAt ?? node.completedAt ?? null, runStartedAt);

  const titleParts: string[] = [];
  if (node.subTaskKey) titleParts.push(node.subTaskKey);
  else titleParts.push(`node ${node.planOrderIndex + 1}`);

  return (
    <li className={`nx-rundag-node nx-rundag-node--${node.status}`}>
      <div className="nx-rundag-node__rail" aria-hidden="true">
        <div className="nx-rundag-node__glyph">{STATUS_GLYPH[node.status]}</div>
        {!isLast && <div className="nx-rundag-node__connector" />}
      </div>

      <div className="nx-rundag-node__body">
        <div className="nx-rundag-node__head">
          <span className="nx-rundag-node__title">{titleParts.join(' ')}</span>
          <span
            className={`nx-rundag-node__type-badge nx-rundag-node__type-badge--${node.nodeType}`}
            title={NODE_TYPE_HINT[node.nodeType]}
          >
            {NODE_TYPE_LABEL[node.nodeType]}
          </span>
          {offset && <span className="nx-rundag-node__offset">{offset}</span>}
        </div>

        <div className="nx-rundag-node__summary">{node.taskSummary}</div>

        <dl className="nx-rundag-node__meta">
          <div className="nx-rundag-node__meta-row">
            <dt>Agent</dt>
            <dd title={node.agentId}>{shortId(node.agentId)}</dd>
          </div>
          <div className="nx-rundag-node__meta-row">
            <dt>Reads</dt>
            <dd>
              {node.inputSlotReads.length === 0 ? (
                <span className="nx-rundag-node__empty">— (root node)</span>
              ) : (
                <ul className="nx-rundag-node__reads">
                  {node.inputSlotReads.map((r, i) => (
                    <li key={i}>
                      <code>
                        {r.fromSubTaskKey}.{r.slotId}
                      </code>
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
          <div className="nx-rundag-node__meta-row">
            <dt>Writes</dt>
            <dd>
              {node.expectedOutputSlots.length === 0 ? (
                <span className="nx-rundag-node__empty">—</span>
              ) : (
                <ul className="nx-rundag-node__writes">
                  {node.expectedOutputSlots.map(slot => {
                    const written = node.writtenSlots.includes(slot);
                    return (
                      <li
                        key={slot}
                        className={
                          written
                            ? 'nx-rundag-node__slot nx-rundag-node__slot--written'
                            : 'nx-rundag-node__slot'
                        }
                        title={written ? 'mailbox item written for this slot' : 'expected slot'}
                      >
                        <code>{slot}</code>
                        {written ? ' ✓' : ''}
                      </li>
                    );
                  })}
                </ul>
              )}
            </dd>
          </div>

          {node.toolTurnCount !== null && (
            <div className="nx-rundag-node__meta-row">
              <dt>Tool turns</dt>
              <dd>
                {node.toolTurnCount}
                {node.toolCallsPerTurn && node.toolCallsPerTurn.length > 0 && (
                  <span className="nx-rundag-node__per-turn">
                    {' '}
                    · calls/turn: [{node.toolCallsPerTurn.join(', ')}]
                  </span>
                )}
                {node.capReached && (
                  <span className="nx-rundag-node__cap-warning"> ⚠ cap reached</span>
                )}
              </dd>
            </div>
          )}
        </dl>

        {(node.status === 'failed' || node.status === 'timed_out') && node.failureReason && (
          <div className="nx-rundag-node__failure">
            <span className="nx-rundag-node__failure-label">
              {node.governanceDenied ? '⛔ governance' : '✗ failed'}
            </span>
            <span className="nx-rundag-node__failure-reason"> · {node.failureReason}</span>
          </div>
        )}
      </div>
    </li>
  );
}

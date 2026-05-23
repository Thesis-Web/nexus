/**
 * F4.11 unit tests for the payload-label aggregator + provenance helpers.
 *
 * Covers:
 *   - provenanceFromSourceType mapping per spec §2.1
 *   - resolveAggregatedProvenance picks the LEAST-trusted source
 *   - aggregatePayloadLabels unions item classifications + binding floor
 *   - empty-items returns 'unknown' provenance (so NVG quarantines)
 *   - isTrustedProvenance matches the spec §3.3 trusted set
 */
import { describe, it, expect } from 'vitest';
import type { DataClass, DataLabel, MailboxItem, OutputSourceType } from '@nexus/contracts';
import {
  aggregatePayloadLabels,
  isTrustedProvenance,
  provenanceFromSourceType,
  resolveAggregatedProvenance,
  TRUSTED_PROVENANCE_SOURCES,
} from './payload-labels.js';

type AggItem = Pick<MailboxItem, 'mailboxItemId' | 'resultClassifications' | 'provenance'>;

function makeItem(id: string, classes: DataClass[], provenance: AggItem['provenance']): AggItem {
  return {
    mailboxItemId: id as any,
    resultClassifications: classes,
    provenance,
  };
}

describe('provenanceFromSourceType', () => {
  it('maps nxs_execution_result → nxs_connector_result (trusted gate output)', () => {
    expect(provenanceFromSourceType('nxs_execution_result')).toBe('nxs_connector_result');
  });

  it('maps nvg_result → nvg_model_result (trusted gate output, component outline §C.2)', () => {
    expect(provenanceFromSourceType('nvg_result')).toBe('nvg_model_result');
  });

  it('maps agent_partial → agent_output (untrusted post-gate writer)', () => {
    expect(provenanceFromSourceType('agent_partial')).toBe('agent_output');
  });

  it('is total over OutputSourceType — no fallthrough', () => {
    const sources: OutputSourceType[] = ['nvg_result', 'nxs_execution_result', 'agent_partial'];
    for (const src of sources) {
      expect(provenanceFromSourceType(src)).toMatch(/^[a-z_]+$/);
    }
  });
});

describe('resolveAggregatedProvenance', () => {
  it('returns unknown for empty input (forces §3.3 quarantine)', () => {
    expect(resolveAggregatedProvenance([])).toBe('unknown');
  });

  it('returns the only source when items have a single provenance', () => {
    expect(resolveAggregatedProvenance([makeItem('a', ['public'], 'nxs_connector_result')])).toBe(
      'nxs_connector_result'
    );
  });

  it('picks the LEAST trusted across mixed provenance (weakest link wins)', () => {
    expect(
      resolveAggregatedProvenance([
        makeItem('a', ['public'], 'nxs_connector_result'),
        makeItem('b', ['internal'], 'agent_output'),
      ])
    ).toBe('agent_output');
  });

  it('demotes to unknown when any item is unknown', () => {
    expect(
      resolveAggregatedProvenance([
        makeItem('a', ['public'], 'workspace_upload'),
        makeItem('b', [], 'unknown'),
      ])
    ).toBe('unknown');
  });

  it('contributes additionalSources alongside item provenances (weakest wins)', () => {
    // Downstream leg: upstream agent_output items + user-prompt
    // contribution workspace_upload → weakest is agent_output. The
    // upstream items' labels keep the §3.3 case split from firing.
    expect(
      resolveAggregatedProvenance(
        [makeItem('a', ['internal'], 'agent_output')],
        ['workspace_upload']
      )
    ).toBe('agent_output');
  });

  it('returns the additionalSources weakest when items are empty', () => {
    // Chat first-leg path: no upstream items, the user prompt
    // contribution is `workspace_prompt`. The aggregator returns
    // workspace_prompt (trusted), letting NVG §3.3 floor empty-labels
    // dispatches to 'internal' rather than quarantining as unknown.
    expect(resolveAggregatedProvenance([], ['workspace_prompt'])).toBe('workspace_prompt');
  });

  it('preserves the workspace_upload path for file uploads bound to a run', () => {
    expect(resolveAggregatedProvenance([], ['workspace_upload'])).toBe('workspace_upload');
  });

  it('keeps workspace_prompt and workspace_upload distinct in the aggregate', () => {
    // Same trust tier (3) but distinct provenance sources. When the
    // aggregator encounters peer-trust entries, ties are stable on the
    // first encountered candidate — both are equally trusted, so either
    // answer is correct, but the helper must NOT collapse them to a
    // single identity.
    expect(resolveAggregatedProvenance([], ['workspace_prompt'])).not.toBe('workspace_upload');
    expect(resolveAggregatedProvenance([], ['workspace_upload'])).not.toBe('workspace_prompt');
  });

  it('picks the LEAST trusted across multiple additionalSources', () => {
    expect(resolveAggregatedProvenance([], ['workspace_prompt', 'agent_output'])).toBe(
      'agent_output'
    );
  });

  it('falls back to unknown when items + additionalSources are both empty', () => {
    expect(resolveAggregatedProvenance([], [])).toBe('unknown');
  });
});

describe('aggregatePayloadLabels', () => {
  it('returns [] when items + boundConnectorClasses are both empty', () => {
    expect(aggregatePayloadLabels([], [])).toEqual([]);
  });

  it('emits one DataLabel per (item, class) pair', () => {
    const labels: DataLabel[] = aggregatePayloadLabels(
      [makeItem('item-1', ['public', 'internal'], 'nxs_connector_result')],
      []
    );
    expect(labels).toHaveLength(2);
    expect(labels.every(l => l.source === 'mailbox_item:item-1')).toBe(true);
    expect(labels.map(l => l.label).sort()).toEqual(['internal', 'public']);
  });

  it('emits one DataLabel per bound connector class with `connector_binding` source', () => {
    const labels = aggregatePayloadLabels([], ['internal' as DataClass, 'pii' as DataClass]);
    expect(labels).toHaveLength(2);
    expect(labels.every(l => l.source === 'connector_binding')).toBe(true);
    expect(labels.every(l => l.confidence === 0.95)).toBe(true);
  });

  it('items + binding contribute together', () => {
    const labels = aggregatePayloadLabels(
      [makeItem('item-1', ['public'], 'nxs_connector_result')],
      ['internal' as DataClass]
    );
    expect(labels).toHaveLength(2);
    expect(labels.map(l => l.source).sort()).toEqual(['connector_binding', 'mailbox_item:item-1']);
  });

  it('mailbox-derived labels carry confidence 1.0', () => {
    const [label] = aggregatePayloadLabels(
      [makeItem('item-1', ['public'], 'nxs_connector_result')],
      []
    );
    expect(label!.confidence).toBe(1.0);
  });
});

describe('isTrustedProvenance + TRUSTED_PROVENANCE_SOURCES', () => {
  it('matches the component outline §C.2 trusted set', () => {
    expect(TRUSTED_PROVENANCE_SOURCES).toEqual(
      new Set([
        'nxs_connector_result',
        'nvg_model_result',
        'workspace_upload',
        'workspace_prompt',
        'planner_history',
      ])
    );
  });

  it('returns true for trusted sources', () => {
    expect(isTrustedProvenance('nxs_connector_result')).toBe(true);
    expect(isTrustedProvenance('nvg_model_result')).toBe(true);
    expect(isTrustedProvenance('workspace_upload')).toBe(true);
    expect(isTrustedProvenance('workspace_prompt')).toBe(true);
    expect(isTrustedProvenance('planner_history')).toBe(true);
  });

  it('returns false for untrusted / unknown sources', () => {
    expect(isTrustedProvenance('agent_output')).toBe(false);
    expect(isTrustedProvenance('unknown')).toBe(false);
  });
});

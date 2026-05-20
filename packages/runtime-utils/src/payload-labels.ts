/**
 * F4.11 — NVG payload-label aggregation helpers (Hard Law #6).
 *
 * Layer 2 runtime helpers used by orch and any future mailbox writer to
 * derive `DataLabel[]` and `ProvenanceSource` for an NVG dispatch from
 * the upstream mailbox items the dispatch slice references.
 *
 * The spec mandates baked enforcement: NVG's classify-and-route gate
 * fails closed on empty labels + untrusted provenance. The aggregator
 * here is the single canonical surface so every dispatch site computes
 * the same way — no dispatch path may construct `dataLabels: []` ad-hoc
 * (CI gate GOV-05 enforces).
 *
 * runtime-utils boundary: imports from @nexus/contracts only.
 */
import type {
  DataClass,
  DataLabel,
  MailboxItem,
  NonEmpty,
  OutputSourceType,
  ProvenanceSource,
} from '@nexus/contracts';

/**
 * Map a MailboxItem's OutputSourceType to a ProvenanceSource per spec
 * §2.1. NVG return payloads (model output) and agent partials both
 * resolve to `agent_output` since the model's output IS the agent's
 * surface to compile; NXS connector results are trusted because the
 * NXS bridge populated them from a connector dispatch the planner
 * already authorized.
 *
 * 'workspace_upload' and 'planner_history' are reachable only from
 * future writers (attachment binder, multi-turn chat-history loader)
 * neither of which has a production code path today.
 */
export function provenanceFromSourceType(sourceType: OutputSourceType): ProvenanceSource {
  switch (sourceType) {
    case 'nxs_execution_result':
      return 'nxs_connector_result';
    case 'nvg_result':
    case 'agent_partial':
      return 'agent_output';
  }
}

/**
 * Trust ranking — higher index = more trusted. Used by
 * `resolveAggregatedProvenance` to select the dominant provenance
 * across multiple upstream items. The aggregate picks the LEAST
 * trusted of the contributing sources so the empty-labels case split
 * (§3.3) reflects the weakest link.
 */
const PROVENANCE_TRUST_RANK: Record<ProvenanceSource, number> = {
  unknown: 0,
  agent_output: 1,
  planner_history: 2,
  workspace_upload: 3,
  nxs_connector_result: 4,
};

/**
 * Compute the aggregate provenance for an NVG dispatch from the
 * upstream MailboxItems the slice reads. Returns the LEAST trusted
 * source — i.e. one untrusted item poisons the aggregate so the gate
 * sees the weakest claim. If `items` is empty the aggregate is
 * `unknown` (no provenance to point to) so the gate's §3.3 case split
 * quarantines in enforce mode.
 */
export function resolveAggregatedProvenance(
  items: ReadonlyArray<Pick<MailboxItem, 'provenance'>>
): ProvenanceSource {
  if (items.length === 0) return 'unknown';
  let weakest: ProvenanceSource = items[0]!.provenance;
  for (let i = 1; i < items.length; i++) {
    const candidate = items[i]!.provenance;
    if (PROVENANCE_TRUST_RANK[candidate] < PROVENANCE_TRUST_RANK[weakest]) {
      weakest = candidate;
    }
  }
  return weakest;
}

/**
 * Convert a DataClass to a fixture DataLabel entry. The `source`
 * string carries the provenance + axis tag so audit can reconstruct
 * which upstream item contributed each label; `confidence` is 1.0
 * for items that came from an actual writer (mailbox content) and
 * 0.95 for the binding-axis floor derived from connector classes
 * (slightly lower because it is policy-derived rather than payload-
 * derived).
 */
function dataLabelFromMailbox(item: Pick<MailboxItem, 'mailboxItemId'>, cls: DataClass): DataLabel {
  return {
    source: `mailbox_item:${item.mailboxItemId}` as NonEmpty,
    label: cls,
    confidence: 1.0,
  };
}

function dataLabelFromConnectorBinding(cls: DataClass): DataLabel {
  return {
    source: 'connector_binding' as NonEmpty,
    label: cls,
    confidence: 0.95,
  };
}

/**
 * Aggregate every contributing DataClass into a DataLabel[] for the
 * NVG dispatch. Sources are the union of:
 *   - per-item `resultClassifications` from each upstream mailbox item
 *   - the agent's bound connector classes (binding-axis floor §24.2)
 *
 * The result is deduplicated by `(source, label)` pair so the same
 * mailbox item contributing two distinct DataClasses produces two
 * labels but the same DataClass from two items produces two entries
 * (each with its own provenance source string) — NVG's classifier
 * reads them as evidence of the same class from multiple paths.
 *
 * Empty `items` + empty `boundConnectorClasses` returns `[]`; the
 * caller pairs the empty result with `resolveAggregatedProvenance`
 * (which will be 'unknown' on no items) so NVG's §3.3 case split
 * applies the right denial / floor.
 */
export function aggregatePayloadLabels(
  items: ReadonlyArray<Pick<MailboxItem, 'mailboxItemId' | 'resultClassifications'>>,
  boundConnectorClasses: ReadonlyArray<DataClass>
): DataLabel[] {
  const labels: DataLabel[] = [];
  for (const item of items) {
    for (const cls of item.resultClassifications) {
      labels.push(dataLabelFromMailbox(item, cls));
    }
  }
  for (const cls of boundConnectorClasses) {
    labels.push(dataLabelFromConnectorBinding(cls));
  }
  return labels;
}

/**
 * Pre-defined trusted-provenance set used by the NVG case split.
 * Exported so NVG and the CI gate share one canonical list.
 */
export const TRUSTED_PROVENANCE_SOURCES: ReadonlySet<ProvenanceSource> = new Set([
  'nxs_connector_result',
  'workspace_upload',
  'planner_history',
]);

export function isTrustedProvenance(p: ProvenanceSource): boolean {
  return TRUSTED_PROVENANCE_SOURCES.has(p);
}

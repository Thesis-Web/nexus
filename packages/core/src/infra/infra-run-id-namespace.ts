/**
 * InfraRunIdNamespace — Q13 / F4.13.
 *
 * Daily-bucket + monotonic-sequence run id for every infra event
 * (admin mutation, secret rotation, hot reload, config write). The
 * shape `infra-YYYY-MM-DD-NNNN` lets audit cross-correlate every
 * write inside a single admin action via the date bucket; the
 * monotonic seq disambiguates concurrent writes within the day.
 *
 * Production wires one process-singleton InfraRunIdNamespace into
 * every admin-writer route + secret rotator + config-watcher. The
 * previous randomUUID() pattern lost the date-bucket continuity.
 */
import type { InfraRunIdNamespace, NonEmpty } from '@nexus/contracts';

export interface InfraRunIdNamespaceDeps {
  /** Optional seed seq for deterministic tests. */
  readonly initialSeq?: number;
  /** Override for deterministic tests; default = new Date(). */
  readonly clock?: () => Date;
}

export class InMemoryInfraRunIdNamespace implements InfraRunIdNamespace {
  private byDate = new Map<string, number>();
  private readonly clock: () => Date;
  constructor(deps: InfraRunIdNamespaceDeps = {}) {
    this.clock = deps.clock ?? (() => new Date());
    if (deps.initialSeq !== undefined) {
      const today = this.dateKey(this.clock());
      this.byDate.set(today, deps.initialSeq);
    }
  }
  next(date?: Date): NonEmpty {
    const d = date ?? this.clock();
    const key = this.dateKey(d);
    const seq = (this.byDate.get(key) ?? 0) + 1;
    this.byDate.set(key, seq);
    const padded = seq.toString().padStart(4, '0');
    return `infra-${key}-${padded}` as NonEmpty;
  }
  private dateKey(d: Date): string {
    return d.toISOString().slice(0, 10);
  }
}

/**
 * NVG JSONL Routing Trail Backend — spec §27.2
 * Append-only JSONL persistence for the Routing Provenance Trail.
 * HOLE-SPEC-002: §27.2 pins this file but §6.1 does not list it.
 *
 * This module provides the canonical §27.2 combined backend class
 * (JsonlRoutingTrailBackend) that implements both RoutingTrailWriter
 * and RoutingTrailReader, plus re-exports the existing separate
 * writer/reader classes for backward compatibility.
 *
 * Layer 3 — imports from @nexus/contracts only.
 */
import {
  type RoutingProvenanceTrailEntry,
  type RoutingTrailWriter,
  type RoutingTrailReader,
  type Uuid,
} from '@nexus/contracts';
import { promises as fs } from 'fs';
import * as path from 'path';

// Re-export existing classes for backward compatibility
export {
  JsonlRoutingTrailWriter,
  JsonlRoutingTrailReader,
} from './routing-provenance-trail-writer.js';

/**
 * §27.2 — Combined JSONL backend implementing both writer and reader.
 * Append-only. One JSONL file per trail directory.
 */
export class JsonlRoutingTrailBackend implements RoutingTrailWriter, RoutingTrailReader {
  private readonly trailPath: string;

  constructor(trailDir: string) {
    this.trailPath = path.join(trailDir, '13-routing-provenance-trail.jsonl');
  }

  async append(entry: RoutingProvenanceTrailEntry): Promise<void> {
    await fs.mkdir(path.dirname(this.trailPath), { recursive: true });
    await fs.appendFile(this.trailPath, JSON.stringify(entry) + '\n', 'utf-8');
  }

  async getByRunId(runId: Uuid): Promise<RoutingProvenanceTrailEntry[]> {
    return (await this.readAll()).filter(e => e.runId === runId);
  }

  async getByCorrelationId(correlationId: Uuid): Promise<RoutingProvenanceTrailEntry[]> {
    return (await this.readAll()).filter(e => e.correlationId === correlationId);
  }

  async tail(n: number): Promise<RoutingProvenanceTrailEntry[]> {
    const all = await this.readAll();
    return all.slice(-n);
  }

  private async readAll(): Promise<RoutingProvenanceTrailEntry[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.trailPath, 'utf-8');
    } catch {
      return [];
    }
    const results: RoutingProvenanceTrailEntry[] = [];
    for (const line of raw.trim().split('\n').filter(Boolean)) {
      try {
        results.push(JSON.parse(line) as RoutingProvenanceTrailEntry);
      } catch (err) {
        // NVG-RPT-003 FIX: log malformed line instead of silent skip
        console.error(
          `[JsonlRoutingTrailBackend] malformed trail line skipped: ${(err as Error).message}`
        );
        continue;
      }
    }
    return results;
  }
}

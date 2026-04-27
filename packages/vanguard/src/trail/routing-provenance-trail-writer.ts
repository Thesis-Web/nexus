/**
 * NVG Routing Provenance Trail Writer — spec §27
 * Append-only. JSONL file per run.
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

export class JsonlRoutingTrailWriter implements RoutingTrailWriter {
  private readonly entries: RoutingProvenanceTrailEntry[] = [];

  constructor(private readonly outputDir: string) {}

  async append(entry: RoutingProvenanceTrailEntry): Promise<void> {
    this.entries.push(entry);
    const filePath = path.join(this.outputDir, '13-routing-provenance-trail.jsonl');
    await fs.mkdir(this.outputDir, { recursive: true });
    await fs.appendFile(filePath, JSON.stringify(entry) + '\n', 'utf-8');
  }
}

export class JsonlRoutingTrailReader implements RoutingTrailReader {
  constructor(private readonly outputDir: string) {}

  async getByRunId(runId: Uuid): Promise<RoutingProvenanceTrailEntry[]> {
    const entries = await this.readAll();
    return entries.filter(e => e.runId === runId);
  }

  async getByCorrelationId(correlationId: Uuid): Promise<RoutingProvenanceTrailEntry[]> {
    const entries = await this.readAll();
    return entries.filter(e => e.correlationId === correlationId);
  }

  async tail(n: number): Promise<RoutingProvenanceTrailEntry[]> {
    const entries = await this.readAll();
    return entries.slice(-n);
  }

  private async readAll(): Promise<RoutingProvenanceTrailEntry[]> {
    const filePath = path.join(this.outputDir, '13-routing-provenance-trail.jsonl');
    let raw: string;
    try {
      raw = await fs.readFile(filePath, 'utf-8');
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
          `[JsonlRoutingTrailReader] malformed trail line skipped: ${(err as Error).message}`
        );
        continue;
      }
    }
    return results;
  }
}

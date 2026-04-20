/**
 * NVG service bootstrap — HOLE-S7-001 solve
 * Constructs Layer 3 (vanguard) service instances for CLI command injection.
 * This file is the only CLI module that imports @nexus/vanguard.
 * Command files depend on Layer 2 interfaces only.
 */
import { NvgServiceImpl, JsonlRoutingTrailReader } from '@nexus/vanguard';
import type { NvgService, RoutingTrailReader } from '@nexus/contracts';
import * as path from 'path';

const DEFAULT_TRAIL_DIR = path.join(process.cwd(), 'runs');

export function createNvgService(): NvgService {
  return new NvgServiceImpl();
}

export function createTrailReader(trailDir?: string): RoutingTrailReader {
  return new JsonlRoutingTrailReader(trailDir ?? DEFAULT_TRAIL_DIR);
}

/**
 * Threat log — spec §17
 * In-memory threat event accumulator per pipeline run.
 * Written into EvidenceRecord.threatEvents at Gate 07.
 */
import type { ThreatEvent, ThreatType, GateId } from '../types/index.js';
import { truncate } from '../utils/helpers.js';

export function buildThreatEvent(
  threatType: ThreatType,
  gateId: GateId | 'ingress',
  detail: string
): ThreatEvent {
  return {
    threatType,
    detectedAt: new Date().toISOString(),
    gateId,
    detail: truncate(detail, 300),
  };
}

/**
 * InvocationAttempt — spec §12.3.44
 *
 * File: packages/contracts/src/interfaces/invocation-attempt.ts
 *
 * Failed attempt record for trail-visible same-tier retry and cross-tier
 * fallback. Captured in NvgInvocationResult.priorAttempts to provide
 * full forensic visibility of all endpoints tried before the final result.
 *
 * NVG-RPT-002 enrichment: tier, adapterId, modelName carried from
 * ModelEndpoint at push time so trail entries are self-contained.
 */
import type { NonEmpty, IsoTimestamp } from '../types/index.js';

export interface InvocationAttempt {
  /** endpointId of the endpoint that was tried */
  readonly endpointUsed: NonEmpty;
  /** Model tier of the attempted endpoint (§24.5 forensics) */
  readonly tier?: NonEmpty;
  /** Transport adapter wire-format family (§12.3.37 forensics) */
  readonly adapterId?: NonEmpty;
  /** Provider-side model name from manifest (§22.1 forensics) */
  readonly modelName?: NonEmpty;
  /** Governed denial code that caused the failure */
  readonly denialCode: string;
  /** Human-readable failure reason */
  readonly reason: string;
  /** Response size in bytes, if available */
  readonly responseSize?: number;
  /** Latency of this attempt in milliseconds */
  readonly latencyMs: number;
  /** Timestamp when this attempt was made */
  readonly attemptedAt: IsoTimestamp;
}

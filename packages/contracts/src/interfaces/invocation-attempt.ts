/**
 * InvocationAttempt — spec §12.3.44
 *
 * File: packages/contracts/src/interfaces/invocation-attempt.ts
 *
 * Failed attempt record for trail-visible same-tier retry and cross-tier
 * fallback. Captured in NvgInvocationResult.priorAttempts to provide
 * full forensic visibility of all endpoints tried before the final result.
 */
import type { NonEmpty, IsoTimestamp } from '../types/index.js';

export interface InvocationAttempt {
  /** endpointId of the endpoint that was tried */
  readonly endpointUsed: NonEmpty;
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

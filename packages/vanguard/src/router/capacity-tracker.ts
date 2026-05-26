/**
 * CapacityTracker — Phase 8 (NVG endpoint concurrency tracking)
 *
 * Tracks the number of in-flight requests against each NVG endpoint so
 * the model-router can skip saturated endpoints (those at
 * `maxConcurrentRequests`) in favor of the next healthy endpoint in
 * the same lawful tier. NVG NEVER widens tier on capacity exhaustion;
 * widening would bypass the OCT ceiling.
 *
 * ── Port design (BAKED, plug-and-play driver) ───────────────────────────
 *
 * The interface is a port; the in-process driver below is V1's default.
 * Future deployments that run Nexus across multiple processes / nodes
 * (e.g., horizontally-scaled gateway) plug in a `RedisCapacityTracker`
 * (or `DurableObjectsCapacityTracker`, etc.) that satisfies the same
 * contract — call sites in `model-router.ts` and `nvg-service.ts` do not
 * change. The composition root picks the driver at boot.
 *
 * V1 deployment is single-process (one `pnpm nexus serve` per
 * deployment). InProcessCapacityTracker is correct for that shape and
 * mirrors the pattern already used by:
 *   - packages/core/src/security/rate-limiter.ts (NXS RateLimiter)
 *   - packages/vanguard/src/router/tier-registry.ts (unhealthySince Map)
 * Both explicitly document their single-process limitation; this file
 * does the same.
 *
 * ── Multi-process upgrade path ──────────────────────────────────────────
 *
 * When the deployment moves to multi-process / multi-node:
 *   1. Implement a `RedisCapacityTracker implements CapacityTracker`.
 *      `tryAcquire` becomes an atomic Lua script (INCR + check vs cap;
 *      DECR on rollback). `release` is DECR with a floor at zero.
 *      `getInflight` is GET.
 *   2. Wire the new driver in `scripts/nexus-main.ts` Step where
 *      `new InProcessCapacityTracker()` is constructed today.
 *   3. NO call-site changes in `model-router.ts` or `nvg-service.ts`.
 *
 * The Manifest Manifold arc (post-Phase-B) will formalize plug-and-play
 * for this driver alongside the other 13 plug-in categories. Until
 * then the swap is a single-line composition-root edit.
 */

/**
 * Result of an acquire attempt. `acquired: true` means the slot was
 * reserved and the caller MUST call `release(endpointId)` (typically in
 * a finally block) after the request completes (success OR failure).
 *
 * `acquired: false` means the endpoint is at `maxConcurrentRequests`;
 * the caller skips this endpoint and tries the next one in the lawful
 * tier (or enters the bounded backoff retry loop if all are saturated).
 *
 * `currentInflight` is informational — the model-router includes it in
 * the `nvg_endpoint_skipped_saturated` audit event so audit can
 * reconstruct the saturation level at attempt time.
 */
export interface CapacityAcquireResult {
  readonly acquired: boolean;
  readonly currentInflight: number;
  readonly maxConcurrent: number;
}

export interface CapacityTracker {
  /**
   * Attempt to reserve one in-flight slot for `endpointId`. When
   * `maxConcurrentRequests` is undefined (manifest didn't declare it),
   * the runtime applies the default capacity (see `DEFAULT_MAX_CONCURRENT`).
   *
   * Atomic at the driver level: in-process via JavaScript's single-
   * threaded event loop; Redis via Lua INCR+CHECK.
   */
  tryAcquire(endpointId: string, maxConcurrentRequests: number | undefined): CapacityAcquireResult;

  /**
   * Release one in-flight slot for `endpointId`. MUST be called in a
   * finally block after a successful `tryAcquire`. Releasing a slot
   * that was never acquired is a no-op (floor at zero) — this keeps
   * the contract idempotent for adapter-failure cleanup paths.
   */
  release(endpointId: string): void;

  /**
   * Inspect the current in-flight count for `endpointId`. Used by audit
   * events (RoutingTrailEntry.concurrencyAtAttempt) and by tests.
   */
  getInflight(endpointId: string): number;
}

/**
 * Default cap applied when an endpoint manifest entry has no explicit
 * `maxConcurrentRequests`. Conservative — favors avoiding saturation
 * over throughput. Admins set per-endpoint values via the model-
 * endpoint-setup-panel (Phase 8 admin UI). Override the global default
 * with the `NEXUS_NVG_DEFAULT_MAX_CONCURRENT` env var at boot.
 */
export const DEFAULT_MAX_CONCURRENT = 4;

/**
 * In-process driver. Suitable for V1's single-process deployment.
 * NOT safe across multiple processes / nodes (each process has its own
 * Map). For multi-process, swap to RedisCapacityTracker (see file
 * header for the upgrade path).
 */
export class InProcessCapacityTracker implements CapacityTracker {
  private readonly inFlight = new Map<string, number>();
  private readonly defaultMax: number;

  constructor(opts?: { defaultMax?: number }) {
    const envDefault = process.env['NEXUS_NVG_DEFAULT_MAX_CONCURRENT'];
    const parsed = envDefault !== undefined ? Number.parseInt(envDefault, 10) : NaN;
    this.defaultMax =
      opts?.defaultMax ?? (Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_CONCURRENT);
  }

  tryAcquire(endpointId: string, maxConcurrentRequests: number | undefined): CapacityAcquireResult {
    const cap =
      maxConcurrentRequests !== undefined && maxConcurrentRequests > 0
        ? maxConcurrentRequests
        : this.defaultMax;
    const current = this.inFlight.get(endpointId) ?? 0;
    if (current >= cap) {
      return { acquired: false, currentInflight: current, maxConcurrent: cap };
    }
    this.inFlight.set(endpointId, current + 1);
    return { acquired: true, currentInflight: current + 1, maxConcurrent: cap };
  }

  release(endpointId: string): void {
    const current = this.inFlight.get(endpointId) ?? 0;
    if (current <= 1) {
      this.inFlight.delete(endpointId);
    } else {
      this.inFlight.set(endpointId, current - 1);
    }
  }

  getInflight(endpointId: string): number {
    return this.inFlight.get(endpointId) ?? 0;
  }
}

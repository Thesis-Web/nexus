/**
 * NVG Model Health Monitor — spec §24.5
 * Tracks endpoint health. POC uses in-memory state.
 * Layer 3 — imports from @nexus/contracts only.
 */
import { type ModelEndpoint, type IsoTimestamp } from '@nexus/contracts';

export class ModelHealthMonitor {
  private readonly endpoints: Map<string, ModelEndpoint> = new Map();

  register(endpoint: ModelEndpoint): void {
    this.endpoints.set(endpoint.endpointId, endpoint);
  }

  markHealthy(endpointId: string): void {
    const ep = this.endpoints.get(endpointId);
    if (ep) {
      ep.healthy = true;
      ep.lastCheckAt = new Date().toISOString() as IsoTimestamp;
    }
  }

  markUnhealthy(endpointId: string): void {
    const ep = this.endpoints.get(endpointId);
    if (ep) {
      ep.healthy = false;
      ep.lastCheckAt = new Date().toISOString() as IsoTimestamp;
    }
  }

  getEndpoints(): ModelEndpoint[] {
    return [...this.endpoints.values()];
  }

  getHealthy(): ModelEndpoint[] {
    return [...this.endpoints.values()].filter(e => e.healthy);
  }
}

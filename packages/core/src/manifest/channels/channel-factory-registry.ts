/**
 * ApprovalChannelFactoryRegistry — spec §12.3.47, §12.3.48
 *
 * File: packages/core/src/manifest/channels/channel-factory-registry.ts
 * Layer 1 — imports from @nexus/contracts only.
 *
 * §12.3.48 behavior law:
 *   - Duplicate registration throws (invariant 1)
 *   - Unknown channelType returns null on get (invariant 2: loader fails closed)
 *   - Registration before manifest load — bootstrap order (invariant 3)
 *   - NOT hot-reloadable (invariant 4)
 */
import type {
  ApprovalChannelFactory,
  ApprovalChannelFactoryRegistry as IApprovalChannelFactoryRegistry,
} from '@nexus/contracts';

export class ApprovalChannelFactoryRegistry implements IApprovalChannelFactoryRegistry {
  private readonly factories = new Map<string, ApprovalChannelFactory>();

  register(factory: ApprovalChannelFactory): void {
    if (this.factories.has(factory.channelType)) {
      throw new Error(`duplicate channelType: '${factory.channelType}' is already registered`);
    }
    this.factories.set(factory.channelType, factory);
  }

  get(channelType: string): ApprovalChannelFactory | null {
    return this.factories.get(channelType) ?? null;
  }

  list(): ApprovalChannelFactory[] {
    return [...this.factories.values()];
  }
}

/**
 * ApprovalChannelFactory — spec §12.3.51 (audit B2)
 *
 * File: packages/contracts/src/interfaces/approval-channel-factory.ts
 */
import type { NonEmpty } from '../types/index.js';
import type { ApprovalChannel } from './index.js';

export interface ApprovalChannelFactory {
  /**
   * Discriminator string registered with ApprovalChannelFactoryRegistry.
   * Manifest entries reference this string in `channelType`.
   */
  readonly channelType: NonEmpty;

  /**
   * Construct an ApprovalChannel from a manifest entry's `configuration` object.
   * The factory is responsible for validating its own configuration shape
   * and throwing a fail-closed startup error if invalid.
   */
  create(configuration: Record<string, unknown>): Promise<ApprovalChannel>;
}

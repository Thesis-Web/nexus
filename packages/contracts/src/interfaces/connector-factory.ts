/**
 * ConnectorFactory — spec §12.3.50 (audit B2)
 *
 * File: packages/contracts/src/interfaces/connector-factory.ts
 */
import type { NonEmpty } from '../types/index.js';
import type { Connector } from './index.js';

export interface ConnectorFactory {
  /**
   * Discriminator string registered with ConnectorFactoryRegistry.
   * Manifest entries reference this string in `connectorType`.
   */
  readonly connectorType: NonEmpty;

  /**
   * Construct a Connector from a manifest entry's `configuration` object.
   * The factory is responsible for validating its own configuration shape
   * and throwing a fail-closed startup error if invalid.
   */
  create(configuration: Record<string, unknown>): Promise<Connector>;
}

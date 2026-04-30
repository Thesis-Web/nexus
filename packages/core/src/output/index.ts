// packages/core/src/output/index.ts
// AMEND-spec §6.7 — Output infrastructure barrel
// Layer 1 — baked output collection and contract infrastructure.

export { OutputCollectorImpl } from './output-collector.js';
export type { OutputCollectorDeps } from './output-collector.js';
export { buildOutputContractFromItems } from './output-contract-builder.js';
export {
  createNvgOutputReference,
  createNxsOutputReference,
  createAgentPartialOutputReference,
} from './output-reference-adapter.js';
export type {
  NvgResultInput,
  NxsResultInput,
  AgentPartialInput,
} from './output-reference-adapter.js';
export { sha256Hex, sha256Canonical } from './output-digest.js';
export { PayloadResolverRegistryImpl } from './payload-resolver.js';
export type { PayloadResolverRegistry } from './payload-resolver.js';
export { RunLedgerSlotReader } from './declared-output-slot-reader.js';
export type {
  DeclaredOutputSlotReader,
  SlotValidationResult,
} from './declared-output-slot-reader.js';

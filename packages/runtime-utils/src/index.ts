/**
 * @nexus/runtime-utils — spec §32a.0
 *
 * Shared signed-manifest runtime helpers and pure utilities.
 * NOT a product surface. NOT a governance engine.
 * Does NOT contain domain business logic.
 *
 * Importer allow-list (§32a.0):
 *   core, vanguard, connectors, identity-ref, interfaces/*, scripts/*
 *
 * Imports-into allow-list (§32a.0):
 *   @nexus/contracts, approved Node built-ins, approved external libs
 *   MUST NOT import from any implementation package.
 */
export { canonicalize } from './canonicalize.js';
export { signEd25519, verifyEd25519, loadDevKeypair, type DevKeyPair } from './crypto.js';
export {
  loadSignedManifest,
  type LoadSignedManifestResult,
} from './manifest/load-signed-manifest.js';
export {
  signManifest,
  type SignManifestInput,
  type SignedManifestEnvelope,
} from './manifest/sign-manifest.js';
export {
  formatQualifiedId,
  parseQualifiedId,
  detectCrossDomainCollisions,
  detectRequiredExternalsCollisions,
  type ManifestDomain,
  type QualifiedIdentifier,
} from './qualified-identifier.js';
export {
  validateLlmAdapterDeclaration,
  assertValidLlmAdapterDeclaration,
  isTargetedSystemToolName,
  type LlmAdapterDeclarationViolation,
} from './llm-adapter-declaration.js';

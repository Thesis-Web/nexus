/**
 * @nexus/identity-ref — Layer 6 barrel export
 * Reference Identity Adapter — implements identity-provider interface from contracts.
 * Imports from @nexus/contracts (Layer 2) ONLY.
 *
 * "Reference Identity Adapter — starter only.
 *  Not for production deployments with enterprise IAM or RBAC in place."
 */
export { ReferenceIdentityAdapter } from './reference-identity-adapter.js';
export {
  InMemoryActorStore,
  type ReferenceActorStore,
  type ReferenceActorRecord,
} from './actor-store.js';
export { InMemoryPrincipalStore, type ReferencePrincipalStore } from './principal-store.js';
export { ApiKeyAuthProvider, type ReferenceAuthProvider } from './auth/api-key-auth.js';

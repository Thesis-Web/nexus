/**
 * @nexus/core — type re-exports from @nexus/contracts (Layer 2)
 *
 * Spec: nexus-engineering-spec-v1-8-26.md §12
 * Law: All governed types, constants, and interfaces originate in @nexus/contracts.
 * This file re-exports them so existing core imports continue to resolve.
 *
 * Core-internal types that are NOT part of the Layer 2 contract
 * are defined below the re-export block.
 */

// Re-export everything from @nexus/contracts
export * from '@nexus/contracts';

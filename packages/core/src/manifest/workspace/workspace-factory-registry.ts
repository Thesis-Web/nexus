/**
 * WorkspaceFactoryRegistry — AMEND-spec §5.1, §3.13
 *
 * File: packages/core/src/manifest/workspace/workspace-factory-registry.ts
 * Layer 1 — imports from @nexus/contracts only.
 *
 * Behavior law (follows existing §12.3.48 pattern):
 *   - Duplicate registration throws (invariant 1)
 *   - Unknown workspaceType returns null on get (invariant 2: loader fails closed)
 *   - Registration before manifest load — bootstrap order (invariant 3)
 *   - NOT hot-reloadable (invariant 4)
 */
import type {
  WorkspaceFactory,
  WorkspaceFactoryRegistry as IWorkspaceFactoryRegistry,
} from '@nexus/contracts';

export class WorkspaceFactoryRegistry implements IWorkspaceFactoryRegistry {
  private readonly factories = new Map<string, WorkspaceFactory>();

  register(factory: WorkspaceFactory): void {
    if (this.factories.has(factory.workspaceType)) {
      throw new Error(`duplicate workspaceType: '${factory.workspaceType}' is already registered`);
    }
    this.factories.set(factory.workspaceType, factory);
  }

  get(workspaceType: string): WorkspaceFactory | null {
    return this.factories.get(workspaceType) ?? null;
  }

  list(): WorkspaceFactory[] {
    return [...this.factories.values()];
  }
}

/**
 * External Socket Registry — AMEND-spec §4.8
 *
 * File: packages/core/src/externals/external-socket-registry.ts
 * Layer 1 — baked infrastructure. NOT a replaceable plugin.
 *
 * The breaker-box terminal map of all loaded externals sockets.
 * Used by bootstrap, OutputCollector, CompileService, CompileReturnDispatcher,
 * and API DI.
 *
 * Registry law:
 * - Constructed only by scripts/nexus-bootstrap.ts after all required manifests load.
 * - Holds manifest records and lookup indexes only; does not execute plugin behavior.
 * - Cross-reference validation fails closed before API traffic starts.
 * - resolveReturnEndpointForRun follows:
 *     runId → run_opened.detail.workspaceSocketId →
 *     WorkspaceManifestRecord.returnEndpointId → CompileReturnEndpointRecord
 * - Missing run_opened, missing workspace socket, or missing return endpoint
 *   fails closed.
 * - This is the single return endpoint resolver. Do not add a separate
 *   ReturnEndpointResolver service unless a later blueprint introduces one.
 */
import type {
  Uuid,
  NonEmpty,
  WorkspaceManifestRecord,
  OrchestratorManifestRecord,
  MailboxManifestRecord,
  CompilerManifestRecord,
  CompileReturnEndpointRecord,
  RunLedgerWriter,
} from '@nexus/contracts';

// ─── ExternalSocketRegistry — §4.8 ───

export interface ExternalSocketRegistry {
  getWorkspace(workspaceSocketId: NonEmpty): WorkspaceManifestRecord | null;
  getOrchestrator(orchestratorSocketId: NonEmpty): OrchestratorManifestRecord | null;
  getPrimaryMailbox(): MailboxManifestRecord;
  getMailbox(mailboxId: NonEmpty): MailboxManifestRecord | null;
  getCompiler(compilerSocketId: NonEmpty): CompilerManifestRecord | null;
  getDefaultCompiler(): CompilerManifestRecord;
  getReturnEndpoint(returnEndpointId: NonEmpty): CompileReturnEndpointRecord | null;
  resolveReturnEndpointForRun(runId: Uuid): Promise<CompileReturnEndpointRecord>;
  validateCrossReferences(): void;
}

// ─── Dependencies ───

export interface ExternalSocketRegistryDeps {
  workspaces: readonly WorkspaceManifestRecord[];
  orchestrators: readonly OrchestratorManifestRecord[];
  mailboxes: readonly MailboxManifestRecord[];
  compilers: readonly CompilerManifestRecord[];
  compileReturnEndpoints: readonly CompileReturnEndpointRecord[];
  runLedgerWriter: RunLedgerWriter;
}

// ─── Implementation ───

export class ExternalSocketRegistryImpl implements ExternalSocketRegistry {
  private readonly workspaceIndex: ReadonlyMap<string, WorkspaceManifestRecord>;
  private readonly orchestratorIndex: ReadonlyMap<string, OrchestratorManifestRecord>;
  private readonly mailboxIndex: ReadonlyMap<string, MailboxManifestRecord>;
  private readonly compilerIndex: ReadonlyMap<string, CompilerManifestRecord>;
  private readonly returnEndpointIndex: ReadonlyMap<string, CompileReturnEndpointRecord>;
  private readonly primaryMailbox: MailboxManifestRecord;
  private readonly defaultCompiler: CompilerManifestRecord;
  private readonly deps: ExternalSocketRegistryDeps;

  constructor(deps: ExternalSocketRegistryDeps) {
    this.deps = deps;

    // Build indexes
    this.workspaceIndex = new Map(deps.workspaces.map(r => [r.workspaceSocketId, r]));
    this.orchestratorIndex = new Map(deps.orchestrators.map(r => [r.orchestratorSocketId, r]));
    this.mailboxIndex = new Map(deps.mailboxes.map(r => [r.mailboxId, r]));
    this.compilerIndex = new Map(deps.compilers.map(r => [r.compilerSocketId, r]));
    this.returnEndpointIndex = new Map(
      deps.compileReturnEndpoints.map(r => [r.returnEndpointId, r])
    );

    // Resolve primary mailbox: first enabled required mailbox
    const primary = deps.mailboxes.find(m => m.enabled && m.required);
    if (!primary) {
      throw new Error(
        'ExternalSocketRegistry: no enabled required mailbox found — fail closed (§5.3)'
      );
    }
    this.primaryMailbox = primary;

    // Resolve default compiler: first enabled compiler
    const compiler = deps.compilers.find(c => c.enabled);
    if (!compiler) {
      throw new Error('ExternalSocketRegistry: no enabled compiler found — fail closed (§5.3)');
    }
    this.defaultCompiler = compiler;
  }

  getWorkspace(workspaceSocketId: NonEmpty): WorkspaceManifestRecord | null {
    return this.workspaceIndex.get(workspaceSocketId) ?? null;
  }

  getOrchestrator(orchestratorSocketId: NonEmpty): OrchestratorManifestRecord | null {
    return this.orchestratorIndex.get(orchestratorSocketId) ?? null;
  }

  getPrimaryMailbox(): MailboxManifestRecord {
    return this.primaryMailbox;
  }

  getMailbox(mailboxId: NonEmpty): MailboxManifestRecord | null {
    return this.mailboxIndex.get(mailboxId) ?? null;
  }

  getCompiler(compilerSocketId: NonEmpty): CompilerManifestRecord | null {
    return this.compilerIndex.get(compilerSocketId) ?? null;
  }

  getDefaultCompiler(): CompilerManifestRecord {
    return this.defaultCompiler;
  }

  getReturnEndpoint(returnEndpointId: NonEmpty): CompileReturnEndpointRecord | null {
    return this.returnEndpointIndex.get(returnEndpointId) ?? null;
  }

  /**
   * §4.8: resolveReturnEndpointForRun
   * runId → run_opened.detail.workspaceSocketId →
   * WorkspaceManifestRecord.returnEndpointId → CompileReturnEndpointRecord
   */
  async resolveReturnEndpointForRun(runId: Uuid): Promise<CompileReturnEndpointRecord> {
    const entries = await this.deps.runLedgerWriter.getByRunId(runId);
    const runOpened = entries.find(e => e.eventType === 'run_opened');
    if (!runOpened) {
      throw new Error(
        `ExternalSocketRegistry: no run_opened event for runId '${runId}' — fail closed`
      );
    }

    const detail = runOpened.detail as Record<string, unknown>;
    const workspaceSocketId = detail['workspaceSocketId'] as string | undefined;
    if (!workspaceSocketId) {
      throw new Error(
        `ExternalSocketRegistry: run_opened for '${runId}' missing workspaceSocketId — fail closed`
      );
    }

    const workspace = this.workspaceIndex.get(workspaceSocketId);
    if (!workspace) {
      throw new Error(
        `ExternalSocketRegistry: workspace socket '${workspaceSocketId}' not found — fail closed`
      );
    }

    const endpoint = this.returnEndpointIndex.get(workspace.returnEndpointId);
    if (!endpoint) {
      throw new Error(
        `ExternalSocketRegistry: return endpoint '${workspace.returnEndpointId}' not found — fail closed`
      );
    }

    return endpoint;
  }

  /**
   * §4.7 cross-reference validation — fails closed before API traffic starts.
   *
   * Checks:
   * - workspace.returnEndpointId → compile-return domain
   * - compiler.readsFromMailboxId → mailbox domain
   * - compile-return.targetWorkspaceSocketId → workspace domain
   */
  validateCrossReferences(): void {
    const errors: string[] = [];

    // workspace.returnEndpointId → compile-return
    for (const ws of this.deps.workspaces) {
      if (!ws.enabled) continue;
      if (!this.returnEndpointIndex.has(ws.returnEndpointId)) {
        errors.push(
          `Workspace '${ws.workspaceSocketId}' references return endpoint '${ws.returnEndpointId}' which does not exist`
        );
      }
    }

    // compiler.readsFromMailboxId → mailbox
    for (const comp of this.deps.compilers) {
      if (!comp.enabled) continue;
      if (!this.mailboxIndex.has(comp.readsFromMailboxId)) {
        errors.push(
          `Compiler '${comp.compilerSocketId}' references mailbox '${comp.readsFromMailboxId}' which does not exist`
        );
      }
    }

    // compile-return.targetWorkspaceSocketId → workspace
    for (const ep of this.deps.compileReturnEndpoints) {
      if (!ep.enabled) continue;
      if (!this.workspaceIndex.has(ep.targetWorkspaceSocketId)) {
        errors.push(
          `Compile-return endpoint '${ep.returnEndpointId}' references workspace '${ep.targetWorkspaceSocketId}' which does not exist`
        );
      }
    }

    if (errors.length > 0) {
      throw new Error(
        `Cross-reference validation failed (§4.7 fail closed):\n  ${errors.join('\n  ')}`
      );
    }
  }
}

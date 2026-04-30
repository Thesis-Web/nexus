/**
 * Reference Deterministic Renderer — AMEND-spec §8.3
 *
 * File: packages/core/src/compile/deterministic-renderer.ts
 * Layer 1 — reference compiler implementing Compiler interface.
 *
 * Constraints:
 * - No model call, no action call, no network call except filesystem.
 * - No mutation of source mailbox items.
 * - Deterministic item ordering required for replay.
 * - Actor-registration exempt.
 */
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import type {
  Compiler,
  CompileRequest,
  OutputContract,
  MailboxItem,
  FinalResponseArtifact,
  NonEmpty,
  Uuid,
} from '@nexus/contracts';
import { nowIso } from '@nexus/contracts';
import { sha256Hex } from '../output/output-digest.js';
import { signArtifact } from './final-response-signer.js';

export class DeterministicRenderer implements Compiler {
  readonly compilerSocketId: NonEmpty;
  readonly compilerVersion: NonEmpty;
  private readonly signingKey: string;
  private readonly outputRoot: string;

  constructor(compilerSocketId: NonEmpty, signingKey: string, outputRoot: string) {
    this.compilerSocketId = compilerSocketId;
    this.compilerVersion = '1.0.0' as NonEmpty;
    this.signingKey = signingKey;
    this.outputRoot = outputRoot;
  }

  async compile(
    request: CompileRequest,
    contract: OutputContract,
    items: MailboxItem[]
  ): Promise<FinalResponseArtifact> {
    // Sort deterministically: createdAt asc, then taskId asc, then slotId asc
    const sorted = [...items].sort((a, b) => {
      const byTime = a.createdAt.localeCompare(b.createdAt);
      if (byTime !== 0) return byTime;
      const byTask = a.taskId.localeCompare(b.taskId);
      if (byTask !== 0) return byTask;
      return a.slotId.localeCompare(b.slotId);
    });

    // Build deterministic plaintext body
    const lines: string[] = [
      `# Nexus Deterministic Compile — Run ${request.runId}`,
      `Compiled at: ${nowIso()}`,
      `Compiler: ${this.compilerSocketId}`,
      `Output contract: ${contract.outputContractId}`,
      `Items: ${sorted.length}`,
      `Data classes: ${contract.inputDataClasses.join(', ')}`,
      `Inherited ceiling: ${contract.inheritedCompileDataClass}`,
      '',
    ];

    for (const item of sorted) {
      lines.push(`## Item ${item.mailboxItemId}`);
      lines.push(`  Task: ${item.taskId}`);
      lines.push(`  Agent: ${item.agentId}`);
      lines.push(`  Slot: ${item.slotId}`);
      lines.push(`  Source: ${item.sourceType}`);
      lines.push(`  Ref: ${item.resultRef}`);
      lines.push(`  Digest: ${item.resultDigest}`);
      lines.push(`  Classifications: ${item.resultClassifications.join(', ')}`);
      if (item.redactionState === 'redacted') {
        lines.push(`  [REDACTED]`);
      }
      lines.push('');
    }

    const body = lines.join('\n');
    const bodyBytes = new TextEncoder().encode(body);
    const bodyDigest = sha256Hex(bodyBytes);

    // Write body to filesystem
    const artifactId = randomUUID() as Uuid;
    const bodyPath = join(this.outputRoot, 'runs', 'compile', request.runId, `${artifactId}.txt`);
    await fs.mkdir(dirname(bodyPath), { recursive: true });
    await fs.writeFile(bodyPath, bodyBytes);
    const bodyRef = `file://runs/compile/${request.runId}/${artifactId}.txt` as NonEmpty;

    // Build artifact (without signature first)
    const artifactBase: Omit<FinalResponseArtifact, 'signature'> = {
      artifactId,
      runId: request.runId,
      compilerSocketId: this.compilerSocketId,
      compilerActorId: null,
      compileMode: 'deterministic_render',
      bodyRef,
      bodyDigest,
      outputClassifications: contract.inputDataClasses,
      sourceMailboxItems: sorted.map(i => i.mailboxItemId),
      evidenceRefs: contract.evidenceRefs,
      routingTrailRefs: contract.routingTrailRefs,
      runLedgerRefs: contract.runLedgerRefs,
      createdAt: nowIso(),
    };

    // Sign
    const signature = await signArtifact(artifactBase, this.signingKey);

    return { ...artifactBase, signature };
  }
}

/**
 * Compile-Return Reference Route — AMEND-spec §6.9, §11, §15.2
 *
 * File: packages/interfaces/api/src/routes/compile-return.ts
 * Layer 7 — reference harness receiver for compile-return.
 * Imports @nexus/contracts ONLY. Service instances injected by DI.
 *
 * POST /compile-return/:returnEndpointId
 *
 * This is a REFERENCE HARNESS — NOT INFRA LAW. It exists so the full
 * compile-return wire can be tested end-to-end.
 *
 * Verification law (§3.10 workspace verification):
 *   1. verify returnEndpointId exists and enabled
 *   2. verify targetWorkspaceSocketId matches endpoint config
 *   3. verify signed_callback envelope (ed25519)
 *   4. recompute artifactDigest and verify match
 *   5. verify artifact signature (ed25519)
 *   6. verify artifact.runId == request.runId
 *   7. verify acceptedArtifactTypes includes final_response.v1
 *
 * Rejection law (§15.2):
 *   Reject and write run_closed with closeReason: error on any failure.
 *   Do not create compile_return_rejected event type.
 */
import type { Express } from 'express';
import type {
  CompileReturnRequest,
  CompileReturnEndpointRecord,
  FinalResponseArtifact,
  RunLedgerWriter,
  Sha256Hex,
  Uuid,
  NonEmpty,
} from '@nexus/contracts';
import { nowIso } from '@nexus/contracts';
import { san } from './shared.js';

// ─── DI Dependencies ───
// All verification logic is injected by bootstrap. Route does not import
// core/compile implementations directly — Layer 7 import law.

export interface CompileReturnRouteDeps {
  /** Look up compile-return endpoint by ID. From ExternalSocketRegistry. */
  getReturnEndpoint: (returnEndpointId: string) => CompileReturnEndpointRecord | null;
  /** Verify signed_callback auth envelope. From core/compile. */
  verifyCallbackSignature: (request: CompileReturnRequest, publicKey: string) => Promise<boolean>;
  /** Verify artifact signature. From core/compile. */
  verifyArtifactSignature: (artifact: FinalResponseArtifact, publicKey: string) => Promise<boolean>;
  /** Recompute artifact digest (sha256 of canonical artifact without signature). */
  recomputeArtifactDigest: (artifact: FinalResponseArtifact) => Sha256Hex;
  /** Control plane public key (base64url) for reference harness verification. */
  controlPlanePublicKey: string;
  /** Run Ledger writer for recording lifecycle events. */
  runLedgerWriter: RunLedgerWriter;
}

// ─── Route Registration ───

export function registerCompileReturnRoutes(
  app: Express,
  deps: Partial<CompileReturnRouteDeps>
): void {
  app.post('/compile-return/:returnEndpointId', async (req, res) => {
    // Gate: deps must be configured
    if (
      !deps.getReturnEndpoint ||
      !deps.verifyCallbackSignature ||
      !deps.verifyArtifactSignature ||
      !deps.recomputeArtifactDigest ||
      !deps.controlPlanePublicKey ||
      !deps.runLedgerWriter
    ) {
      res.status(501).json({ ok: false, error: 'Compile-return not configured' });
      return;
    }

    try {
      const paramEndpointId = req.params['returnEndpointId'];
      const request = req.body as CompileReturnRequest;

      // §6.9 step 1: verify returnEndpointId exists and enabled
      const endpoint = deps.getReturnEndpoint(paramEndpointId);
      if (endpoint === null) {
        res.status(404).json({
          ok: false,
          error: `Unknown return endpoint: '${paramEndpointId}'`,
          denialCode: 'compile_return_signature_invalid',
        });
        return;
      }
      if (!endpoint.enabled) {
        res.status(403).json({
          ok: false,
          error: `Return endpoint '${paramEndpointId}' is disabled`,
          denialCode: 'compile_return_signature_invalid',
        });
        return;
      }

      // §6.9 step 7: verify acceptedArtifactTypes includes final_response.v1
      // V1 FinalResponseArtifact has implicit artifact type final_response.v1.
      if (!endpoint.acceptedArtifactTypes.includes('final_response.v1' as NonEmpty)) {
        res.status(403).json({
          ok: false,
          error: 'Artifact type final_response.v1 not accepted by endpoint',
          denialCode: 'compile_return_signature_invalid',
        });
        return;
      }

      // §6.9 step 2: verify targetWorkspaceSocketId matches endpoint config
      if (request.targetWorkspaceSocketId !== endpoint.targetWorkspaceSocketId) {
        res.status(403).json({
          ok: false,
          error: 'Workspace socket mismatch',
          denialCode: 'compile_return_signature_invalid',
        });
        return;
      }

      // §6.9 step 6: verify artifact.runId == request.runId
      if (request.artifact.runId !== request.runId) {
        res.status(403).json({
          ok: false,
          error: 'Artifact runId mismatch',
          denialCode: 'compile_return_signature_invalid',
        });
        return;
      }

      // §6.9 step 4: recompute artifactDigest and verify match
      const recomputed = deps.recomputeArtifactDigest(request.artifact);
      if (recomputed !== request.artifactDigest) {
        res.status(403).json({
          ok: false,
          error: 'Artifact digest mismatch',
          denialCode: 'compile_return_digest_mismatch',
        });
        return;
      }

      // §6.9 step 3: verify signed_callback envelope
      const callbackValid = await deps.verifyCallbackSignature(request, deps.controlPlanePublicKey);
      if (!callbackValid) {
        res.status(403).json({
          ok: false,
          error: 'Callback signature verification failed',
          denialCode: 'compile_return_signature_invalid',
        });
        return;
      }

      // §6.9 step 5: verify artifact signature
      const artifactValid = await deps.verifyArtifactSignature(
        request.artifact,
        deps.controlPlanePublicKey
      );
      if (!artifactValid) {
        res.status(403).json({
          ok: false,
          error: 'Artifact signature verification failed',
          denialCode: 'compile_return_signature_invalid',
        });
        return;
      }

      // §6.9: write Run Ledger final_response if not already written
      const runId = request.runId;
      const existingEvents = await deps.runLedgerWriter.getByRunId(runId);
      const hasFinalResponse = existingEvents.some(e => e.eventType === 'final_response');

      if (!hasFinalResponse) {
        await deps.runLedgerWriter.writeEvent({
          runId,
          eventType: 'final_response',
          timestamp: nowIso(),
          actorId: null,
          detail: {
            artifactId: request.artifact.artifactId,
            compilerSocketId: request.artifact.compilerSocketId,
            compileMode: request.artifact.compileMode,
            bodyRef: request.artifact.bodyRef,
            bodyDigest: request.artifact.bodyDigest,
            artifactDigest: request.artifactDigest,
            returnEndpointId: request.returnEndpointId,
            sourceMailboxItemCount: request.artifact.sourceMailboxItems.length,
          },
        });
      }

      // §6.9: write Run Ledger run_closed after successful display handoff
      await deps.runLedgerWriter.writeEvent({
        runId,
        eventType: 'run_closed',
        timestamp: nowIso(),
        actorId: null,
        detail: {
          closeReason: 'completed',
          returnEndpointId: request.returnEndpointId,
          artifactId: request.artifact.artifactId,
          acceptedAt: nowIso(),
        },
      });

      // §6.9: return accepted
      const ack = {
        runId: request.runId as Uuid,
        returnEndpointId: request.returnEndpointId,
        accepted: true,
        acceptedAt: nowIso(),
        reason: null,
      };

      res.json({ ok: true, data: ack });
    } catch (err) {
      // §15.2: reject and write run_closed with closeReason: error
      try {
        const request = req.body as CompileReturnRequest | undefined;
        if (request?.runId && deps.runLedgerWriter) {
          await deps.runLedgerWriter.writeEvent({
            runId: request.runId,
            eventType: 'run_closed',
            timestamp: nowIso(),
            actorId: null,
            detail: {
              closeReason: 'error',
              error: san(err),
            },
          });
        }
      } catch {
        // Best-effort ledger write on error path
      }
      res.status(500).json({ ok: false, error: san(err) });
    }
  });
}

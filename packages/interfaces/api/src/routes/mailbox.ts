/**
 * Mailbox Reference Harness Route — AMEND-spec §11.2
 *
 * File: packages/interfaces/api/src/routes/mailbox.ts
 * Layer 7 — reference harness for mailbox item listing.
 * Imports @nexus/contracts ONLY. Service instances injected by DI.
 *
 * GET /mailbox/runs/:runId/items — list mailbox item metadata
 *
 * REFERENCE HARNESS — NOT INFRA LAW. This route exists so the full
 * loop can be tested by listing mailbox items for a run.
 *
 * §11.3 Forbidden behavior:
 *   - No mailbox payload read without metadata/digest controls
 *   - No Evidence Ledger mutation
 *   - No Routing Provenance Trail mutation
 */
import type { Express } from 'express';
import type { MailboxService, MailboxManifestRecord, Uuid, NonEmpty } from '@nexus/contracts';
import { san } from './shared.js';

// ─── DI Dependencies ───

export interface MailboxRouteDeps {
  /** MailboxService from ExternalsRuntime — baked core, not replaceable. */
  mailboxService: MailboxService;
  /** Primary mailbox manifest record from ExternalSocketRegistry. */
  primaryMailbox: MailboxManifestRecord;
}

// ─── Route Registration ───

export function registerMailboxRoutes(app: Express, deps: Partial<MailboxRouteDeps>): void {
  // ── GET /mailbox/runs/:runId/items — §11.2 list mailbox item metadata ────

  app.get('/mailbox/runs/:runId/items', async (req, res) => {
    if (!deps.mailboxService || !deps.primaryMailbox) {
      res.status(501).json({ ok: false, error: 'Mailbox not configured' });
      return;
    }

    try {
      const runId = req.params['runId'] as Uuid;
      const mailboxId = deps.primaryMailbox.mailboxId;

      // List compile-eligible items for the run
      const items = await deps.mailboxService.listEligibleForCompile(mailboxId, runId);

      // Return metadata only — no payload content (§11.3: no payload read without controls)
      const metadata = items.map(item => ({
        mailboxItemId: item.mailboxItemId,
        runId: item.runId,
        taskId: item.taskId,
        agentId: item.agentId,
        slotId: item.slotId,
        sourceType: item.sourceType,
        resultDigest: item.resultDigest,
        resultClassifications: item.resultClassifications,
        // F4.11 — admin dashboard surfaces provenance so operators can
        // see which writer produced each item.
        provenance: item.provenance,
        octLevel: item.octLevel,
        createdAt: item.createdAt,
        expiresAt: item.expiresAt,
        redactionState: item.redactionState,
        mailboxStatus: item.mailboxStatus,
        compileEligible: item.compileEligible,
        consumedAt: item.consumedAt,
        blockedReason: item.blockedReason,
      }));

      res.json({
        ok: true,
        data: {
          runId,
          mailboxId: mailboxId as NonEmpty,
          itemCount: metadata.length,
          items: metadata,
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });
}

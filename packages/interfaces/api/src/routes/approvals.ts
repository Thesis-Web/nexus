/**
 * Approval routes — spec §23.2
 * Shared decideApproval service — one signing path (BS-102).
 * Layer 7 — imports @nexus/contracts ONLY.
 */
import type { Express } from 'express';
import type { PendingApprovalStore, ApprovalResponse } from '@nexus/contracts';
import { ApprovalDecisionError } from '@nexus/contracts';
import { san } from './shared.js';

export function registerApprovalRoutes(
  app: Express,
  deps: {
    approvalStore: PendingApprovalStore;
    decideApproval: (
      approvalId: string,
      decidedBy: string,
      decision: 'approved' | 'denied',
      note: string | undefined,
      store: PendingApprovalStore
    ) => Promise<ApprovalResponse>;
  }
): void {
  const { approvalStore, decideApproval } = deps;

  app.get('/approvals/pending', async (_req, res) => {
    try {
      res.json({ ok: true, data: await approvalStore.listPending() });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  app.post('/approvals/:id/approve', async (req, res) => {
    try {
      const { decidedBy } = req.body ?? {};
      if (!decidedBy) {
        res.status(400).json({ ok: false, error: 'decidedBy required' });
        return;
      }
      const r = await decideApproval(
        req.params['id']!,
        decidedBy,
        'approved',
        undefined,
        approvalStore
      );
      res.json({ ok: true, data: { decision: r.decision, decidedBy: r.decidedBy } });
    } catch (err) {
      if (err instanceof ApprovalDecisionError) {
        res.status(400).json({ ok: false, error: err.message });
        return;
      }
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  app.post('/approvals/:id/deny', async (req, res) => {
    try {
      const { decidedBy, note } = req.body ?? {};
      if (!decidedBy) {
        res.status(400).json({ ok: false, error: 'decidedBy required' });
        return;
      }
      const r = await decideApproval(req.params['id']!, decidedBy, 'denied', note, approvalStore);
      res.json({ ok: true, data: { decision: r.decision, decidedBy: r.decidedBy } });
    } catch (err) {
      if (err instanceof ApprovalDecisionError) {
        res.status(400).json({ ok: false, error: err.message });
        return;
      }
      res.status(500).json({ ok: false, error: san(err) });
    }
  });
}

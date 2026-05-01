/**
 * Template Admin Route — AMEND-spec-nexus-compile §6
 *
 * File: packages/interfaces/api/src/routes/templates.ts
 * Layer 7 — admin ingestion route for signed CompileTemplates.
 * Imports @nexus/contracts ONLY. Service instances injected by DI.
 *
 * POST /admin/templates — [blueprint §11.3]
 *
 * Requires BOTH admin authorization (caller authority, global middleware)
 * AND valid Ed25519 template signature (body integrity, verified here).
 *
 * DIFF-S23-002: Spec §6.2 TemplateRouteDeps references core types
 * (TemplateRegistryStore, TemplateValidator, TemplateVerifier) in Layer 7.
 * Layer 7 can only import from @nexus/contracts. Deps redefined using
 * function signatures referencing only contracts types. Blueprint §15 wins.
 */
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import type { RunLedgerWriter, CompileTemplate, NonEmpty, Uuid } from '@nexus/contracts';
import { nowIso } from '@nexus/contracts';
import { san } from './shared.js';

// ─── DI Dependencies ───
// Function-based to avoid core imports in Layer 7.
// Bootstrap wires concrete implementations from core.

export interface TemplateRouteDeps {
  /** Validate raw input through Zod + structural validation. */
  validateTemplate: (raw: unknown) => CompileTemplate;
  /** Verify template digest + Ed25519 signature. Throws on failure. */
  verifyTemplate: (template: CompileTemplate) => Promise<void>;
  /** Insert template into Zone 1 registry store. */
  storeTemplate: (template: CompileTemplate, ingestedBy: NonEmpty) => void;
  /** Check if template already exists (duplicate rejection). */
  templateExists: (templateId: NonEmpty, templateVersion: NonEmpty) => boolean;
  /** RunLedgerWriter for template_ingested event. */
  runLedgerWriter: RunLedgerWriter;
}

// ─── Route Registration ───

export function registerTemplateRoutes(app: Express, deps: Partial<TemplateRouteDeps>): void {
  app.post('/admin/templates', async (req, res) => {
    // Gate: deps must be configured
    if (
      !deps.validateTemplate ||
      !deps.verifyTemplate ||
      !deps.storeTemplate ||
      !deps.templateExists ||
      !deps.runLedgerWriter
    ) {
      res.status(501).json({ ok: false, error: 'Template ingestion not configured' });
      return;
    }

    try {
      // §6.3 step 1: Authorize — global adminAuth middleware already applied.
      // Defense-in-depth: if we reach here, admin auth passed.

      // §6.3 step 2: Parse request body
      const raw = req.body as unknown;

      // §6.3 step 3: Validate (Zod + structure) [spec §4]
      let template: CompileTemplate;
      try {
        template = deps.validateTemplate(raw);
      } catch (err) {
        res.status(400).json({
          ok: false,
          error: san(err),
          denialCode: 'template_validation_failed',
        });
        return;
      }

      // §6.3 step 4: Verify (digest + signature) [spec §5]
      try {
        await deps.verifyTemplate(template);
      } catch (err) {
        const errObj = err as { denialCode?: string };
        res.status(403).json({
          ok: false,
          error: san(err),
          denialCode: errObj.denialCode ?? 'template_signature_invalid',
        });
        return;
      }

      // §6.3 step 5: Reject duplicate
      if (deps.templateExists(template.templateId, template.templateVersion)) {
        res.status(409).json({
          ok: false,
          error: `Template '${template.templateId}@${template.templateVersion}' already exists`,
          denialCode: 'template_validation_failed',
        });
        return;
      }

      // §6.3 step 6: Insert into registry
      const ingestedBy = 'admin' as NonEmpty;
      deps.storeTemplate(template, ingestedBy);

      // §6.3 step 7: Emit template_ingested [spec §6.4]
      // Synthetic admin-operation UUID as runId — no compile run exists.
      const syntheticRunId = randomUUID() as Uuid;
      await deps.runLedgerWriter.writeEvent({
        runId: syntheticRunId,
        eventType: 'template_ingested',
        timestamp: nowIso(),
        actorId: null,
        detail: {
          adminOperation: true,
          templateId: template.templateId,
          templateVersion: template.templateVersion,
          templateDigest: template.templateDigest,
          signedBy: template.createdBy,
          ingestedBy,
          sectionCount: template.sections.length,
          guardCount: template.guards.length,
        },
      });

      // §6.3 step 8: Return 201
      res.status(201).json({
        ok: true,
        data: {
          templateId: template.templateId,
          templateVersion: template.templateVersion,
          templateDigest: template.templateDigest,
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });
}

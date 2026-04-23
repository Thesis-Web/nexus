/**
 * Operating mode routes — spec §23.2, §9, DEF-008
 * Layer 7 — imports @nexus/contracts ONLY.
 */
import type { Express } from 'express';
import type { ModeConfiguration } from '@nexus/contracts';

export function registerModeRoutes(
  app: Express,
  deps: {
    loadModeConfig?: () => Promise<ModeConfiguration>;
    saveModeConfig?: (config: ModeConfiguration) => Promise<void>;
  }
): void {
  const { loadModeConfig } = deps;

  app.get('/mode', async (_req, res) => {
    try {
      if (!loadModeConfig) {
        res.status(501).json({ ok: false, error: 'mode management not configured' });
        return;
      }
      const config = await loadModeConfig();
      res.json({
        ok: true,
        data: {
          nxsMode: config.nxsMode,
          nvgMode: config.nvgMode,
          enforcingLocked: config.enforcingLocked,
          updatedAt: config.updatedAt,
          updatedBy: config.updatedBy.adminId,
        },
      });
    } catch {
      res.json({
        ok: true,
        data: {
          nxsMode: 'observe',
          nvgMode: 'observe',
          enforcingLocked: false,
          updatedAt: null,
        },
      });
    }
  });

  app.post('/mode', async (_req, res) => {
    // §9.3: Mode changes require signed admin command with Ed25519 keypair.
    // Admin keypair cannot be safely transmitted over HTTP in the POC.
    // Use CLI: nexus mode set --engine <nxs|nvg> --mode <mode>
    res
      .status(501)
      .json({ ok: false, error: 'POST /mode requires admin keypair — use CLI nexus mode set' });
  });
}

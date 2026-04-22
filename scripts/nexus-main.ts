#!/usr/bin/env tsx
/**
 * Nexus CLI — composition root entry point — UNLAYERED
 *
 * This file lives OUTSIDE the seven-layer package architecture (scripts/).
 * It is the sole point where cross-layer construction occurs for the CLI binary.
 * Cross-layer imports are permitted here because this is a composition root.
 *
 * MODULAR-S29-002 fix: removed @nexus/vanguard from CLI package dependencies.
 * NVG service construction happens here; CLI commands receive Layer 2 interfaces only.
 *
 * Spec: nexus-engineering-spec-v1-8-26.md §22.1
 * Blueprint: nexus-blueprint-v1-5-13.md §24.8
 */

import {
  NvgServiceImpl,
  JsonlRoutingTrailReader,
  loadNvgRoutingPolicy as loadNvgPolicyYaml,
} from '@nexus/vanguard';
import { SimpleConnectorRegistry, canonicalize, verify, loadControlPlaneKey } from '@nexus/core';
import { StubConnector } from '@nexus/connector-stub';
import { createCli } from '@nexus/cli';
import * as path from 'node:path';

const DEFAULT_TRAIL_DIR = path.join(process.cwd(), 'runs');

const program = createCli({
  createNvgService: () => new NvgServiceImpl(),
  createTrailReader: (dir?: string) => new JsonlRoutingTrailReader(dir ?? DEFAULT_TRAIL_DIR),
  loadNvgRoutingPolicy: async (filepath: string) => {
    const key = await loadControlPlaneKey();
    return loadNvgPolicyYaml(filepath, key.publicKey, { verify, canonicalize });
  },
  createConnectorRegistry: () => {
    const reg = new SimpleConnectorRegistry();
    reg.register(new StubConnector());
    return reg;
  },
});

// Filter out bare '--' that pnpm may inject between script path and subcommands.
const argv = process.argv.filter((arg, idx) => !(arg === '--' && idx === 2));
program.parse(argv);

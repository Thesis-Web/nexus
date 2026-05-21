/**
 * tests/e2e/12-hard-law-surfaces.e2e.test.ts — E2E v0.4.0 §3.12
 *
 * Category 12: each test targets one Hard Law's enforcement surface
 * directly. This is the structural-invariant suite — if anything
 * here fails, every other test is suspect.
 *
 * Owner directive 2026-05-21: no `it.skip`. The Hard Law surfaces are
 * the highest-priority repair targets. Most have specific blockers
 * (compile pass-through, mailbox-only, claim drift) tied to known
 * arc work.
 */
import { describe, it } from 'vitest';
import { AcceptanceWallFailure } from './_acceptance/failure.js';

describe('E2E Category 12 — Hard Law surfaces', () => {
  it('E2E-111-hl1-auth-first: no auth → 401 before any gate', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-111',
      failureClass: 'UNIMPLEMENTED_TEST_BODY',
      reason:
        'HL#1 auth-first. Body not written. Testable now — POST /workspace/runs with no JWT, assert 401, assert NO ledger event fires.',
      blockedBy: 'E2E-HARD-LAW-CATALOG',
      owner: 'builder',
      lawPins: ['HL#1'],
      nextRecommendedAction:
        'fetch POST /workspace/runs with no Authorization header → expect 401, then assert no run was opened in the run ledger.',
    });
  });
  it('E2E-112-hl4-orch-no-kill: planner unable to resolve → callback (not deny)', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-112',
      failureClass: 'UNIMPLEMENTED_TEST_BODY',
      reason: 'HL#4 — orch never kills. Body not written.',
      blockedBy: 'E2E-CALLBACK-FLOW',
      owner: 'builder',
      lawPins: ['HL#4'],
    });
  });
  it('E2E-113-hl5-nxs-only-action-auth: agent NXS-bypass via side-channel → blocked', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-113',
      failureClass: 'UNIMPLEMENTED_TEST_BODY',
      reason:
        'HL#5 — NXS is the sole action authority. Body should attempt to call a connector directly (no run) and assert refusal at boundary.',
      blockedBy: 'E2E-HARD-LAW-CATALOG',
      owner: 'builder',
      lawPins: ['HL#5'],
    });
  });
  it('E2E-114-hl6-nvg-sole-llm-auth: agent direct LLM call → blocked', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-114',
      failureClass: 'UNIMPLEMENTED_TEST_BODY',
      reason:
        'HL#6 — NVG is the sole LLM authority. Body should attempt to call a model adapter directly and assert refusal.',
      blockedBy: 'E2E-HARD-LAW-CATALOG',
      owner: 'builder',
      lawPins: ['HL#6'],
    });
  });
  it('E2E-115-hl7-llm-no-tool-descriptors: nvg_outbound payload has empty toolDescriptors', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-115',
      failureClass: 'UNIMPLEMENTED_TEST_BODY',
      reason:
        'HL#7 — model never sees tool descriptors. Body should run any LLM-calling test and assert nvg_outbound event has toolDescriptors: [].',
      blockedBy: 'E2E-HARD-LAW-CATALOG',
      owner: 'builder',
      lawPins: ['HL#7'],
      nextRecommendedAction:
        'Reuse E2E-01 chat flow, read the ledger nvg_outbound event, assert toolDescriptors is an empty array (planner-drift gate).',
    });
  });
  it('E2E-116-hl8-mailbox-only-data-hub: cross-actor mailbox read denied', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-116',
      failureClass: 'UNIMPLEMENTED_TEST_BODY',
      reason:
        'HL#8 — mailbox is the only data hub. Body should attempt cross-actor mailbox read and assert refusal.',
      blockedBy: 'E2E-HARD-LAW-CATALOG',
      owner: 'builder',
      lawPins: ['HL#8'],
      nextRecommendedAction:
        'Open run A as actor X, attempt to read run A mailbox via actor Y JWT, assert 403/empty.',
    });
  });
  it('E2E-117-hl11-compile-passthrough: single agent + no contract = verbatim forward', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-117',
      failureClass: 'UNIMPLEMENTED_TEST_BODY',
      reason:
        'HL#11 — compile pass-through. Body should run a single-agent no-contract chat, then assert the FinalResponseArtifact body equals the agent mailbox item verbatim (digest match).',
      blockedBy: 'E2E-HARD-LAW-CATALOG',
      owner: 'builder',
      lawPins: ['HL#11'],
      nextRecommendedAction:
        'Extend E2E-01 — after run closes, read mailbox item digest + final_response artifact digest; assert equal.',
    });
  });
  it('E2E-118-hl14-claim-drift: mid-run RBAC change halts with claim_drift_detected', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-118',
      failureClass: 'UNIMPLEMENTED_SURFACE',
      reason: 'Same blocker as E2E-110 — no admin endpoint to revoke a capability mid-run.',
      blockedBy: 'ADMIN-REVOKE-ENDPOINT-V1',
      owner: 'owner',
      lawPins: ['HL#14'],
    });
  });
  it('E2E-119-hl15-symmetric-intersection: real per-dimension differential', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-119',
      failureClass: 'UNIMPLEMENTED_TEST_BODY',
      reason:
        'HL#15 — effective scope is intersection(user, agent, delegation). Body needs to register a narrow agent + delegate broader than the agent, then assert the agent ceiling wins.',
      blockedBy: 'E2E-HARD-LAW-CATALOG',
      owner: 'builder',
      lawPins: ['HL#15'],
      nextRecommendedAction:
        'Register agent with allowedSystems=[sales]; delegate with allowedSystems=[sales,warehouse]; run against warehouse; assert Gate 03 denial.',
    });
  });
  it('E2E-120-hl16-agent-touches-only-mailboxes: agent → NXS/NVG/ledger direct call blocked', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-120',
      failureClass: 'UNIMPLEMENTED_TEST_BODY',
      reason:
        'HL#16 — agent boundary. Body should prove there is no HTTP path from an agent to NXS/NVG/ledger directly, only through the orch + mailbox.',
      blockedBy: 'E2E-HARD-LAW-CATALOG',
      owner: 'builder',
      lawPins: ['HL#16'],
      nextRecommendedAction:
        'Enumerate registered agent endpoints; assert none expose a route that bypasses the orch + mailbox pipeline.',
    });
  });
});

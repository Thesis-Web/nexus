/**
 * tests/e2e/11-rbac-differentials.e2e.test.ts — E2E v0.4.0 §3.11
 *
 * Category 11: RBAC / OCT denial differentials. Same prompt across
 * roles; lower ranks denied, higher ranks allowed. Proves the
 * monotonic capability ladder + signed gate path.
 *
 * Owner directive 2026-05-21: no `it.skip`. Most differentials are
 * testable without external dependencies — they exercise gate denials.
 * E2E-110 (claim drift mid-run) needs a revoke surface that doesn't
 * exist yet.
 */
import { describe, it } from 'vitest';
import { AcceptanceWallFailure } from './_acceptance/failure.js';

describe('E2E Category 11 — RBAC / OCT denial differentials', () => {
  it('E2E-101-secret-data-access: janitor denied vs vp allowed', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-101',
      failureClass: 'UNIMPLEMENTED_SURFACE',
      reason:
        "No OCT-SECRET-classified resource is seeded. Sales/warehouse seeds are OCT-OPEN/OCT-CONFIDENTIAL. Without a secret-classified target on either connector, the catalog's `janitor denied vs vp allowed on secret data` differential has no read target to attempt. (vp's allowedCapabilities includes CAP_READ_SECRET + CAP_QUERY_SECRET; janitor has nothing — the capability ladder is in place, the seed data is not.)",
      blockedBy: 'E2E-RBAC-DIFFERENTIALS-CATALOG',
      owner: 'owner',
      lawPins: ['HL#5', 'HL#10'],
      suspectedRootCause:
        'Seed gap: no OCT-SECRET-tagged resource (e.g., secrets table on sales-finance, or a separate `secrets` system) seeded; allowed-tables manifest for connectors does not enumerate one either.',
      nextRecommendedAction:
        'Owner ratification: seed an OCT-SECRET resource (e.g., a `customer_payment_tokens` or `api_credentials` table in sales-finance with octLevel=OCT-SECRET) and update the connector allowed-table list. THEN body this slot as the janitor/vp differential on that resource.',
    });
  });
  it('E2E-102-bulk-delete: analyst denied vs vp Gate 05 approval', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-102',
      failureClass: 'UNIMPLEMENTED_SURFACE',
      reason:
        'Post bridge-fix (43e5ed3), the analyst-denial half is bodyable: analyst lacks CAP_DELETE_RECORD_BULK and the symmetric intersection with sales-agent (which does NOT carry delete:record:bulk either) is empty either way. But the vp-allowed half requires the Gate 05 approval flow (see E2E-109) which is the bottleneck — without a harness helper to respond to an approval request via the workspace HTTP surface, the vp leg cannot complete.',
      blockedBy: 'E2E-APPROVAL-FLOW-V1',
      owner: 'builder',
      lawPins: ['HL#5', 'HL#15'],
      nextRecommendedAction:
        "Build a `harness.respondToApproval(runId, decision, elevatedSession)` helper that drives the workspace approval HTTP route. THEN body this slot as two-persona: assert analyst denial via empty intersection (same pattern as E2E-28), assert vp run pends on `gate_05_require_approval`, harness approves, and the bulk delete reaches EXECUTED. (Caveat: vp's seeded allowedCapabilities currently lacks CAP_DELETE_RECORD_BULK; that promotion to vp would need owner ratification per the no-widening rule.)",
    });
  });
  it('E2E-103-policy-override-attempt: manager+ceo both denied without SigningCouncil 2-of-2', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-103',
      failureClass: 'UNIMPLEMENTED_SURFACE',
      reason:
        'No seeded policy requires SigningCouncil 2-of-2 quorum for any business-agent action. The SigningCouncil server-signer port exists (Patch 36) but the only signing flows wired are mode/policy envelopes signed server-side from keys/admins/<principalId>.keypair.json — there is no `requires_two_of_two_council` policy attached to a sales/warehouse action that manager+ceo could attempt and both be denied.',
      blockedBy: 'E2E-RBAC-DIFFERENTIALS-CATALOG',
      owner: 'owner',
      lawPins: ['HL#15'],
      suspectedRootCause:
        'Surface gap: no seeded `quorum_required` policy or capability declared on any business agent / target system. The 2-of-2 SigningCouncil is wired for admin mode/policy envelopes (per feedback_signing_keys_server_side); business actions do not currently route through any quorum-required gate.',
      nextRecommendedAction:
        'Owner ratification: declare a `quorum_required: 2_of_2_council` policy on a specific business action (e.g., production-data export from sales-finance), seed the council membership, then body this slot as manager+ceo both denied without quorum signing. Out of scope this session per Phase E.',
    });
  });
  it('E2E-104-cross-system-confidential: intern denied vs sr_analyst allowed', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-104',
      failureClass: 'UNIMPLEMENTED_SURFACE',
      reason:
        "Two compound gaps: (a) intern's allowedSystems=[] makes ANY system-targeted action fail at the symmetric intersection BEFORE OCT-CONFIDENTIAL classification fires — the catalog framing of `OCT differential` is masked by the F-15-style intersection-empty denial; (b) seed resources are not consistently OCT-CONFIDENTIAL-tagged across connectors in a way that distinguishes intern denial from sr_analyst allowance on classification alone.",
      blockedBy: 'E2E-RBAC-DIFFERENTIALS-CATALOG',
      owner: 'owner',
      lawPins: ['HL#5', 'HL#10'],
      nextRecommendedAction:
        'Either (a) amend the catalog row to use analyst (allowedSystems=[sales-finance]) vs sr_analyst (allowedSystems=[sales-finance,warehouse]) for a cross-system differential where the OCT-tag does the distinguishing, OR (b) seed an explicitly OCT-CONFIDENTIAL resource on a system the intern is granted but at lower OCT ceiling. Owner ratification.',
    });
  });
  it('E2E-105-firewall-egress-denied-by-role: janitor → frontier denied at NVG', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-105',
      failureClass: 'UNIMPLEMENTED_SURFACE',
      reason:
        "Catalog row persona is `janitor` (lowest tier). Reaching NVG firewall-egress denial requires the chat path (free_text → NVG firewall_transit_rights check vs adapter target). But janitor's allowedSystems=[] is disjoint from the default chat agent's allowedSystems=['stub'] — F-15 fires `delegation_empty_intersection` on target_systems BEFORE NVG runs, so the firewall-egress assertion can never fire on the janitor persona. Same cascade as E2E-60.",
      blockedBy: 'CHAT-AGENT-LADDER-INTERSECTION-EMPTY',
      owner: 'owner',
      lawPins: ['HL#6'],
      suspectedRootCause:
        'F-15 cascade (REPAIR-MODE-FINDINGS-2026-05-22-body-build.md): non-`dev-admin` ladder personas cannot mint a chat delegation against the default chat agent. Pre-NVG denial pre-empts the firewall-egress denial surface.',
      nextRecommendedAction:
        'Land any F-15 resolution option. After that lands, body this slot as `janitor` chat run with a public-facing-research prompt (would route to frontier) + assert NVG denies via firewall_transit_rights (janitor=TRANSIT_PUBLIC_ONLY) BEFORE any frontier adapter call.',
    });
  });
  it('E2E-106-bulk-pull-risk-ceiling: analyst → 10k row pull denied (medium < bulk:high)', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-106',
      failureClass: 'UNIMPLEMENTED_SURFACE',
      reason:
        "Catalog framing is broken three ways per F-14 (REPAIR-MODE-FINDINGS-2026-05-21-pass3.md): (1) analyst's allowedCapabilities does NOT include `read:record:bulk` — denial fires at Gate 03 CAPABILITY before Gate 02 RISK can evaluate; (2) the implemented runtime classifies sales-finance bulk reads at ≤medium (E2E-21 sr_analyst medium passes — confirms classification), so even with the bulk cap added, Gate 02 risk wouldn't deny medium-on-medium; (3) the postgres connector caps results at maxRows=500 — a 10k-row pull cannot occur at the connector boundary.",
      blockedBy: 'E2E-RBAC-DIFFERENTIALS-CATALOG',
      owner: 'owner',
      lawPins: ['HL#5', 'HL#10'],
      suspectedRootCause:
        'Catalog/runtime drift: F-14. The classifier is not scope-aware (bulk-export shapes do not tier up automatically), and the connector hard-caps at maxRows=500.',
      nextRecommendedAction:
        'Owner ruling between: (a) extend the runtime with a scope-aware risk classifier so `bulk export`-shaped reads tier up; (b) amend the catalog so bulk reads on sales-finance are categorically medium-risk and this slot is restated as a CAPABILITY-ladder differential (analyst denied on missing read:record:bulk; sr_analyst allowed). Until then, the row as written is unbuildable.',
    });
  });
  it('E2E-107-chain-depth-ceiling: sr_analyst → chain > maxChainDepth denied', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-107',
      failureClass: 'UNIMPLEMENTED_SURFACE',
      reason:
        'Catalog row needs a multi-agent DAG with chain depth > policy ceiling. The deep-chain harness helper does not exist (same blocker as E2E-64). Additionally, no policy currently declares a per-persona maxChainDepth — the chain-depth ceiling is a config surface that has not been seeded.',
      blockedBy: 'E2E-RBAC-DIFFERENTIALS-CATALOG',
      owner: 'arch',
      lawPins: ['HL#4', 'HL#5'],
      nextRecommendedAction:
        'Build (a) the multi-agent deep-chain harness helper (shared with E2E-64) AND (b) seed a `maxChainDepth` policy attached to sr_analyst (or the persona ladder). THEN body this slot as a chain-depth differential with a chain length that exceeds the ceiling.',
    });
  });
  it('E2E-108-environment-mismatch: analyst dev → prod target denied', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-108',
      failureClass: 'UNIMPLEMENTED_SURFACE',
      reason:
        'No `environment` tag is seeded on any target system today (sales-finance / warehouse / gmail are not labeled dev/staging/prod in config/connectors/connectors.v1.yaml). Without an environment-tagged connector, an "analyst-in-dev hitting a prod-tagged target" path has no concrete target to attempt. The HL#5 environment-mismatch surface is unbuilt end-to-end.',
      blockedBy: 'E2E-RBAC-DIFFERENTIALS-CATALOG',
      owner: 'owner',
      lawPins: ['HL#5'],
      nextRecommendedAction:
        'Owner ratification: declare an `environment: prod` tag on at least one seeded connector (e.g., gmail) and a matching `environment: dev` tag on the persona-level firewall rights. THEN body this slot as an analyst (env=dev) → connector (env=prod) denial.',
    });
  });
  it('E2E-109-external-facing-action: vp → Gate 04 approval flow', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-109',
      failureClass: 'UNIMPLEMENTED_SURFACE',
      reason:
        'Approval flow surface (Gate 04 require_approval → Gate 05 approval → Gate 06 grant) not exercised end-to-end via HTTP. Body needs harness helper for approval.',
      blockedBy: 'E2E-APPROVAL-FLOW-V1',
      owner: 'builder',
      lawPins: ['HL#5', 'HL#15'],
      nextRecommendedAction:
        'Build harness.respondToApproval(runId, decision) helper. Then write the approval roundtrip body.',
    });
  });
  it('E2E-110-revoked-mid-run: sr_analyst → mid-run RBAC revoke → claim drift', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-110',
      failureClass: 'UNIMPLEMENTED_SURFACE',
      reason:
        'No admin endpoint to revoke a capability mid-run. Three options open for owner ratification: (A) test-only harness route gated by NODE_ENV=test, (B) production POST /workspace/admin/principals/<id>/revoke signed mutation, (C) defer.',
      blockedBy: 'ADMIN-REVOKE-ENDPOINT-V1',
      owner: 'owner',
      lawPins: ['HL#14', 'HL#15'],
      nextRecommendedAction:
        'Owner ratification needed. Default proposal: (A) for the wall, (B) as a follow-on F4.9 patch.',
    });
  });
});

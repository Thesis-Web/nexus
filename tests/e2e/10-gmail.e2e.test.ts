/**
 * tests/e2e/10-gmail.e2e.test.ts — E2E v0.4.0 §3.10
 *
 * Category 10: Gmail compose / read. Owner ratification 2026-05-21:
 * Gmail is NOT the first email target — Mailpit (local SMTP/IMAP) is
 * staged for deterministic CI first, Gmail (real Google API + OAuth)
 * lands after the admin dashboard can configure connectors. Until
 * Mailpit is built AND the admin connect-mailpit flow works, every
 * Gmail slot fails red with the same blocker.
 */
import { describe, it } from 'vitest';
import { AcceptanceWallFailure } from './_acceptance/failure.js';

const GMAIL_BLOCKER = 'GMAIL-CONNECTOR-V1';

function gmailBlocked(testId: string, scenario: string, lawPins: ReadonlyArray<string>): never {
  throw new AcceptanceWallFailure({
    testId,
    failureClass: 'EXTERNAL_DEPENDENCY',
    reason: `Gmail connector not built. Scenario: ${scenario}.`,
    blockedBy: GMAIL_BLOCKER,
    owner: 'arch',
    lawPins,
    nextRecommendedAction:
      'Stage 1: build Mailpit connector + local docker container + 6 Mailpit tests (E2E-MAIL-001..006). Stage 2: build Gmail OAuth connector configured from admin dashboard. Stage 3: implement Gmail-specific scenarios here.',
  });
}

describe('E2E Category 10 — Gmail compose / read', () => {
  it('E2E-91-gmail-compose-draft: sr_manager → draft to ops@ about Q2', () => {
    gmailBlocked('E2E-91', 'compose draft', ['HL#5', 'HL#11']);
  });
  it('E2E-92-gmail-read-inbox: sr_manager → last 10 inbox threads', () => {
    gmailBlocked('E2E-92', 'read inbox', ['HL#5']);
  });
  it('E2E-93-gmail-compose-from-batch: director → customer follow-ups for order issues', () => {
    gmailBlocked('E2E-93', 'compose from batch — depends on NXS pull too', ['HL#5', 'HL#8']);
  });
  it('E2E-94-gmail-compose-multi-recipient: vp → board update to 5 recipients', () => {
    gmailBlocked('E2E-94', 'multi-recipient compose with approval', ['HL#5', 'HL#10']);
  });
  it('E2E-95-gmail-read-classify: director → classify inbox by topic', () => {
    gmailBlocked('E2E-95', 'inbox classification', ['HL#5']);
  });
  it('E2E-96-gmail-search: sr_manager → emails containing "invoice" last 30 days', () => {
    gmailBlocked('E2E-96', 'search inbox', ['HL#5']);
  });
  it('E2E-97-gmail-compose-with-attachment: director → email referencing sales PDF', () => {
    gmailBlocked('E2E-97', 'compose with attachment', ['HL#5']);
  });
  it('E2E-98-gmail-denied-low-clearance: intern lacks compose:email → Gate 03 denied', () => {
    gmailBlocked('E2E-98', 'denial differential at Gate 03', ['HL#5']);
  });
  it('E2E-99-gmail-compose-secure-data-denied: analyst → email OCT-CONFIDENTIAL → NVG denied', () => {
    gmailBlocked('E2E-99', 'NVG denial on OCT-CONFIDENTIAL outbound', ['HL#6', 'HL#10']);
  });
  it('E2E-100-gmail-multi-step-research-then-compose: ceo → research + classify + compose', () => {
    gmailBlocked('E2E-100', 'multi-step research+compose', ['HL#5', 'HL#6', 'HL#11']);
  });
});

/**
 * CompileAssemblerImpl — mailbox-pit V1 bypass-partial coverage.
 *
 * Spec: AMEND-nexus-mailbox-pit-v0-2-1 §5.2 + §9.1.
 *
 * Covers the four §5.2 disposition rows the assembler can produce:
 *   - slot_type_mismatch / render_partial (required + optional)
 *   - malformed_output / withhold_quarantine (agentId vs mailbox provenance)
 *   - digest_mismatch / withhold_quarantine (sha256 mismatch on read)
 *   - guard_halt / withhold_quarantine (halt guard fires)
 *
 * Sub-components (SlotMatcher / SlotValidator / GuardEvaluator /
 * DenialMarkerInserter / FormatRenderer) are inline-mocked so the
 * tests pin the assembler's collection law without dragging in the
 * full compile-ref machinery.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import type {
  BypassPartial,
  CompileFormat,
  CompileLocation,
  CompileTemplate,
  DataClass,
  MailboxItem,
  NonEmpty,
  PayloadResolver,
  Sha256Hex,
  Uuid,
  IsoTimestamp,
  OctLevel,
} from '@nexus/contracts';
import { CompileAssemblerImpl } from './compile-assembler.js';
import type { SlotMatcher, SlotMatchResult, MatchedSlot } from './slot-matcher.js';
import type { SlotValidator, SlotValidationResult } from './slot-validator.js';
import type { GuardEvaluator, GuardEvaluationResult, FiredGuard } from './guard-evaluator.js';
import type { DenialMarkerInserter, DenialOutput } from './denial-marker-inserter.js';
import type { FormatRenderer } from './format-renderer.js';

// ─── fixtures ──────────────────────────────────────────────────────────────

const RUN = '11111111-1111-4111-8111-111111111111' as Uuid;
const ACTOR_A = '22222222-2222-4222-8222-222222222222' as Uuid;
const ACTOR_B = '33333333-3333-4333-8333-333333333333' as Uuid;
const MBX_A = 'mbx-v1-run-RA-actor-AA' as NonEmpty;

function digestOf(text: string): Sha256Hex {
  return createHash('sha256').update(text).digest('hex') as Sha256Hex;
}

function mailboxItem(opts: {
  actorId: Uuid;
  mailboxId: NonEmpty;
  slotId: string;
  body: string;
  bodyDigestOverride?: Sha256Hex;
}): MailboxItem {
  return {
    mailboxItemId: ('00000000-0000-4000-a000-' +
      Math.random().toString(16).slice(2, 14).padStart(12, '0')) as Uuid,
    mailboxId: opts.mailboxId,
    runId: RUN,
    taskId: ('00000000-0000-4000-a000-' +
      Math.random().toString(16).slice(2, 14).padStart(12, '0')) as Uuid,
    agentId: opts.actorId,
    slotId: opts.slotId as NonEmpty,
    sourceType: 'nvg_result',
    resultRef: `mock://${opts.slotId}-${Math.random().toString(16).slice(2)}` as NonEmpty,
    resultDigest: opts.bodyDigestOverride ?? digestOf(opts.body),
    resultClassifications: [] as DataClass[],
    octLevel: 'OCT-OPEN' as OctLevel,
    createdAt: new Date().toISOString() as IsoTimestamp,
    expiresAt: null,
    evidenceRecordId: null,
    routingTrailRecordId: null,
    runLedgerEventId: null,
    redactionState: 'not_required',
    mailboxStatus: 'available',
    compileEligible: true,
    consumedAt: null,
    blockedReason: null,
  };
}

function mockTemplate(): CompileTemplate {
  return {
    templateId: 'tpl-test' as NonEmpty,
    templateVersion: '1' as NonEmpty,
    format: 'prose' as CompileFormat,
    sections: [],
    guards: [],
    denialHandling: 'inline',
  } as unknown as CompileTemplate;
}

function mockLocation(slotId: string, required: boolean): CompileLocation {
  return {
    locationId: `loc-${slotId}` as NonEmpty,
    expectedSlotId: slotId as NonEmpty,
    required,
    slotType: { type: 'prose', granularity: 'paragraph' },
  } as unknown as CompileLocation;
}

function mockPayloadResolver(body: string): PayloadResolver {
  return {
    resolverId: 'mock' as NonEmpty,
    resolverVersion: '1' as NonEmpty,
    canResolve: () => true,
    resolveBytes: async () => new TextEncoder().encode(body),
  };
}

function mockSlotMatcher(matched: Map<string, MatchedSlot>): SlotMatcher {
  return {
    match: (): SlotMatchResult => ({ matched, unmatched: [], orphaned: [] }),
  };
}

function mockSlotValidator(verdict: 'valid' | 'invalid'): SlotValidator {
  return {
    validate: async (loc): Promise<SlotValidationResult> =>
      verdict === 'valid'
        ? { valid: true, errors: [] }
        : {
            valid: false,
            errors: [{ locationId: loc.locationId as string, reason: 'mock validator rejected' }],
          },
  };
}

function mockGuardEvaluator(halt: boolean): GuardEvaluator {
  return {
    evaluate: (): GuardEvaluationResult => ({
      passed: !halt,
      haltGuard: halt
        ? ({
            guardId: 'g1' as NonEmpty,
            guardName: 'mock-halt' as NonEmpty,
            condition: { locationPath: 'sec.loc' as NonEmpty, operator: 'equals', value: 'x' },
            action: { effect: 'halt', targetLocationPath: 'sec.loc' as NonEmpty },
            severity: 'halt',
          } as unknown as FiredGuard)
        : null,
      firedGuards: [],
      warnings: [],
      modifications: [],
    }),
  };
}

const mockDenialMarker: DenialMarkerInserter = {
  insert: (): DenialOutput => ({ markers: [], entries: [] }) as unknown as DenialOutput,
};

const mockFormatRenderer: FormatRenderer = {
  format: 'prose' as CompileFormat,
  render: (): string => 'BODY',
};

function makeAssembler(opts: {
  matched: Map<string, MatchedSlot>;
  validatorVerdict?: 'valid' | 'invalid';
  guardHalt?: boolean;
}): CompileAssemblerImpl {
  return new CompileAssemblerImpl(
    mockSlotMatcher(opts.matched),
    mockSlotValidator(opts.validatorVerdict ?? 'valid'),
    mockGuardEvaluator(opts.guardHalt ?? false),
    new Map<CompileFormat, FormatRenderer>([['prose' as CompileFormat, mockFormatRenderer]]),
    mockDenialMarker
  );
}

// ─── tests ─────────────────────────────────────────────────────────────────

describe('CompileAssemblerImpl — bypass partial collection', () => {
  it('emits slot_type_mismatch / render_partial when the validator rejects an item', async () => {
    const item = mailboxItem({
      actorId: ACTOR_A,
      mailboxId: MBX_A,
      slotId: 'agent-output',
      body: 'hello',
    });
    const matched: Map<string, MatchedSlot> = new Map([
      ['loc-agent-output', { location: mockLocation('agent-output', false), items: [item] }],
    ]);
    const assembler = makeAssembler({ matched, validatorVerdict: 'invalid' });
    const result = await assembler.assemble(mockTemplate(), [item], [mockPayloadResolver('hello')]);

    expect(result.bypassPartials).toHaveLength(1);
    const bp = result.bypassPartials[0] as BypassPartial;
    expect(bp.bypassReason).toBe('slot_type_mismatch');
    expect(bp.bypassDisposition).toBe('render_partial');
    expect(bp.workspacePartialRef).toBe(item.resultRef);
    expect(bp.sourceActorId).toBe(ACTOR_A);
    expect(result.partial).toBe(true);
  });

  it('emits malformed_output / withhold_quarantine when item.agentId disagrees with mailbox-derived actorId', async () => {
    // Item CLAIMS to be from ACTOR_A but the provenance map says
    // mailbox MBX_A belongs to ACTOR_B. Compile detects the tampering.
    const item = mailboxItem({
      actorId: ACTOR_A,
      mailboxId: MBX_A,
      slotId: 'agent-output',
      body: 'malformed',
    });
    const matched: Map<string, MatchedSlot> = new Map([
      ['loc-agent-output', { location: mockLocation('agent-output', false), items: [item] }],
    ]);
    const assembler = makeAssembler({ matched });
    const provenance = new Map<NonEmpty, Uuid>([[MBX_A, ACTOR_B]]); // mailbox owned by B, not A
    const result = await assembler.assemble(
      mockTemplate(),
      [item],
      [mockPayloadResolver('malformed')],
      { mailboxProvenance: provenance }
    );

    expect(result.bypassPartials).toHaveLength(1);
    const bp = result.bypassPartials[0] as BypassPartial;
    expect(bp.bypassReason).toBe('malformed_output');
    expect(bp.bypassDisposition).toBe('withhold_quarantine');
    expect(bp.sourceActorId).toBe(ACTOR_B);
    expect(bp.workspacePartialRef).toBeNull();
  });

  it('emits digest_mismatch / withhold_quarantine when on-disk bytes do not hash to resultDigest', async () => {
    // resultDigest baked in for "expected-text" but resolver returns
    // "tampered-text" — sha256 won't match, quarantine.
    const item = mailboxItem({
      actorId: ACTOR_A,
      mailboxId: MBX_A,
      slotId: 'agent-output',
      body: 'expected-text',
      bodyDigestOverride: digestOf('expected-text'),
    });
    const matched: Map<string, MatchedSlot> = new Map([
      ['loc-agent-output', { location: mockLocation('agent-output', false), items: [item] }],
    ]);
    const assembler = makeAssembler({ matched });
    const result = await assembler.assemble(
      mockTemplate(),
      [item],
      [mockPayloadResolver('tampered-text')] // resolver returns different bytes
    );

    expect(result.bypassPartials).toHaveLength(1);
    const bp = result.bypassPartials[0] as BypassPartial;
    expect(bp.bypassReason).toBe('digest_mismatch');
    expect(bp.bypassDisposition).toBe('withhold_quarantine');
    expect(bp.workspacePartialRef).toBeNull();
  });

  it('emits guard_halt / withhold_quarantine on halt and clears validated fills', async () => {
    const item = mailboxItem({
      actorId: ACTOR_A,
      mailboxId: MBX_A,
      slotId: 'agent-output',
      body: 'ok',
    });
    const matched: Map<string, MatchedSlot> = new Map([
      ['loc-agent-output', { location: mockLocation('agent-output', false), items: [item] }],
    ]);
    const assembler = makeAssembler({ matched, guardHalt: true });
    const result = await assembler.assemble(mockTemplate(), [item], [mockPayloadResolver('ok')]);

    const haltBypass = result.bypassPartials.find(bp => bp.bypassReason === 'guard_halt');
    expect(haltBypass).toBeDefined();
    expect(haltBypass!.bypassDisposition).toBe('withhold_quarantine');
    expect(haltBypass!.workspacePartialRef).toBeNull();
    expect(result.partial).toBe(true);
  });

  it('returns empty bypassPartials when assembly is clean', async () => {
    const item = mailboxItem({
      actorId: ACTOR_A,
      mailboxId: MBX_A,
      slotId: 'agent-output',
      body: 'good',
    });
    const matched: Map<string, MatchedSlot> = new Map([
      ['loc-agent-output', { location: mockLocation('agent-output', false), items: [item] }],
    ]);
    const assembler = makeAssembler({ matched });
    const provenance = new Map<NonEmpty, Uuid>([[MBX_A, ACTOR_A]]); // matches
    const result = await assembler.assemble(mockTemplate(), [item], [mockPayloadResolver('good')], {
      mailboxProvenance: provenance,
    });

    expect(result.bypassPartials).toHaveLength(0);
  });

  it('does not double-record an item already bypassed earlier when a guard halt later fires', async () => {
    // First fail at provenance check (mismatch), then guard halt fires.
    // The provenance-fail entry should be the only one for that item.
    const item = mailboxItem({
      actorId: ACTOR_A,
      mailboxId: MBX_A,
      slotId: 'agent-output',
      body: 'x',
    });
    const matched: Map<string, MatchedSlot> = new Map([
      ['loc-agent-output', { location: mockLocation('agent-output', false), items: [item] }],
    ]);
    const assembler = makeAssembler({ matched, guardHalt: true });
    const provenance = new Map<NonEmpty, Uuid>([[MBX_A, ACTOR_B]]); // mismatch
    const result = await assembler.assemble(mockTemplate(), [item], [mockPayloadResolver('x')], {
      mailboxProvenance: provenance,
    });

    const forItem = result.bypassPartials.filter(bp => bp.mailboxItemId === item.mailboxItemId);
    expect(forItem).toHaveLength(1);
    expect(forItem[0]!.bypassReason).toBe('malformed_output');
  });
});

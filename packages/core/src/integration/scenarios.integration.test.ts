/**
 * Integration tests — all 10 POC scenarios + deterministic replay
 * Spec §27.3, §27.6 | Build sequence §26
 *
 * HOLE-404 (best-solve, owner approval required):
 *   setup.json schema not defined in spec. Derived from bootstrapScenario law
 *   (spec §3521). Schema fields: principal, actor, delegation, action, policyFile,
 *   sessionTtlSeconds, approver (approval scenarios), useBroadTokenConnector (scenario-09),
 *   replayActionId (scenario-06). Not canonized until owner approves.
 *
 * HOLE-405 (best-solve, owner approval required):
 *   Scenario-09 broad-token-bypass uses BroadTokenBypassConnector registered in test.
 *   This connector's execute() calls assertGrantPresent on a grant without a secret
 *   (skips redeemGrant), triggering NexusSecurityViolation → denied_threat via Gate 06.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

// Core
import { Pipeline, SimpleConnectorRegistry, SimpleChannelRegistry } from '../engine/pipeline.js';
import { IdentityGate } from '../gates/01-identity.gate.js';
import { ClassificationGate } from '../gates/02-classification.gate.js';
import { DelegationGate } from '../gates/03-delegation.gate.js';
import { PolicyGate } from '../gates/04-policy.gate.js';
import { ApprovalGate } from '../gates/05-approval.gate.js';
import { ExecutionGate } from '../gates/06-execution.gate.js';
import { EvidenceGate } from '../gates/07-evidence.gate.js';

// Classification
import { VerbNormalizer } from '../classification/verb-normalizer.js';
import { TargetNormalizer } from '../classification/target-normalizer.js';
import { DataClassifier } from '../classification/data-classifier.js';
import { RiskClassifier } from '../classification/risk-classifier.js';
import { CapabilityRegistry } from '../classification/capability-registry.js';

// Identity
import { ActorRegistry } from '../identity/actor-registry.js';
import { SqliteSessionStore } from '../identity/session-store.js';
import { PrincipalRegistry } from '../identity/principal-registry.js';
import { SqliteDelegationStore } from '../identity/delegation-store.js';
import { SqliteApproverRegistry } from '../identity/approver-registry.js';
import { mintRootDelegation } from '../identity/delegation-engine.js';

// Security
import { ReplayDetector } from '../security/replay-detector.js';
import { RateLimiter } from '../security/rate-limiter.js';

// Ledger + DB
import { JsonlLedgerBackend } from '../ledger/backends/jsonl.backend.js';
import { initializeSchema } from '../db/schema.js';

// Crypto
import { loadControlPlaneKey } from '../crypto/key-manager.js';
import { sign } from '../crypto/signer.js';
import { canonicalize } from '../crypto/canonicalize.js';

// Policy
import { loadPolicyFile } from '../policy/rule-loader.js';

// Execution
import { assertGrantPresent } from '../execution/grant-vault.js';

// Types
import {
  FINAL_OUTCOME,
  APPROVAL_DECISION_LABEL,
  DENIAL_CODE,
  ACTOR_CLASS,
  NexusSecurityViolation,
  PolicySignatureError,
  SCENARIO_MANIFEST,
  type KeyPair,
  type EvidenceRecord,
  type PipelineContext,
  type AgentAction,
  type Actor,
  type Principal,
  type ApprovalChannel,
  type ApprovalResponse,
  type ExecutionGrant,
  type ExecutionResult,
  type Connector,
  type ScenarioId,
} from '../types/index.js';
import { nowIso, addSeconds } from '../utils/time.js';

// ─── keypair loaded once ─────────────────────────────────────────────────────
let controlPlanePair: KeyPair;

beforeAll(async () => {
  controlPlanePair = await loadControlPlaneKey();
});

// ─── FixtureSetup type (HOLE-404 schema) ─────────────────────────────────────
interface FixtureSetup {
  scenarioId: string;
  description: string;
  principal: {
    principalId: string;
    displayName: string;
    email: string;
    maxDelegableRiskTier: string;
    allowedSystems: string[];
  };
  actor: {
    actorId: string;
    actorClass: string;
    displayName: string;
    environment: string;
    riskCeiling: string;
    allowedSystems: string[];
    owner?: string;
    purpose?: string;
    reviewCadence?: string;
  };
  delegation: {
    allowedSystems: string[];
    allowedCapabilities: string[];
    forbiddenCapabilities: string[];
    maxRiskTier: string;
    allowDownstreamPropagation: boolean;
    environment: string;
    ttlSeconds: number;
    maxChainDepth: number;
  };
  action: {
    tool: string;
    rawVerb: string;
    rawTarget: string;
    adapterVersion: string;
    intent: {
      objectiveSummary: string;
      triggeringSource: string;
      toolchainContext: string;
      modelId: string | null;
      modelConfidence: number | null;
      riskNote: string | null;
    };
  };
  approver?: {
    actorId: string;
    displayName: string;
    email: string;
  };
  policyFile: string | null;
  sessionTtlSeconds: number;
  expectedFinalOutcome: string;
  useBroadTokenConnector?: boolean;
  replayActionId?: string;
}

// ─── BroadTokenBypassConnector (HOLE-405) ────────────────────────────────────
// Simulates a connector that bypasses grant vault — calls execute() without
// redeemGrant, causing assertGrantPresent to throw NexusSecurityViolation.
class BroadTokenBypassConnector implements Connector {
  readonly systemType = 'stub';
  readonly connectorVersion = 'v0.1.0-bypass';

  supportedCapabilities(): string[] {
    return ['read:record:single'];
  }

  canProduceDiff(): boolean {
    return false;
  }

  async produceDiff(): Promise<string> {
    return '';
  }

  async redeemGrant(_grant: ExecutionGrant): Promise<void> {
    // Intentionally does NOT call setGrantSecret — simulates broad static credential bypass
  }

  async execute(_action: AgentAction, grant: ExecutionGrant): Promise<ExecutionResult> {
    // assertGrantPresent throws because redeemGrant did not set a secret
    assertGrantPresent(grant);
    // Unreachable — assertGrantPresent throws above
    return {
      grantId: grant.grantId,
      executedAt: nowIso(),
      status: 'success',
      responseCode: '200',
      durationMs: 0,
      redactedSummary: '',
      errorType: null,
      errorMessage: null,
    };
  }
}

// ─── Mock approval channel ────────────────────────────────────────────────────
function makeMockChannel(
  decision: 'approved' | 'denied' | 'timeout',
  approverPair: KeyPair,
  approverId: string
): ApprovalChannel {
  return {
    channelId: 'cli',
    async dispatch() {},
    async awaitDecision(request): Promise<ApprovalResponse | null> {
      if (decision === 'timeout') return null;

      const body = {
        approvalId: request.approvalId,
        decision:
          decision === 'approved'
            ? APPROVAL_DECISION_LABEL.APPROVED
            : APPROVAL_DECISION_LABEL.DENIED,
        decidedBy: approverId,
        decidedAt: nowIso(),
        channel: 'cli',
        note: null,
      };
      const signature = await sign(canonicalize(body), approverPair);
      return { ...body, signature };
    },
  };
}

// ─── Generate approver keypair in-memory ─────────────────────────────────────
async function generateTestApproverKeypair(): Promise<KeyPair> {
  // Use noble directly for in-memory approver key (no file I/O)
  const { etc, getPublicKeyAsync, utils } = await import('@noble/ed25519');
  const { sha512 } = await import('@noble/hashes/sha512');
  etc.sha512Sync = (...m: Uint8Array[]) => sha512(Buffer.concat(m));

  const privBytes = utils.randomPrivateKey();
  const pubBytes = await getPublicKeyAsync(privBytes);
  return {
    publicKey: Buffer.from(pubBytes).toString('base64url'),
    privateKey: Buffer.from(privBytes).toString('base64url'),
    generatedAt: nowIso(),
    purpose: 'approver',
  };
}

// ─── Core test helper — runScenario ──────────────────────────────────────────
async function runScenario(
  scenarioId: ScenarioId,
  options: { approvalDecision?: 'approved' | 'denied' | 'timeout' } = {}
): Promise<{ evidenceRecord: EvidenceRecord }> {
  // 1. Load fixture
  const fixturePath = SCENARIO_MANIFEST[scenarioId].fixturePath;
  const setupRaw = await fs.readFile(path.join(fixturePath, 'setup.json'), 'utf-8');
  const setup = JSON.parse(setupRaw) as FixtureSetup;

  // 2. In-memory SQLite DB
  const db = new Database(':memory:');
  initializeSchema(db);

  // 3. Registries
  const actorReg = new ActorRegistry(db);
  const sessionStore = new SqliteSessionStore(db);
  const principalReg = new PrincipalRegistry(db);
  const delegStore = new SqliteDelegationStore(db);
  const approverReg = new SqliteApproverRegistry(db);

  // 4. Register principal
  const principal: Principal = {
    principalId: setup.principal.principalId,
    displayName: setup.principal.displayName,
    email: setup.principal.email,
    registeredAt: nowIso(),
    maxDelegableRiskTier: setup.principal.maxDelegableRiskTier as any,
    allowedSystems: setup.principal.allowedSystems,
  };
  await principalReg.register(principal);

  // 5. Register actor
  const actor: Actor = {
    actorId: setup.actor.actorId,
    actorClass: setup.actor.actorClass as any,
    principalId: principal.principalId,
    displayName: setup.actor.displayName,
    environment: setup.actor.environment as any,
    riskCeiling: setup.actor.riskCeiling as any,
    allowedSystems: setup.actor.allowedSystems,
    registeredAt: nowIso(),
    owner: setup.actor.owner,
    purpose: setup.actor.purpose,
    reviewCadence: setup.actor.reviewCadence,
  };
  await actorReg.register(actor);

  // 6. Optional approver registration
  let approverPair: KeyPair | null = null;
  if (setup.approver) {
    approverPair = await generateTestApproverKeypair();

    const approverActor: Actor = {
      actorId: setup.approver.actorId,
      actorClass: ACTOR_CLASS.HUMAN,
      principalId: principal.principalId,
      displayName: setup.approver.displayName,
      environment: 'dev' as any,
      riskCeiling: 'critical' as any,
      allowedSystems: ['stub'],
      registeredAt: nowIso(),
    };
    await actorReg.register(approverActor);
    await approverReg.register({
      approverId: setup.approver.actorId,
      displayName: setup.approver.displayName,
      publicKey: approverPair.publicKey,
      channels: ['cli'],
      registeredAt: nowIso(),
    });
  }

  // 7. Mint root delegation
  const dc = await mintRootDelegation(principal, actor, {
    principalId: principal.principalId,
    actorId: actor.actorId,
    allowedSystems: setup.delegation.allowedSystems,
    allowedCapabilities: setup.delegation.allowedCapabilities,
    forbiddenCapabilities: setup.delegation.forbiddenCapabilities,
    maxRiskTier: setup.delegation.maxRiskTier as any,
    allowDownstreamPropagation: setup.delegation.allowDownstreamPropagation,
    environment: setup.delegation.environment as any,
    expiresAt: addSeconds(nowIso(), setup.delegation.ttlSeconds),
    maxChainDepth: setup.delegation.maxChainDepth,
  });
  await delegStore.save(dc);

  // 8. Create session
  const sessionId = randomUUID();
  await sessionStore.create({
    sessionId,
    actorId: actor.actorId,
    principalId: principal.principalId,
    delegationId: dc.delegationId,
    createdAt: nowIso(),
    expiresAt: addSeconds(nowIso(), setup.sessionTtlSeconds),
  });

  // 9. Load policy (null = default deny path)
  let policyFile = null;
  if (setup.policyFile) {
    policyFile = await loadPolicyFile(setup.policyFile, controlPlanePair);
  }

  // 10. Wire classification layer
  const capabilityRegistry = new CapabilityRegistry();
  const riskClassifier = new RiskClassifier(capabilityRegistry);

  // 11. Wire gates
  const identityGate = new IdentityGate(actorReg, sessionStore, principalReg, delegStore);
  const classificationGate = new ClassificationGate(
    new VerbNormalizer(),
    new TargetNormalizer(),
    new DataClassifier(),
    riskClassifier
  );
  const delegationGate = new DelegationGate(controlPlanePair);
  const policyGate = new PolicyGate();
  const approvalGate = new ApprovalGate(controlPlanePair);
  const executionGate = new ExecutionGate(controlPlanePair);

  // Ledger (temp file per test)
  const ledgerPath = path.join('/tmp', `nexus-integration-${scenarioId}-${randomUUID()}.jsonl`);
  const ledger = new JsonlLedgerBackend(ledgerPath);
  const evidenceGate = new EvidenceGate(ledger, controlPlanePair);

  // 12. Wire registries
  const connectorRegistry = new SimpleConnectorRegistry();
  if (setup.useBroadTokenConnector) {
    connectorRegistry.register(new BroadTokenBypassConnector());
  } else {
    // Dynamically import StubConnector (lives in connectors package)
    const { StubConnector } = await import('../../../connectors/stub/stub.connector.js');
    connectorRegistry.register(new StubConnector());
  }

  const channelRegistry = new SimpleChannelRegistry();
  if (setup.approver && approverPair) {
    channelRegistry.register(
      makeMockChannel(options.approvalDecision ?? 'approved', approverPair, setup.approver.actorId)
    );
  }

  // 13. Build pipeline
  const replayDetector = new ReplayDetector(db);
  const rateLimiter = new RateLimiter();

  const pipeline = new Pipeline(
    {
      identity: identityGate,
      classification: classificationGate,
      delegation: delegationGate,
      policy: policyGate,
      approval: approvalGate,
      execution: executionGate,
      evidence: evidenceGate,
    },
    replayDetector,
    rateLimiter,
    db
  );

  // 14. Build action (no delegationSequence — pipeline assigns it)
  const rawAction: Omit<AgentAction, 'delegationSequence'> = {
    actionId: randomUUID(),
    receivedAt: nowIso(),
    protocol: 'fixture/v0.1.0',
    adapterVersion: setup.action.adapterVersion,
    actorId: actor.actorId,
    principalId: principal.principalId,
    sessionId,
    delegationId: dc.delegationId,
    tool: setup.action.tool,
    rawVerb: setup.action.rawVerb,
    rawTarget: setup.action.rawTarget,
    rawPayload: null,
    intent: {
      ...setup.action.intent,
      extractedAt: nowIso(),
    } as any,
    resolvedVerb: null,
    resolvedCapability: null,
    resolvedTarget: null,
    resolvedDataClasses: [],
    resolvedRiskTier: null,
  };

  // 15. Build context
  const context: PipelineContext = {
    sessionId,
    delegationStore: delegStore,
    policyFile,
    approverRegistry: approverReg,
    connectorRegistry,
    channelRegistry,
    threatLog: [],
    startedAt: nowIso(),
  } as any;

  // 16. Run pipeline
  const evidenceRecord = await pipeline.process(rawAction, context);

  // Clean up temp ledger
  await fs.unlink(ledgerPath).catch(() => {});

  return { evidenceRecord };
}

// ─── Common assertion helpers ─────────────────────────────────────────────────
function assertBaseInvariants(record: EvidenceRecord): void {
  expect(record.actionSummary.actorClass).toBeTruthy();
  expect(record.actionSummary.actorEnvironment).toBeTruthy();
  expect(typeof record.actionSummary.delegationSequence).toBe('number');
  expect(record.actionSummary.delegationSequence).toBeGreaterThan(0);
  // CCV is inside the signed body (MODULAR-009)
  expect(record.compilerView).toBeDefined();
  expect(record.compilerView.identity.actorClass).toBeTruthy();
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('Integration: POC Scenarios (spec §27.3)', () => {
  it('scenario-01: low-risk read → executed', async () => {
    const { evidenceRecord } = await runScenario('01-allow-read');

    expect(evidenceRecord.finalOutcome).toBe(FINAL_OUTCOME.EXECUTED);
    expect(evidenceRecord.grantMetadata).not.toBeNull();
    assertBaseInvariants(evidenceRecord);
  });

  it('scenario-02: medium-risk create → executed', async () => {
    const { evidenceRecord } = await runScenario('02-allow-create');

    expect(evidenceRecord.finalOutcome).toBe(FINAL_OUTCOME.EXECUTED);
    expect(evidenceRecord.grantMetadata).not.toBeNull();
    assertBaseInvariants(evidenceRecord);
  });

  it('scenario-03: high-risk send with approval → approved → executed', async () => {
    const { evidenceRecord } = await runScenario('03-approval-approved', {
      approvalDecision: 'approved',
    });

    expect(evidenceRecord.finalOutcome).toBe(FINAL_OUTCOME.EXECUTED);
    expect(evidenceRecord.approvalResponse?.decision).toBe(APPROVAL_DECISION_LABEL.APPROVED);
    expect(evidenceRecord.compilerView.policyAndApproval.approvalRequired).toBe(true);
    expect(evidenceRecord.grantMetadata).not.toBeNull();
    assertBaseInvariants(evidenceRecord);
  });

  it('scenario-04: high-risk send with approval → denied', async () => {
    const { evidenceRecord } = await runScenario('04-approval-denied', {
      approvalDecision: 'denied',
    });

    expect(evidenceRecord.finalOutcome).toBe(FINAL_OUTCOME.DENIED_APPROVAL);
    expect(evidenceRecord.approvalResponse?.decision).toBe(APPROVAL_DECISION_LABEL.DENIED);
    assertBaseInvariants(evidenceRecord);
  });

  it('scenario-05: high-risk send with approval → timeout → denied_timeout (never allow)', async () => {
    const { evidenceRecord } = await runScenario('05-approval-timeout', {
      approvalDecision: 'timeout',
    });

    expect(evidenceRecord.finalOutcome).toBe(FINAL_OUTCOME.DENIED_TIMEOUT);
    // Timeout must NEVER produce executed
    expect(evidenceRecord.finalOutcome).not.toBe(FINAL_OUTCOME.EXECUTED);
    assertBaseInvariants(evidenceRecord);
  });

  it('scenario-06: replay of scenario-01 action → denied_threat (REPLAY_DETECTED)', async () => {
    // Bootstrap once, then submit the SAME actionId twice
    const setup = JSON.parse(
      await fs.readFile(
        path.join(SCENARIO_MANIFEST['06-replay-detected'].fixturePath, 'setup.json'),
        'utf-8'
      )
    ) as FixtureSetup;

    const db = new Database(':memory:');
    initializeSchema(db);

    const actorReg = new ActorRegistry(db);
    const sessionStore = new SqliteSessionStore(db);
    const principalReg = new PrincipalRegistry(db);
    const delegStore = new SqliteDelegationStore(db);

    const principal: Principal = {
      principalId: setup.principal.principalId,
      displayName: setup.principal.displayName,
      email: setup.principal.email,
      registeredAt: nowIso(),
      maxDelegableRiskTier: setup.principal.maxDelegableRiskTier as any,
      allowedSystems: setup.principal.allowedSystems,
    };
    await principalReg.register(principal);

    const actor: Actor = {
      actorId: setup.actor.actorId,
      actorClass: setup.actor.actorClass as any,
      principalId: principal.principalId,
      displayName: setup.actor.displayName,
      environment: setup.actor.environment as any,
      riskCeiling: setup.actor.riskCeiling as any,
      allowedSystems: setup.actor.allowedSystems,
      registeredAt: nowIso(),
      owner: setup.actor.owner,
      purpose: setup.actor.purpose,
      reviewCadence: setup.actor.reviewCadence,
    };
    await actorReg.register(actor);

    const dc = await mintRootDelegation(principal, actor, {
      principalId: principal.principalId,
      actorId: actor.actorId,
      ...setup.delegation,
      maxRiskTier: setup.delegation.maxRiskTier as any,
      environment: setup.delegation.environment as any,
      expiresAt: addSeconds(nowIso(), setup.delegation.ttlSeconds),
    });
    await delegStore.save(dc);

    const sessionId = randomUUID();
    await sessionStore.create({
      sessionId,
      actorId: actor.actorId,
      principalId: principal.principalId,
      delegationId: dc.delegationId,
      createdAt: nowIso(),
      expiresAt: addSeconds(nowIso(), setup.sessionTtlSeconds),
    });

    const policyFile = await loadPolicyFile(setup.policyFile!, controlPlanePair);
    const capReg = new CapabilityRegistry();
    const pipeline = new Pipeline(
      {
        identity: new IdentityGate(actorReg, sessionStore, principalReg, delegStore),
        classification: new ClassificationGate(
          new VerbNormalizer(),
          new TargetNormalizer(),
          new DataClassifier(),
          new RiskClassifier(capReg)
        ),
        delegation: new DelegationGate(controlPlanePair),
        policy: new PolicyGate(),
        approval: new ApprovalGate(controlPlanePair),
        execution: new ExecutionGate(controlPlanePair),
        evidence: new EvidenceGate(
          new JsonlLedgerBackend(`/tmp/nexus-replay-${randomUUID()}.jsonl`),
          controlPlanePair
        ),
      },
      new ReplayDetector(db),
      new RateLimiter(),
      db
    );

    const { StubConnector } = await import('../../../connectors/stub/stub.connector.js');
    const connReg = new SimpleConnectorRegistry();
    connReg.register(new StubConnector());

    const baseContext = (): PipelineContext =>
      ({
        sessionId,
        delegationStore: delegStore,
        policyFile,
        approverRegistry: new SqliteApproverRegistry(db),
        connectorRegistry: connReg,
        channelRegistry: new SimpleChannelRegistry(),
        threatLog: [],
        startedAt: nowIso(),
        actor: actor as any,
        principal: principal as any,
        delegationContext: dc as any,
      }) as any;

    const fixedActionId = setup.replayActionId ?? 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const baseAction = (): Omit<AgentAction, 'delegationSequence'> => ({
      actionId: fixedActionId,
      receivedAt: nowIso(),
      protocol: 'fixture/v0.1.0',
      adapterVersion: setup.action.adapterVersion,
      actorId: actor.actorId,
      principalId: principal.principalId,
      sessionId,
      delegationId: dc.delegationId,
      tool: setup.action.tool,
      rawVerb: setup.action.rawVerb,
      rawTarget: setup.action.rawTarget,
      rawPayload: null,
      intent: { ...setup.action.intent, extractedAt: nowIso() } as any,
      resolvedVerb: null,
      resolvedCapability: null,
      resolvedTarget: null,
      resolvedDataClasses: [],
      resolvedRiskTier: null,
    });

    // First run — should succeed
    const first = await pipeline.process(baseAction(), baseContext());
    expect(first.finalOutcome).toBe(FINAL_OUTCOME.EXECUTED);

    // Second run — SAME actionId → replay detected → denied_threat
    const second = await pipeline.process(baseAction(), baseContext());
    expect(second.finalOutcome).toBe(FINAL_OUTCOME.DENIED_THREAT);

    // Assert actorClass and actorEnvironment present in replay record
    expect(second.actionSummary.actorClass).toBeTruthy();
    expect(second.actionSummary.actorEnvironment).toBeTruthy();
  });

  it('scenario-07: no policy loaded → denied_policy (DEFAULT_DENY)', async () => {
    const { evidenceRecord } = await runScenario('07-default-deny');

    expect(evidenceRecord.finalOutcome).toBe(FINAL_OUTCOME.DENIED_POLICY);
    const policyDecision = evidenceRecord.gateDecisions.find(d => d.gateId === 'gate_04_policy');
    expect(policyDecision?.denialCode).toBe(DENIAL_CODE.DEFAULT_DENY);
    assertBaseInvariants(evidenceRecord);
  });

  it('scenario-08: unsigned policy → PolicySignatureError at load', async () => {
    await expect(runScenario('08-policy-unsigned')).rejects.toThrow(PolicySignatureError);
  });

  it('scenario-09: broad token bypass → connector throws NexusSecurityViolation → denied_threat', async () => {
    const { evidenceRecord } = await runScenario('09-broad-token-bypass');

    expect(evidenceRecord.finalOutcome).toBe(FINAL_OUTCOME.DENIED_THREAT);
    assertBaseInvariants(evidenceRecord);
  });

  it('scenario-10: DELEGATED_SUBAGENT capability outside delegation → denied_delegation', async () => {
    const { evidenceRecord } = await runScenario('10-delegation-exceeded');

    expect(evidenceRecord.finalOutcome).toBe(FINAL_OUTCOME.DENIED_DELEGATION);
    const delegationDecision = evidenceRecord.gateDecisions.find(
      d => d.gateId === 'gate_03_delegation'
    );
    expect(delegationDecision?.denialCode).toBe(DENIAL_CODE.CAPABILITY_NOT_IN_DELEGATION);
    assertBaseInvariants(evidenceRecord);
  });
});

describe('Integration: Deterministic Replay Test (spec §27.6)', () => {
  it('same scenario run twice produces byte-identical CCV (scenarios 01, 02, 03)', async () => {
    for (const id of ['01-allow-read', '02-allow-create', '03-approval-approved'] as ScenarioId[]) {
      const r1 = await runScenario(id, { approvalDecision: 'approved' });
      const r2 = await runScenario(id, { approvalDecision: 'approved' });

      // CCV fields used for comparison must be byte-identical
      // normalizedActionHash is deterministic for same action content
      expect(r1.evidenceRecord.compilerView.meta.normalizedActionHash).toBe(
        r2.evidenceRecord.compilerView.meta.normalizedActionHash
      );
      expect(r1.evidenceRecord.compilerView.classification.capabilityId).toBe(
        r2.evidenceRecord.compilerView.classification.capabilityId
      );
      expect(r1.evidenceRecord.compilerView.identity.actorClass).toBe(
        r2.evidenceRecord.compilerView.identity.actorClass
      );
      expect(r1.evidenceRecord.compilerView.identity.environment).toBe(
        r2.evidenceRecord.compilerView.identity.environment
      );
    }
    // Write CCV hash files for ci:gate step 6 — spec §26.4
    const runsDir = path.resolve('runs');
    await fs.mkdir(runsDir, { recursive: true });
    const runA: Record<string, string> = {};
    const runB: Record<string, string> = {};
    for (const id of ['01-allow-read', '02-allow-create', '03-approval-approved'] as ScenarioId[]) {
      const rx = await runScenario(id, { approvalDecision: 'approved' });
      const ry = await runScenario(id, { approvalDecision: 'approved' });
      runA[id] = JSON.stringify(rx.evidenceRecord.compilerView);
      runB[id] = JSON.stringify(ry.evidenceRecord.compilerView);
    }
    await fs.writeFile(
      path.join(runsDir, 'replay-ccv-hashes-run-a.json'),
      JSON.stringify(runA, null, 2)
    );
    await fs.writeFile(
      path.join(runsDir, 'replay-ccv-hashes-run-b.json'),
      JSON.stringify(runB, null, 2)
    );
    await fs.writeFile(path.join(runsDir, 'replay-ccv-hashes.json'), JSON.stringify(runA, null, 2));
  });
});

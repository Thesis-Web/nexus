import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import {
  SCENARIO_MANIFEST,
  initializeSchema,
  loadControlPlaneKey,
  SqliteActorRegistry,
  SqlitePrincipalRegistry,
  SqliteSessionStore,
  SqliteDelegationStore,
  SqliteApproverRegistry,
  CapabilityRegistry,
  VerbNormalizer,
  TargetNormalizer,
  DataClassifier,
  RiskClassifier,
  IdentityGate,
  ClassificationGate,
  DelegationGate,
  PolicyGate,
  ApprovalGate,
  ExecutionGate,
  EvidenceGate,
  JsonlLedgerBackend,
  Pipeline,
  SimpleConnectorRegistry,
  SimpleChannelRegistry,
  ReplayDetector,
  RateLimiter,
  loadPolicyFile,
  mintRootDelegation,
  nowIso,
  newUuid,
  addSeconds,
} from '@nexus/core';
import type {
  ScenarioId,
  EvidenceRecord,
  Actor,
  Principal,
  AgentAction,
  TokenPostureReport,
  PostureViolation,
  ActorPosture,
  PipelineContext,
} from '@nexus/core';
import { StubConnector } from '@nexus/connector-stub';

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
  policyFile: string | null;
  sessionTtlSeconds: number;
  expectedFinalOutcome: string;
  replayActionId?: string;
}
interface RunResult {
  scenarioId: string;
  evidenceRecord: EvidenceRecord;
  finalOutcome: string;
}
export interface RunOptions {
  scenario?: ScenarioId;
  fixturesAll?: boolean;
  outDir?: string;
}

export async function cmdRun(opts: RunOptions): Promise<void> {
  if (opts.scenario && !(opts.scenario in SCENARIO_MANIFEST)) {
    console.error(`✗ Unknown scenario: ${opts.scenario}`);
    process.exit(1);
  }
  const runId = 'RUN-' + crypto.randomUUID().slice(0, 8).toUpperCase();
  const outDir = path.resolve(opts.outDir ?? path.join('runs', runId));
  await fs.mkdir(outDir, { recursive: true });
  console.log(`Starting run ${runId} → ${outDir}`);
  const runDb = new Database(path.join(outDir, 'run.db'));
  initializeSchema(runDb);
  const runLedger = new JsonlLedgerBackend(path.join(outDir, '08-evidence-ledger.jsonl'));
  const controlPlaneKey = await loadControlPlaneKey();
  const scenarioIds: ScenarioId[] = opts.fixturesAll
    ? (Object.keys(SCENARIO_MANIFEST) as ScenarioId[])
    : [opts.scenario!];
  const results: RunResult[] = [];
  const ingestLog: unknown[] = [];
  const gateDecisionLog: unknown[] = [];
  const policyLog: unknown[] = [];
  const approvalLog: unknown[] = [];
  const threatLog: unknown[] = [];
  const executionLog: unknown[] = [];
  const allActors: unknown[] = [];
  const allSessions: unknown[] = [];
  const allDelegations: unknown[] = [];
  for (const scenarioId of scenarioIds) {
    const fixturePath = SCENARIO_MANIFEST[scenarioId].fixturePath;
    const setup = JSON.parse(
      await fs.readFile(path.join(fixturePath, 'setup.json'), 'utf-8')
    ) as FixtureSetup;
    console.log(`  Running: ${scenarioId} — ${setup.description}`);
    try {
      const result = await runScenario(setup, runDb, runLedger, controlPlaneKey, runId);
      results.push({
        scenarioId,
        evidenceRecord: result.record,
        finalOutcome: result.record.finalOutcome,
      });
      ingestLog.push({
        scenarioId,
        actionId: result.record.actionId,
        receivedAt: result.record.actionSummary.receivedAt,
        finalOutcome: result.record.finalOutcome,
      });
      gateDecisionLog.push(...result.record.gateDecisions.map(d => ({ scenarioId, ...d })));
      if (result.record.policyRuleId)
        policyLog.push({
          scenarioId,
          ruleId: result.record.policyRuleId,
          outcome: result.record.policyOutcome,
        });
      if (result.record.approvalRequest)
        approvalLog.push({
          scenarioId,
          request: result.record.approvalRequest,
          response: result.record.approvalResponse,
        });
      if (result.record.threatEvents.length > 0)
        threatLog.push(...result.record.threatEvents.map(e => ({ scenarioId, ...e })));
      if (result.record.executionResult)
        executionLog.push({ scenarioId, ...result.record.executionResult });
      allActors.push(setup.actor);
      allSessions.push({ scenarioId, sessionId: result.sessionId });
      allDelegations.push({ scenarioId, delegationId: result.delegationId });
    } catch (err) {
      console.error(`  ✗ ${scenarioId}: ${err instanceof Error ? err.message : String(err)}`);
      await wj(path.join(outDir, '00-failure-log.json'), {
        scenarioId,
        error: String(err),
        at: nowIso(),
      });
    }
  }
  const actors = await new SqliteActorRegistry(runDb).list();
  const violations: PostureViolation[] = actors
    .filter((a: Actor) => a.actorClass !== 'human' && !a.owner)
    .map((a: Actor) => ({
      type: 'unowned_non_human_actor' as const,
      detail: `Non-human actor ${a.actorId} has no owner`,
      actorId: a.actorId,
    }));
  const actorPostures: ActorPosture[] = actors.map((a: Actor) => ({
    actorId: a.actorId,
    actorClass: a.actorClass,
    owner: a.owner ?? null,
    environment: a.environment,
    grantCount: 0,
    maxRiskSeen: a.riskCeiling,
    hasOwner: !!a.owner,
  }));
  const postureReport: TokenPostureReport = {
    generatedAt: nowIso(),
    runId,
    actors: actorPostures,
    grantPatterns: [],
    violations,
  };
  await wj(path.join(outDir, '01-ingest-log.json'), ingestLog);
  await wj(path.join(outDir, '02-session-manifest.json'), allSessions);
  await wj(path.join(outDir, '03-actor-manifest.json'), allActors);
  await wj(path.join(outDir, '04-delegation-registry.json'), allDelegations);
  await wj(path.join(outDir, '05-gate-decision-log.json'), gateDecisionLog);
  await wj(path.join(outDir, '06-policy-evaluation-log.json'), policyLog);
  await wj(path.join(outDir, '07-approval-record-log.json'), approvalLog);
  await wj(path.join(outDir, '09-threat-detection-log.json'), threatLog);
  await wj(path.join(outDir, '10-execution-result-log.json'), executionLog);
  await wj(path.join(outDir, '11-token-posture-report.json'), postureReport);
  await fs.writeFile(
    path.join(outDir, '12-run-summary.md'),
    [
      `# Nexus Run Summary`,
      ``,
      `**Run ID**: ${runId}`,
      `**Generated**: ${nowIso()}`,
      ``,
      ...results.map(r => `- **${r.scenarioId}**: \`${r.finalOutcome}\``),
    ].join('\n'),
    'utf-8'
  );
  console.log(`\n✓ Run ${runId} complete — ${results.length} scenario(s)`);
}

async function runScenario(
  setup: FixtureSetup,
  db: Database.Database,
  ledger: JsonlLedgerBackend,
  controlPlaneKey: any,
  runId: string
): Promise<{ record: EvidenceRecord; sessionId: string; delegationId: string }> {
  const actorReg = new SqliteActorRegistry(db);
  const principalReg = new SqlitePrincipalRegistry(db);
  const sessionStore = new SqliteSessionStore(db);
  const delegStore = new SqliteDelegationStore(db);
  const approverReg = new SqliteApproverRegistry(db);
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
    ...(setup.actor.owner !== undefined ? { owner: setup.actor.owner } : {}),
    ...(setup.actor.purpose !== undefined ? { purpose: setup.actor.purpose } : {}),
    ...(setup.actor.reviewCadence !== undefined
      ? { reviewCadence: setup.actor.reviewCadence }
      : {}),
  } as Actor;
  await actorReg.register(actor);
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
  const sessionId = newUuid();
  await sessionStore.create({
    sessionId,
    actorId: actor.actorId,
    principalId: principal.principalId,
    delegationId: dc.delegationId,
    createdAt: nowIso(),
    expiresAt: addSeconds(nowIso(), setup.sessionTtlSeconds),
  });
  let policyFile = null;
  if (setup.policyFile) {
    try {
      policyFile = await loadPolicyFile(setup.policyFile, controlPlaneKey);
    } catch {
      policyFile = null;
    }
  }
  const connectorReg = new SimpleConnectorRegistry();
  connectorReg.register(new StubConnector());
  const capReg = new CapabilityRegistry();
  const riskClassifier = new RiskClassifier(capReg);
  const pipeline = new Pipeline(
    {
      identity: new IdentityGate(actorReg, sessionStore, principalReg, delegStore),
      classification: new ClassificationGate(
        new VerbNormalizer(),
        new TargetNormalizer(),
        new DataClassifier(),
        riskClassifier
      ),
      delegation: new DelegationGate(controlPlaneKey),
      policy: new PolicyGate(),
      approval: new ApprovalGate(controlPlaneKey),
      execution: new ExecutionGate(controlPlaneKey),
      evidence: new EvidenceGate(ledger, controlPlaneKey),
    },
    new ReplayDetector(db),
    new RateLimiter(),
    db
  );
  const rawAction: Omit<AgentAction, 'delegationSequence'> = {
    actionId: setup.replayActionId ?? newUuid(),
    runId,
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
      objectiveSummary: setup.action.intent.objectiveSummary,
      triggeringSource: setup.action.intent.triggeringSource as any,
      toolchainContext: setup.action.intent.toolchainContext,
      modelId: setup.action.intent.modelId,
      modelConfidence: setup.action.intent.modelConfidence,
      riskNote: setup.action.intent.riskNote,
      extractedAt: nowIso(),
    },
    resolvedVerb: null,
    resolvedCapability: null,
    resolvedTarget: null,
    resolvedDataClasses: [],
    resolvedRiskTier: null,
  };
  const record = await pipeline.process(rawAction, {
    sessionId,
    delegationContext: undefined as any,
    actor: undefined as any,
    principal: undefined as any,
    policyFile,
    approverRegistry: approverReg,
    connectorRegistry: connectorReg,
    channelRegistry: new SimpleChannelRegistry(),
    threatLog: [] as any[],
    startedAt: nowIso(),
    delegationStore: delegStore,
  });
  return { record, sessionId, delegationId: dc.delegationId };
}
async function wj(filePath: string, data: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

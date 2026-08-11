import {
  type MediaGovernanceDomainFixture,
  type MediaGovernanceRunProjection,
  type MediaGovernanceRunnerAction,
  type MediaGovernanceRunState,
  type MediaGovernanceStage,
  MediaGovernanceContractError,
  assertWorkflowTransition,
  buildCommandIdempotencyKey,
  projectMetadataGate,
  validateAgentBoundaryRequest,
  validateSubtitleContracts,
} from './media-governance-domain';

type BeginRunCommand = {
  action: MediaGovernanceRunnerAction;
  expectedRevision: number;
  inputSnapshotSha256: string;
  replayKey: string;
  taskId: string;
};

type SimulatorAgentRequest = {
  instructionSource: string;
  paths: string[];
  requestsCloud: boolean;
  symbolicLinkPaths: string[];
  tool: string;
  untrustedContentPromotedToInstruction?: boolean;
};

const RUN_START_PROJECTIONS: Partial<
  Record<
    MediaGovernanceRunnerAction,
    { runState: MediaGovernanceRunState; stage: MediaGovernanceStage }
  >
> = {
  'acceptance.verify': { runState: 'queued', stage: 'acceptance' },
  'governance.execute': { runState: 'queued', stage: 'governance' },
  'governance.plan': { runState: 'ready', stage: 'governance' },
  'governance.preflight': { runState: 'ready', stage: 'governance' },
  'metadata.repair': { runState: 'blocked', stage: 'metadata' },
  'metadata.verify': { runState: 'queued', stage: 'metadata' },
  'source.download': { runState: 'queued', stage: 'download' },
  'source.inspect': { runState: 'draft', stage: 'intake' },
  'source.probe-runtime': { runState: 'ready', stage: 'intake' },
};

function cloneFixture(
  fixture: MediaGovernanceDomainFixture,
): MediaGovernanceDomainFixture {
  return structuredClone(fixture);
}

export class MediaGovernanceSimulator {
  private readonly consumedReplayKeys = new Set<string>();
  private readonly effectsCounter = {
    cloudWrites: 0,
    databaseWrites: 0,
    mediaWrites: 0,
    remoteCalls: 0,
    serviceWrites: 0,
    uiWrites: 0,
  };
  private readonly fixture: MediaGovernanceDomainFixture;
  private readonly runCommandKeys = new Map<string, string>();
  private runSequence = 0;

  constructor(fixture: MediaGovernanceDomainFixture) {
    this.fixture = cloneFixture(fixture);
    for (const run of this.fixture.runs) {
      if (
        run.finishedAt ||
        run.status === 'failed' ||
        run.status === 'succeeded'
      ) {
        this.consumedReplayKeys.add(run.replayKey);
      }
    }
  }

  beginRun(command: BeginRunCommand): {
    reused: boolean;
    run: MediaGovernanceRunProjection;
  } {
    const task = this.fixture.task;
    if (command.taskId !== task.id) {
      throw new MediaGovernanceContractError('task-not-found');
    }
    const commandKey = buildCommandIdempotencyKey({
      action: command.action,
      inputSnapshotSha256: command.inputSnapshotSha256,
      taskId: command.taskId,
      taskRevision: command.expectedRevision,
    });
    if (task.activeRunId) {
      const activeRun = this.fixture.runs.find(
        (candidate) => candidate.id === task.activeRunId,
      );
      if (
        activeRun &&
        this.runCommandKeys.get(activeRun.id) === commandKey &&
        activeRun.replayKey === command.replayKey
      ) {
        return { reused: true, run: structuredClone(activeRun) };
      }
      throw new MediaGovernanceContractError('active-run-conflict');
    }
    if (command.expectedRevision !== task.revision) {
      throw new MediaGovernanceContractError('task-revision-stale');
    }
    if (command.inputSnapshotSha256 !== task.inputSnapshotSha256) {
      throw new MediaGovernanceContractError('input-snapshot-mismatch');
    }
    if (this.consumedReplayKeys.has(command.replayKey)) {
      throw new MediaGovernanceContractError('replay-key-consumed');
    }
    const requiredProjection = RUN_START_PROJECTIONS[command.action];
    if (
      !requiredProjection ||
      task.stage !== requiredProjection.stage ||
      task.runState !== requiredProjection.runState
    ) {
      throw new MediaGovernanceContractError('run-action-stage-mismatch');
    }

    this.runSequence += 1;
    const run: MediaGovernanceRunProjection = {
      action: command.action,
      evidenceSha256: null,
      finishedAt: null,
      id: `media-run-simulator-${String(this.runSequence).padStart(4, '0')}`,
      inputSnapshotSha256: command.inputSnapshotSha256,
      planSha256: null,
      progress: {
        completedBytes: 0,
        completedItems: 0,
        totalBytes: 0,
        totalItems: 0,
      },
      replayKey: command.replayKey,
      runnerSha256: '0'.repeat(64),
      startedAt: '2026-08-07T12:00:00.000Z',
      status: 'queued',
      taskId: task.id,
      taskRevision: task.revision,
    };
    this.fixture.runs.push(run);
    this.runCommandKeys.set(run.id, commandKey);
    task.activeRunId = run.id;
    task.revision += 1;
    this.fixture.capsule.taskRevision = task.revision;
    return { reused: false, run: structuredClone(run) };
  }

  finishRun(input: {
    evidenceType: string;
    expectedRevision: number;
    nextRunState: MediaGovernanceRunState;
    nextStage: MediaGovernanceStage;
    runId: string;
  }) {
    const task = this.fixture.task;
    if (input.expectedRevision !== task.revision) {
      throw new MediaGovernanceContractError('task-revision-stale');
    }
    if (task.activeRunId !== input.runId) {
      throw new MediaGovernanceContractError('active-run-mismatch');
    }
    const run = this.fixture.runs.find(
      (candidate) => candidate.id === input.runId,
    );
    if (!run) throw new MediaGovernanceContractError('run-not-found');
    assertWorkflowTransition({
      evidenceType: input.evidenceType,
      next: { runState: input.nextRunState, stage: input.nextStage },
      previous: { runState: task.runState, stage: task.stage },
    });
    run.status = 'succeeded';
    run.finishedAt = '2026-08-07T12:01:00.000Z';
    run.evidenceSha256 = 'f'.repeat(64);
    this.consumedReplayKeys.add(run.replayKey);
    task.activeRunId = null;
    task.runState = input.nextRunState;
    task.stage = input.nextStage;
    task.revision += 1;
    this.fixture.capsule.taskRevision = task.revision;
    this.fixture.capsule.currentStage = task.stage;
    return structuredClone(run);
  }

  acceptUnit(unitId: string, evidenceSha256: string) {
    if (!/^[a-f\d]{64}$/.test(evidenceSha256)) {
      throw new MediaGovernanceContractError('unit-evidence-invalid');
    }
    const unit = this.fixture.units.find(
      (candidate) => candidate.id === unitId,
    );
    if (!unit) throw new MediaGovernanceContractError('unit-not-found');
    if (projectMetadataGate(unit.metadataProjection).status === 'blocked') {
      throw new MediaGovernanceContractError('unit-acceptance-gate-blocked');
    }
    if (!unit.subtitleContract) {
      throw new MediaGovernanceContractError('unit-subtitle-contract-missing');
    }
    validateSubtitleContracts([unit.subtitleContract]);
    unit.localAcceptedAt = '2026-08-07T12:02:00.000Z';
    unit.evidenceSha256 = evidenceSha256;
  }

  taskClosureProjection() {
    const acceptedUnits = this.fixture.units.filter(
      (unit) => unit.localAcceptedAt !== null,
    ).length;
    return {
      acceptedUnits,
      canClose:
        acceptedUnits === this.fixture.units.length &&
        this.fixture.task.activeRunId === null,
      totalUnits: this.fixture.units.length,
    };
  }

  validateAgentRequest(request: SimulatorAgentRequest) {
    return validateAgentBoundaryRequest({
      capsule: this.fixture.capsule,
      policy: this.fixture.policy,
      request,
      task: this.fixture.task,
      units: this.fixture.units,
    });
  }

  effects() {
    return { ...this.effectsCounter };
  }
}

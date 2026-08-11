import {
  MediaGovernanceContractError,
  buildMediaGovernanceDomainFixture,
} from '../../../src/modules/admin/media-governance/media-governance-domain';
import { MediaGovernanceSimulator } from '../../../src/modules/admin/media-governance/media-governance-simulator';

function expectContractError(callback: () => unknown, code: string) {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(MediaGovernanceContractError);
    expect((error as MediaGovernanceContractError).code).toBe(code);
    return;
  }
  throw new Error(`expected contract error: ${code}`);
}

describe('media governance pure simulator', () => {
  function createSimulator() {
    const fixture = buildMediaGovernanceDomainFixture();
    fixture.task.stage = 'governance';
    fixture.task.runState = 'ready';
    fixture.task.revision = 7;
    return new MediaGovernanceSimulator(fixture);
  }

  it('creates one deterministic run and reuses the exact active command', () => {
    const simulator = createSimulator();
    const command = {
      action: 'governance.plan' as const,
      expectedRevision: 7,
      inputSnapshotSha256: 'a'.repeat(64),
      replayKey: 'media-task-fixture:governance.plan:7',
      taskId: 'media-task-fixture',
    };
    const first = simulator.beginRun(command);
    const duplicate = simulator.beginRun(command);

    expect(first.reused).toBe(false);
    expect(duplicate).toEqual({ ...first, reused: true });
    expect(simulator.effects()).toEqual({
      cloudWrites: 0,
      databaseWrites: 0,
      mediaWrites: 0,
      remoteCalls: 0,
      serviceWrites: 0,
      uiWrites: 0,
    });
  });

  it('rejects stale revision, a conflicting active run and a consumed replay key', () => {
    const stale = createSimulator();
    expectContractError(
      () =>
        stale.beginRun({
          action: 'governance.plan',
          expectedRevision: 6,
          inputSnapshotSha256: 'a'.repeat(64),
          replayKey: 'stale',
          taskId: 'media-task-fixture',
        }),
      'task-revision-stale',
    );

    const active = createSimulator();
    const started = active.beginRun({
      action: 'governance.plan',
      expectedRevision: 7,
      inputSnapshotSha256: 'a'.repeat(64),
      replayKey: 'first',
      taskId: 'media-task-fixture',
    });
    expectContractError(
      () =>
        active.beginRun({
          action: 'governance.plan',
          expectedRevision: 8,
          inputSnapshotSha256: 'a'.repeat(64),
          replayKey: 'second',
          taskId: 'media-task-fixture',
        }),
      'active-run-conflict',
    );

    active.finishRun({
      evidenceType: 'plan-sealed',
      expectedRevision: 8,
      nextRunState: 'queued',
      nextStage: 'governance',
      runId: started.run.id,
    });
    expectContractError(
      () =>
        active.beginRun({
          action: 'governance.plan',
          expectedRevision: 9,
          inputSnapshotSha256: 'a'.repeat(64),
          replayKey: 'first',
          taskId: 'media-task-fixture',
        }),
      'replay-key-consumed',
    );
  });

  it('rejects prompt injection, untyped tools, undeclared paths and early cloud access', () => {
    const simulator = createSimulator();
    const request = {
      instructionSource: 'task-capsule',
      paths: [
        '/vol2/1000/.kt-media-governance-staging/media-task-fixture/work/a.nfo',
      ],
      requestsCloud: false,
      symbolicLinkPaths: [],
      tool: 'plan.submit.sealed',
    };
    expect(simulator.validateAgentRequest(request)).toEqual({ allowed: true });

    expectContractError(
      () =>
        simulator.validateAgentRequest({
          ...request,
          instructionSource: 'media-filename',
        }),
      'agent-instruction-source-untrusted',
    );
    expectContractError(
      () =>
        simulator.validateAgentRequest({
          ...request,
          untrustedContentPromotedToInstruction: true,
        }),
      'agent-instruction-source-untrusted',
    );
    expectContractError(
      () => simulator.validateAgentRequest({ ...request, tool: 'shell.exec' }),
      'agent-tool-not-allowed',
    );
    expectContractError(
      () =>
        simulator.validateAgentRequest({
          ...request,
          paths: ['/vol2/1000/Media/TV/outside.mkv'],
        }),
      'path-outside-allowed-roots',
    );
    expectContractError(
      () =>
        simulator.validateAgentRequest({
          ...request,
          requestsCloud: true,
        }),
      'cloud-gate-closed',
    );
  });

  it('treats replay keys from sealed historical runs as consumed', () => {
    const simulator = createSimulator();
    expectContractError(
      () =>
        simulator.beginRun({
          action: 'governance.plan',
          expectedRevision: 7,
          inputSnapshotSha256: 'a'.repeat(64),
          replayKey: 'media-run-fixture-source-inspect',
          taskId: 'media-task-fixture',
        }),
      'replay-key-consumed',
    );
  });

  it('refuses Unit acceptance when an A-level metadata gate is missing', () => {
    const fixture = buildMediaGovernanceDomainFixture();
    fixture.units[0].metadataProjection.missingA = ['identity.provider'];
    const simulator = new MediaGovernanceSimulator(fixture);
    expectContractError(
      () => simulator.acceptUnit('media-unit-s00', 'c'.repeat(64)),
      'unit-acceptance-gate-blocked',
    );
  });

  it('keeps accepted units independent and closes only after exact cleanup', () => {
    const simulator = createSimulator();
    simulator.acceptUnit('media-unit-s00', 'c'.repeat(64));
    expect(simulator.taskClosureProjection()).toEqual({
      acceptedUnits: 1,
      canClose: false,
      totalUnits: 2,
    });
    simulator.acceptUnit('media-unit-s01', 'd'.repeat(64));
    expect(simulator.taskClosureProjection()).toEqual({
      acceptedUnits: 2,
      canClose: true,
      totalUnits: 2,
    });
  });
});

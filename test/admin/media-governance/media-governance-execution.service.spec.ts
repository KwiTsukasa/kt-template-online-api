import { MEDIA_GOVERNANCE_EXECUTOR_ACTIONS } from '../../../src/modules/admin/media-governance/contract/media-governance-executor.contract';
import { sha256MediaGovernanceJson } from '../../../src/modules/admin/media-governance/contract/media-governance-hash';
import {
  MediaGovernanceService,
  type MediaGovernanceTask,
} from '../../../src/modules/admin/media-governance/application/media-governance.service';
import type {
  MediaGovernanceExecutionEnvelope,
  MediaGovernanceExecutionGateway,
} from '../../../src/modules/admin/media-governance/infrastructure/integration/media-governance-execution.gateway';
import type {
  MediaGovernanceStateStore,
  MediaGovernanceStoredTask,
} from '../../../src/modules/admin/media-governance/infrastructure/persistence/media-governance-state.store';
import type { MediaScrapeValidationSink } from '../../../src/modules/admin/media-scrape-validation/application/media-scrape-validation.service';

describe('MediaGovernanceService mechanical execution', () => {
  /**
   * 构造带持久化、执行网关与独立刮削登记器的最小生产执行夹具。
   * @param storedTasks - 服务启动时需要恢复的历史任务。
   * @param sink - 机械关闭后接收只读快照的独立刮削登记器。
   * @returns 服务、派发记录、状态仓和刮削登记器。
   */
  function fixture(
    storedTasks: MediaGovernanceStoredTask[] = [],
    sink: MediaScrapeValidationSink = {
      enqueueTask: jest.fn(async () => undefined),
    },
  ) {
    const sequences = new Map<string, number>();
    const envelopes = new Map<string, MediaGovernanceExecutionEnvelope>();
    const dispatch = jest.fn(
      async (envelope: MediaGovernanceExecutionEnvelope) => ({
        executionId: `jenkins-${envelope.runId}`,
        replayed: false,
        runId: envelope.runId,
        sealedInputSha256: envelope.sealedInputSha256,
        status: 'queued' as const,
      }),
    );
    const stateStore: MediaGovernanceStateStore = {
      acknowledgeRunDispatch: jest.fn(async () => undefined),
      applyExecutorEvent: jest.fn(async (_task, event) => {
        sequences.set(event.runId, event.sequence);
        return true;
      }),
      isReady: () => true,
      loadTasks: jest.fn(async () => structuredClone(storedTasks)),
      pendingRunDispatches: jest.fn(async () => []),
      readRunEnvelope: jest.fn(async (runId) => envelopes.get(runId) ?? null),
      readRunSequence: jest.fn(async (runId) => sequences.get(runId) ?? 0),
      recordRunDispatchFailure: jest.fn(async () => 1),
      reserveRunDispatch: jest.fn(async (_task, envelope) => {
        envelopes.set(envelope.runId, envelope);
      }),
      saveTask: jest.fn(async () => undefined),
    };
    const gateway: MediaGovernanceExecutionGateway = {
      control: jest.fn(async (input) => ({
        command: input.command,
        controlId: input.controlId,
        replayed: false,
        runId: input.runId,
        status: 'accepted' as const,
      })),
      dispatch,
      enabled: () => true,
      status: jest.fn(async (input) => ({
        activeState: 'active',
        exitCode: 0,
        result: '',
        runId: input.runId,
        runnerId: null,
        sealedInputSha256: input.sealedInputSha256,
        status: 'running' as const,
        subState: 'running',
        taskId: input.taskId,
      })),
    };
    const service = new MediaGovernanceService(
      undefined,
      undefined,
      stateStore,
      gateway,
      undefined,
      sink,
    );
    return { dispatch, service, sink, stateStore };
  }

  /**
   * 为测试任务密封一个只包含本地视频移动的规范机械治理计划。
   * @param task - 已绑定作品编号和治理类型的测试任务。
   */
  function sealCanonicalPlan(task: MediaGovernanceTask) {
    let category = 'Movies';
    if (task.mediaType === 'tv') category = 'TV';
    let year = '';
    if (task.releaseYear) year = ` (${task.releaseYear})`;
    let provider = '';
    if (task.providerRef) {
      provider = ` [${task.providerRef.provider}id-${task.providerRef.providerId}]`;
    }
    const stagingPath = `/vol2/1000/.kt-media-governance-staging/${task.id}/sample.mkv`;
    const targetRoot = `/vol2/1000/Media/movie/${category}/${task.titleHint}${year}${provider}`;
    task.sealedPlan = {
      execution: { replayKey: `${task.id}:governance:r${task.revision}` },
      identity: {
        mediaType: task.mediaType,
        providerRef: task.providerRef,
        releaseYear: task.releaseYear,
        title: task.titleHint,
      },
      manifests: {
        local: {
          forward: [
            {
              evidenceId: 'sealed-video-fixture',
              fileKind: 'video',
              operation: 'move',
              sourcePath: stagingPath,
              targetPath: `${targetRoot}/${task.titleHint}.mkv`,
            },
          ],
        },
      },
      schemaVersion: '1.2.0',
      sealed: true,
      sourceEvidence: [
        {
          digest: 'a'.repeat(64),
          evidenceId: 'sealed-video-fixture',
          evidenceMethod: 'sha256-full-v1',
          fileKind: 'video',
          mtimeMs: 1_786_000_000_000,
          path: stagingPath,
          scope: 'local',
          size: 1_024,
        },
      ],
      workItemId: task.workItemId,
    };
    task.sealedPlanSha256 = sha256MediaGovernanceJson(task.sealedPlan);
  }

  /**
   * 创建位于治理执行 Run 中的规范测试任务。
   * @param service - 用于创建任务的媒体治理服务。
   * @returns 已绑定治理 Run 的任务。
   */
  async function createRunningGovernanceTask(service: MediaGovernanceService) {
    const task = await service.create({
      mediaType: 'tv',
      providerRef: { provider: 'bangumi', providerId: '530725' },
      releaseYear: 2026,
      seasonNumbers: ['S02'],
      titleHint: '机械治理闭环测试',
    });
    task.governanceProfile = 'embedded';
    task.workItemId = 'media-063';
    sealCanonicalPlan(task);
    task.activeRunId = 'media-run-governance-mechanical-0001';
    task.revision = 2;
    task.runState = 'queued';
    task.stage = 'governance';
    return task;
  }

  /**
   * 应用治理成功事件并返回自动预约的机械验收信封。
   * @param service - 当前媒体治理服务。
   * @param dispatch - 记录执行信封的网关方法。
   * @param task - 位于治理执行 Run 中的任务。
   * @returns 自动预约的机械验收执行信封。
   */
  async function completeGovernance(
    service: MediaGovernanceService,
    dispatch: jest.Mock,
    task: MediaGovernanceTask,
  ) {
    const runId = task.activeRunId!;
    await service.applyExecutorEvent({
      action: 'governance.execute',
      eventType: 'run-started',
      observedAt: new Date().toISOString(),
      runId,
      sequence: 1,
      summary: '机械治理开始',
      taskId: task.id,
      taskRevision: 2,
    });
    await service.applyExecutorEvent({
      action: 'governance.execute',
      evidenceSha256: 'b'.repeat(64),
      eventType: 'run-succeeded',
      observedAt: new Date().toISOString(),
      runId,
      sequence: 2,
      summary: '目录与文件名归一化完成',
      taskId: task.id,
      taskRevision: 2,
    });
    return dispatch.mock.calls.at(-1)![0] as MediaGovernanceExecutionEnvelope;
  }

  it('continues governance success directly to mechanical acceptance', async () => {
    const { dispatch, service } = fixture();
    await service.onModuleInit();
    const task = await createRunningGovernanceTask(service);

    const acceptance = await completeGovernance(service, dispatch, task);

    expect(acceptance).toMatchObject({
      action: 'acceptance.verify',
      taskId: task.id,
      unitIds: [task.units[0]!.id],
    });
    expect(task).toMatchObject({
      activeRunId: acceptance.runId,
      runState: 'queued',
      stage: 'acceptance',
    });
    expect(
      dispatch.mock.calls.map(([envelope]) => envelope.action),
    ).not.toEqual(
      expect.arrayContaining(['metadata.verify', 'metadata.repair']),
    );
    service.onModuleDestroy();
  });

  it('closes after mechanical acceptance and registers scraping out of band', async () => {
    const sink: MediaScrapeValidationSink = {
      enqueueTask: jest.fn(async () => undefined),
    };
    const { dispatch, service } = fixture([], sink);
    await service.onModuleInit();
    const task = await createRunningGovernanceTask(service);
    const acceptance = await completeGovernance(service, dispatch, task);

    await service.applyExecutorEvent({
      action: 'acceptance.verify',
      eventType: 'run-started',
      observedAt: new Date().toISOString(),
      runId: acceptance.runId,
      sequence: 1,
      summary: '机械验收开始',
      taskId: task.id,
      taskRevision: acceptance.taskRevision,
    });
    await service.applyExecutorEvent({
      acceptance: {
        acceptedFiles: 1,
        acceptedUnits: 1,
        activeDownloadOwners: 0,
        canClose: true,
        cloudWrites: 0,
        databaseDirectWrites: 0,
        mechanicalScans: 0,
        schemaVersion: 'media-admin-local-acceptance-v1',
        stagingResiduals: 0,
        uiWrites: 0,
      },
      action: 'acceptance.verify',
      evidenceSha256: 'c'.repeat(64),
      eventType: 'run-succeeded',
      observedAt: new Date().toISOString(),
      runId: acceptance.runId,
      sequence: 2,
      summary: '机械验收通过',
      taskId: task.id,
      taskRevision: acceptance.taskRevision,
    });
    await Promise.resolve();

    expect(task).toMatchObject({
      activeRunId: null,
      closedMode: 'mechanical',
      gateReason: null,
      runState: 'succeeded',
      stage: 'closed',
    });
    expect(sink.enqueueTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: task.id, stage: 'closed' }),
    );
    service.onModuleDestroy();
  });

  it('keeps the governance task closed when scrape registration fails', async () => {
    const sink: MediaScrapeValidationSink = {
      enqueueTask: jest.fn(async () => {
        throw new Error('scrape-store-unavailable');
      }),
    };
    const { dispatch, service } = fixture([], sink);
    await service.onModuleInit();
    const task = await createRunningGovernanceTask(service);
    const acceptance = await completeGovernance(service, dispatch, task);

    await service.applyExecutorEvent({
      acceptance: {
        acceptedFiles: 1,
        acceptedUnits: 1,
        activeDownloadOwners: 0,
        canClose: true,
        cloudWrites: 0,
        databaseDirectWrites: 0,
        mechanicalScans: 0,
        schemaVersion: 'media-admin-local-acceptance-v1',
        stagingResiduals: 0,
        uiWrites: 0,
      },
      action: 'acceptance.verify',
      evidenceSha256: 'd'.repeat(64),
      eventType: 'run-succeeded',
      observedAt: new Date().toISOString(),
      runId: acceptance.runId,
      sequence: 1,
      summary: '机械验收通过',
      taskId: task.id,
      taskRevision: acceptance.taskRevision,
    });
    await Promise.resolve();

    expect(task.stage).toBe('closed');
    expect(task.runState).toBe('succeeded');
    expect(task.gateReason).toBeNull();
    service.onModuleDestroy();
  });

  it('migrates a legacy metadata boundary to mechanical acceptance only', async () => {
    const seedService = new MediaGovernanceService();
    const task = await seedService.create({
      mediaType: 'movie',
      providerRef: { provider: 'tmdb', providerId: '1390384' },
      releaseYear: 2026,
      titleHint: '历史刮削状态迁移测试',
    });
    task.governanceProfile = 'embedded';
    task.workItemId = 'media-064';
    sealCanonicalPlan(task);
    task.runState = 'blocked';
    task.stage = 'metadata';
    const stored = structuredClone(task) as MediaGovernanceStoredTask;
    const { dispatch, service, stateStore } = fixture([stored]);

    await service.onModuleInit();
    const restored = service.detail(task.id);

    expect(stateStore.saveTask).toHaveBeenCalled();
    expect(restored.stage).toBe('acceptance');
    expect(restored.runState).toBe('queued');
    expect(restored.gateReason).toBeNull();
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'acceptance.verify' }),
    );
    expect(restored.units[0]!.evidenceSha256).toBeNull();
    service.onModuleDestroy();
  });

  it('removes NAS scrape actions from the governance executor contract', () => {
    expect(MEDIA_GOVERNANCE_EXECUTOR_ACTIONS).not.toContain('metadata.verify');
    expect(MEDIA_GOVERNANCE_EXECUTOR_ACTIONS).not.toContain('metadata.repair');
    expect(MEDIA_GOVERNANCE_EXECUTOR_ACTIONS).toContain('acceptance.verify');
  });
});

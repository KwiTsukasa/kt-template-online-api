import type {
  MediaGovernanceExecutionEnvelope,
  MediaGovernanceExecutionGateway,
} from '../../../src/modules/admin/media-governance/infrastructure/integration/media-governance-execution.gateway';
import type {
  MediaGovernanceStateStore,
  MediaGovernanceStoredTask,
} from '../../../src/modules/admin/media-governance/infrastructure/persistence/media-governance-state.store';
import type { MediaGovernanceProgressHotStore } from '../../../src/modules/admin/media-governance/infrastructure/persistence/media-governance-progress-hot.store';
import { MediaGovernanceEventStreamService } from '../../../src/modules/admin/media-governance/application/media-governance-event-stream.service';
import { sha256Json } from '../../../src/apps/media-codex-agent-gateway/domain/media-codex-agent.contract';
import {
  MediaGovernanceService,
  type MediaGovernanceTask,
} from '../../../src/modules/admin/media-governance/application/media-governance.service';

describe('MediaGovernanceService production execution adapter', () => {
  function fixture({
    durable = false,
    eventStream,
    progressHotStore,
  }: {
    durable?: boolean;
    eventStream?: MediaGovernanceEventStreamService;
    progressHotStore?: MediaGovernanceProgressHotStore;
  } = {}) {
    const sequences = new Map<string, number>();
    const envelopes = new Map<string, MediaGovernanceExecutionEnvelope>();
    const persistedTasks = new Map<string, MediaGovernanceStoredTask>();
    const reserved: unknown[] = [];
    const acknowledged: unknown[] = [];
    let gatewayEnabled = true;
    const persistTask = (task: MediaGovernanceTask) => {
      if (!durable) return;
      persistedTasks.set(
        task.id,
        structuredClone(task) as MediaGovernanceStoredTask,
      );
    };
    const stateStore: MediaGovernanceStateStore = {
      acknowledgeRunDispatch: jest.fn(async (...args) => {
        acknowledged.push(args);
      }),
      applyExecutorEvent: jest.fn(async (task, event) => {
        sequences.set(event.runId, event.sequence);
        persistTask(task);
        return true;
      }),
      consumeDescriptorGrant: jest.fn(),
      isReady: () => true,
      loadTasks: jest.fn(async () =>
        [...persistedTasks.values()].map((task) => structuredClone(task)),
      ),
      pendingRunDispatches: jest.fn(async () => []),
      recordRunDispatchFailure: jest.fn(async () => 1),
      readRunSequence: jest.fn(async (runId) => sequences.get(runId) ?? 0),
      readRunEnvelope: jest.fn(async (runId) => envelopes.get(runId) ?? null),
      reserveWorkItemId: jest.fn(async () => 'media-063'),
      reserveRunDispatch: jest.fn(async (...args) => {
        reserved.push(args);
        envelopes.set(args[1].runId, args[1]);
        persistTask(args[0]);
      }),
      failRunDispatch: jest.fn(async (task) => persistTask(task)),
      saveTask: jest.fn(async (task) => persistTask(task)),
      saveExecutorProgressSnapshot: jest.fn(async (task, event) => {
        sequences.set(event.runId, event.sequence);
        persistTask(task);
      }),
    };
    const dispatch = jest.fn(async (envelope) => ({
      executionId: `jenkins-${envelope.runId}`,
      replayed: false,
      runId: envelope.runId,
      sealedInputSha256: envelope.sealedInputSha256,
      status: 'queued' as const,
    }));
    const gateway: MediaGovernanceExecutionGateway = {
      control: jest.fn(async (input) => ({
        command: input.command,
        controlId: input.controlId,
        replayed: false,
        runId: input.runId,
        status: 'accepted' as const,
      })),
      dispatch,
      enabled: () => gatewayEnabled,
      status: jest.fn(async (input) => ({
        activeState: 'active',
        exitCode: 0,
        result: 'success',
        runId: input.runId,
        runnerId:
          'kt-media-governance-0123456789abcdef0123456789abcdef.service',
        sealedInputSha256: input.sealedInputSha256,
        status: 'running' as const,
        subState: 'running',
        taskId: input.taskId,
      })),
    };
    const service = new MediaGovernanceService(
      eventStream,
      undefined,
      stateStore,
      gateway,
      progressHotStore,
      {
        resolveModel: jest.fn(async () => 'gpt-test'),
        runtimeForProvider: jest.fn(async () => ({
          entity: { id: '2041700000000100002' },
        })),
      } as never,
      {
        createScene: jest.fn(async (_configId, _title, _scene, taskId) => ({
          id: `204170000000019${String(taskId).replace(/\D/gu, '').slice(-6).padStart(6, '0')}`,
        })),
        resolveIdentity: jest.fn(async (input) => ({
          activeTurnId: null,
          conversationId: input.conversationId,
          providerThreadId: null,
          scene: input.scene,
          sceneRefId: input.sceneRefId,
        })),
      } as never,
    );
    return {
      acknowledged,
      dispatch,
      gateway,
      reserved,
      service,
      setGatewayEnabled: (enabled: boolean) => {
        gatewayEnabled = enabled;
      },
      stateStore,
    };
  }

  const sealCanonicalPlan = (task: MediaGovernanceTask) => {
    let category = 'Movies';
    if (task.mediaType === 'tv') category = 'TV';
    let year = '';
    if (task.releaseYear) year = ` (${task.releaseYear})`;
    let provider = '';
    if (task.providerRef) {
      provider = ` [${task.providerRef.provider}id-${task.providerRef.providerId}]`;
    }
    const targetRoot = `/vol2/1000/Media/movie/${category}/${task.titleHint}${year}${provider}`;
    task.sealedPlan = {
      identity: {
        mediaType: task.mediaType,
        providerRef: task.providerRef,
        releaseYear: task.releaseYear,
        title: task.titleHint,
      },
      manifests: {
        local: {
          forward: [{ targetPath: `${targetRoot}/sample.mkv` }],
        },
      },
      schemaVersion: '1.2.0',
      sealed: true,
    };
    task.sealedPlanSha256 = sha256Json(task.sealedPlan);
  };

  it('reserves one durable run before dispatching source inspection', async () => {
    const { acknowledged, dispatch, reserved, service } = fixture();
    await service.onModuleInit();
    const task = await service.create({
      mediaType: 'tv',
      seasonNumbers: ['S01'],
      titleHint: '生产执行适配测试',
    });
    const source = await service.addMagnetSource(task.id, {
      contentKind: 'embedded_subtitle_media',
      expectedRevision: 1,
      magnetUri: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
      seasonNumbers: ['S01'],
      sourceRole: 'primary_media',
    });

    await service.inspectSource(task.id, source.id, { expectedRevision: 2 });

    expect(reserved).toHaveLength(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const envelope = dispatch.mock.calls[0]?.[0];
    expect(envelope).toMatchObject({
      action: 'source.inspect',
      inputSnapshotSha256: task.inputSnapshotSha256,
      taskId: task.id,
      taskRevision: 3,
      sources: [
        expect.objectContaining({
          infoHash: source.infoHash,
          manifestSha256: null,
          selectedFileCount: 0,
          sourceId: source.id,
          transportKind: 'magnet',
        }),
      ],
    });
    expect(task).toMatchObject({
      activeRunId: envelope.runId,
      revision: 3,
      runState: 'queued',
    });
    expect(acknowledged).toEqual([
      [envelope.runId, `jenkins-${envelope.runId}`],
    ]);
    await expect(
      service.inspectSource(task.id, source.id, { expectedRevision: 3 }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('dispatches a typed canonical identity rebase for an already inconsistent metadata task', async () => {
    const { dispatch, service } = fixture();
    await service.onModuleInit();
    const task = await service.create({
      mediaType: 'movie',
      providerRef: { provider: 'tmdb', providerId: '810693' },
      releaseYear: 2022,
      titleHint: '咒术回战0',
    });
    task.governanceProfile = 'embedded';
    task.metadataIdentity = {
      provider: 'tmdb',
      providerId: '810693',
      releaseYear: 2022,
    };
    task.metadataStatus = 'pending';
    task.runState = 'succeeded';
    task.stage = 'metadata';
    task.workItemId = 'media-073';
    const sourcePath =
      '/vol2/1000/.kt-media-governance-staging/media-task-jjk-zero/sources/media-source-jjk-zero/咒术回战0.mkv';
    const oldTarget = '/vol2/1000/Media/movie/Movies/咒术回战0/咒术回战0.mkv';
    const forward = [
      {
        evidenceId: 'admin-video-0001',
        fileKind: 'video',
        operation: 'move',
        sourcePath,
        targetPath: oldTarget,
      },
    ];
    const inverse = [
      {
        ...forward[0],
        sourcePath: oldTarget,
        targetPath: sourcePath,
      },
    ];
    const cloudSidecarQuarantine = { forward: [], inverse: [] };
    const cloudVideo = { forward: [], inverse: [] };
    task.sealedPlan = {
      agentAmendments: [
        {
          appliedAt: '2026-08-17T10:00:00.000Z',
          kind: 'identity',
          planSha256: 'e'.repeat(64),
          provider: 'tmdb',
          providerId: '810693',
          providerTitle: '剧场版 咒术回战 0',
          releaseYear: 2022,
          summary: '修正为 TMDB 电影身份',
        },
      ],
      execution: {
        allowlists: {
          localSourceRoot: '/vol2/1000/Media/incoming',
          localStagingRoot:
            '/vol2/1000/.kt-media-governance-staging/media-task-jjk-zero',
          localTargetRoot: '/vol2/1000/Media/movie',
        },
        manifestSha256: {
          cloudSidecarForward: sha256Json(cloudSidecarQuarantine.forward),
          cloudSidecarInverse: sha256Json(cloudSidecarQuarantine.inverse),
          cloudVideoForward: sha256Json(cloudVideo.forward),
          cloudVideoInverse: sha256Json(cloudVideo.inverse),
          localForward: sha256Json(forward),
          localInverse: sha256Json(inverse),
        },
        phase: 'local-only',
        replayKey: `${task.id}:governance:r8`,
      },
      identity: {
        mediaType: 'movie',
        providerRef: { provider: 'tmdb', providerId: '810693' },
        providerTitle: '剧场版 咒术回战 0',
        releaseYear: 2022,
        title: '咒术回战0',
      },
      manifests: {
        cloudSidecarQuarantine,
        cloudVideo,
        local: { forward, inverse },
      },
      schemaVersion: '1.2.0',
      sealed: true,
      sealedAt: '2026-08-17T10:00:00.000Z',
      sourceEvidence: [
        {
          digest: 'd'.repeat(64),
          evidenceId: 'admin-video-0001',
          evidenceMethod: 'sha256-full-v1',
          fileKind: 'video',
          mtimeMs: 1_786_000_000_000,
          path: sourcePath,
          scope: 'local',
          size: 2_048,
        },
      ],
      strategy: 'embedded',
      targetAbsenceEvidence: [],
      workItemId: 'media-073',
    };
    task.sealedPlanSha256 = sha256Json(task.sealedPlan);

    await expect(
      service.startMetadataVerification(task.id, { expectedRevision: 1 }),
    ).rejects.toMatchObject({ status: 409 });
    task.metadataStatus = 'verified';
    await expect(
      service.startAcceptanceVerification(task.id, { expectedRevision: 1 }),
    ).rejects.toMatchObject({ status: 409 });
    task.metadataStatus = 'pending';
    task.runState = 'blocked';

    await service.startCanonicalIdentityRebase(task.id, {
      expectedRevision: 1,
    });

    const envelope = dispatch.mock.calls.at(-1)?.[0];
    expect(envelope).toMatchObject({
      action: 'governance.execute',
      taskId: task.id,
      taskRevision: 2,
    });
    expect(task).toMatchObject({
      activeRunId: envelope.runId,
      metadataStatus: 'pending',
      revision: 2,
      runState: 'queued',
      stage: 'governance',
    });
    expect(task.sealedPlan).toMatchObject({
      execution: {
        allowlists: {
          localSourceRoot: '/vol2/1000/Media/movie/Movies/咒术回战0',
          localTargetRoot: '/vol2/1000/Media/movie',
        },
      },
      transition: {
        amendmentPlanSha256: 'e'.repeat(64),
        kind: 'canonical-identity-rebase-v1',
        targetTitleRoot:
          '/vol2/1000/Media/movie/Movies/咒术回战0 (2022) [tmdbid-810693]',
      },
    });
    expect(task.sealedPlanSha256).toBe(sha256Json(task.sealedPlan));
  });

  it('projects ordered executor events into semantic source and task progress', async () => {
    const { dispatch, service } = fixture();
    await service.onModuleInit();
    const task = await service.create({
      mediaType: 'tv',
      seasonNumbers: ['S01'],
      titleHint: '执行器事件投影测试',
    });
    const source = await service.addMagnetSource(task.id, {
      contentKind: 'embedded_subtitle_media',
      expectedRevision: 1,
      magnetUri: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
      seasonNumbers: ['S01'],
      sourceRole: 'primary_media',
    });
    await service.inspectSource(task.id, source.id, { expectedRevision: 2 });
    const envelope = dispatch.mock.calls[0]![0];
    const observedAt = new Date().toISOString();
    const base = {
      action: 'source.inspect' as const,
      observedAt,
      runId: envelope.runId,
      summary: '正在安全解析来源清单',
      taskId: task.id,
      taskRevision: 3,
    };

    await expect(
      service.applyExecutorEvent({
        ...base,
        eventType: 'run-started',
        sequence: 1,
      }),
    ).resolves.toEqual({ applied: true, revision: 3, runSequence: 1 });
    await service.applyExecutorEvent({
      ...base,
      eventType: 'peer-progress',
      progress: {
        completedBytes: 5,
        completedItems: 0,
        etaLabel: '最多还需 115 秒',
        speedBytesPerSecond: 0,
        totalBytes: 120,
        totalItems: 0,
      },
      sequence: 2,
      sourceId: source.id,
      summary: '正在获取磁链文件清单：已等待 5 秒，连接 0 个节点',
    });
    expect(task.progress).toMatchObject({
      etaLabel: '最多还需 115 秒',
      percent: 4.2,
      progressLabel: '正在获取磁链文件清单：已等待 5 秒，连接 0 个节点',
    });
    const manifest = [
      {
        executable: false as const,
        index: 0,
        relativePath: 'Series/S01/Series.S01E01.mkv',
        sizeBytes: 1_024,
      },
    ];
    const { createHash } = await import('node:crypto');
    const manifestSha256 = createHash('sha256')
      .update(JSON.stringify(manifest))
      .digest('hex');
    await service.applyExecutorEvent({
      ...base,
      eventType: 'source-inspected',
      manifest,
      manifestSha256,
      sequence: 3,
      sourceId: source.id,
      summary: '已检查 1 个来源文件',
    });
    await expect(
      service.applyExecutorEvent({
        ...base,
        evidenceSha256: 'e'.repeat(64),
        eventType: 'run-succeeded',
        sequence: 4,
        summary: '来源清单检查完成',
      }),
    ).resolves.toEqual({ applied: true, revision: 4, runSequence: 4 });

    expect(source).toMatchObject({
      manifest,
      manifestSha256,
      manifestState: 'inspected',
      selectedBytes: 1_024,
      selectedFileCount: 1,
      selectedFileIndices: [0],
    });
    expect(task).toMatchObject({
      activeRunId: null,
      nextCommandLabel: '运行死种/死链探针',
      revision: 4,
      runState: 'draft',
    });
    await expect(
      service.applyExecutorEvent({
        ...base,
        evidenceSha256: 'e'.repeat(64),
        eventType: 'run-succeeded',
        sequence: 4,
        summary: '来源清单检查完成',
      }),
    ).rejects.toMatchObject({ status: 409 });

    await service.probeRuntimeSource(task.id, source.id, {
      expectedRevision: 4,
    });
    const probeEnvelope = dispatch.mock.calls[1]![0];
    const probeBase = {
      action: 'source.probe-runtime' as const,
      observedAt: new Date().toISOString(),
      runId: probeEnvelope.runId,
      taskId: task.id,
      taskRevision: 5,
    };
    await service.applyExecutorEvent({
      ...probeBase,
      eventType: 'run-started',
      sequence: 1,
      summary: '来源探针开始',
    });
    await service.applyExecutorEvent({
      ...probeBase,
      evidenceSha256: 'f'.repeat(64),
      eventType: 'source-probed',
      sequence: 2,
      sourceHealth: 'viable',
      sourceHealthReason: 'source_runtime_available',
      sourceId: source.id,
      summary: '来源可用',
    });
    await service.applyExecutorEvent({
      ...probeBase,
      evidenceSha256: 'f'.repeat(64),
      eventType: 'run-succeeded',
      sequence: 3,
      sourceId: source.id,
      summary: '来源探针完成',
    });
    expect(task).toMatchObject({
      activeRunId: null,
      gateReason: null,
      revision: 6,
      runState: 'draft',
      stage: 'intake',
    });
    expect(source.sourceHealth).toBe('viable');
  });

  it('publishes every hot progress callback before the queued MySQL snapshot', async () => {
    let hotSequence: number | undefined;
    const progressHotStore: MediaGovernanceProgressHotStore = {
      append: jest.fn(async (event, authoritySequence) => {
        if (hotSequence === undefined && authoritySequence === null) {
          return {
            applied: false,
            authorityRequired: true,
            previousSequence: 0,
            sequenceGap: false,
            snapshotRequired: false,
          };
        }
        const previousSequence = hotSequence ?? authoritySequence ?? 0;
        if (event.sequence <= previousSequence) {
          return {
            applied: false,
            authorityRequired: false,
            previousSequence,
            sequenceGap: false,
            snapshotRequired: false,
          };
        }
        if (event.sequence !== previousSequence + 1) {
          return {
            applied: false,
            authorityRequired: false,
            previousSequence,
            sequenceGap: true,
            snapshotRequired: false,
          };
        }
        hotSequence = event.sequence;
        return {
          applied: true,
          authorityRequired: false,
          previousSequence,
          sequenceGap: false,
          snapshotRequired: event.sequence === 2,
        };
      }),
    };
    const eventStream = new MediaGovernanceEventStreamService({
      heartbeatMs: 60_000,
    });
    const { dispatch, service, stateStore } = fixture({
      eventStream,
      progressHotStore,
    });
    await service.onModuleInit();
    const task = await service.create({
      mediaType: 'tv',
      seasonNumbers: ['S01'],
      titleHint: '实时进度测试',
    });
    expect(service.evidence(task.id).eventProjection).toBe(
      'Redis Stream 实时进度热层',
    );
    const source = await service.addMagnetSource(task.id, {
      contentKind: 'embedded_subtitle_media',
      expectedRevision: 1,
      magnetUri: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
      seasonNumbers: ['S01'],
      sourceRole: 'primary_media',
    });
    await service.inspectSource(task.id, source.id, { expectedRevision: 2 });
    const envelope = dispatch.mock.calls[0]![0];
    const base = {
      action: 'source.inspect' as const,
      observedAt: new Date().toISOString(),
      runId: envelope.runId,
      sourceId: source.id,
      taskId: task.id,
      taskRevision: 3,
    };
    await service.applyExecutorEvent({
      ...base,
      eventType: 'run-started',
      sequence: 1,
      summary: '来源检查开始',
    });
    const readRunSequence = jest.mocked(stateStore.readRunSequence!);
    const applyExecutorEvent = jest.mocked(stateStore.applyExecutorEvent!);
    readRunSequence.mockClear();
    applyExecutorEvent.mockClear();
    let releaseSnapshot: () => void = () => undefined;
    const snapshotPending = new Promise<void>((resolve) => {
      releaseSnapshot = resolve;
    });
    jest
      .mocked(stateStore.saveExecutorProgressSnapshot!)
      .mockImplementation(async () => snapshotPending);
    const events: Array<Record<string, unknown>> = [];
    const subscription = eventStream.stream().subscribe((event) => {
      if (event.type === 'task-changed') {
        events.push(event.data as unknown as Record<string, unknown>);
      }
    });
    const progress = (sequence: number, completedBytes: number) => ({
      ...base,
      eventType: 'peer-progress' as const,
      progress: {
        completedBytes,
        completedItems: 0,
        etaLabel: '正在获取文件清单',
        speedBytesPerSecond: completedBytes,
        totalBytes: 100,
        totalItems: 0,
      },
      sequence,
      summary: `已取得 ${completedBytes} 字节`,
    });

    await expect(service.applyExecutorEvent(progress(2, 10))).resolves.toEqual(
      expect.objectContaining({ applied: true, runSequence: 2 }),
    );
    await expect(service.applyExecutorEvent(progress(3, 20))).resolves.toEqual(
      expect.objectContaining({ applied: true, runSequence: 3 }),
    );

    expect(events).toHaveLength(2);
    expect(events).toEqual([
      expect.objectContaining({
        runId: envelope.runId,
        runSequence: 2,
        task: expect.objectContaining({
          progress: expect.objectContaining({
            completedBytes: 10,
            percent: 10,
          }),
        }),
      }),
      expect.objectContaining({
        runId: envelope.runId,
        runSequence: 3,
        task: expect.objectContaining({
          progress: expect.objectContaining({
            completedBytes: 20,
            percent: 20,
          }),
        }),
      }),
    ]);
    expect(applyExecutorEvent).not.toHaveBeenCalled();
    expect(readRunSequence).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(stateStore.saveExecutorProgressSnapshot).toHaveBeenCalledTimes(1);
    releaseSnapshot();
    subscription.unsubscribe();
  });

  it('validates an executor projection before consuming its Redis sequence', async () => {
    const append = jest.fn();
    const { dispatch, service } = fixture({
      progressHotStore: { append },
    });
    await service.onModuleInit();
    const task = await service.create({
      mediaType: 'tv',
      seasonNumbers: ['S01'],
      titleHint: '无效进度游标保护测试',
    });
    const source = await service.addMagnetSource(task.id, {
      contentKind: 'embedded_subtitle_media',
      expectedRevision: 1,
      magnetUri: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
      seasonNumbers: ['S01'],
      sourceRole: 'primary_media',
    });
    await service.inspectSource(task.id, source.id, { expectedRevision: 2 });
    const envelope = dispatch.mock.calls[0]![0];

    await expect(
      service.applyExecutorEvent({
        action: 'source.inspect',
        eventType: 'peer-progress',
        observedAt: new Date().toISOString(),
        progress: {
          completedBytes: 101,
          completedItems: 0,
          etaLabel: '异常进度',
          speedBytesPerSecond: 1,
          totalBytes: 100,
          totalItems: 0,
        },
        runId: envelope.runId,
        sequence: 1,
        sourceId: source.id,
        summary: '无效进度',
        taskId: task.id,
        taskRevision: 3,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(append).not.toHaveBeenCalled();
    expect(task.progress.completedBytes).toBe(0);
  });

  it('normalizes stale succeeded progress when restoring persisted tasks', async () => {
    const { gateway, service, setGatewayEnabled, stateStore } = fixture({
      durable: true,
    });
    setGatewayEnabled(false);
    await service.onModuleInit();
    const task = await service.create({
      mediaType: 'tv',
      seasonNumbers: ['S02'],
      titleHint: '历史终态进度恢复测试',
    });
    const observedAt = new Date().toISOString();
    task.activeRunId = null;
    task.closedAt = observedAt;
    task.closedMode = 'automatic';
    task.metadataStatus = 'verified';
    task.nextCommandLabel = '查看验收证据';
    task.progress = {
      completedBytes: 0,
      completedItems: 0,
      etaLabel: '执行中',
      heartbeatLabel: '刚刚',
      observedAt,
      percent: 0,
      progressLabel: 'NAS 执行器已接收密封任务',
      speedLabel: '0 B/s',
      totalBytes: 0,
      totalItems: 0,
    };
    task.runState = 'succeeded';
    task.stage = 'closed';
    await stateStore.saveTask(task);

    const restoredService = new MediaGovernanceService(
      undefined,
      undefined,
      stateStore,
      gateway,
    );
    await restoredService.onModuleInit();

    expect(restoredService.detail(task.id).progress).toMatchObject({
      etaLabel: '已完成',
      percent: 100,
      progressLabel: '本地治理验收已完成',
      speedLabel: '0 B/s',
    });
  });

  it('returns a failed magnet inspection to an editable and discardable intake state', async () => {
    const { dispatch, service } = fixture();
    await service.onModuleInit();
    const task = await service.create({
      mediaType: 'tv',
      seasonNumbers: ['S01'],
      titleHint: '磁链元数据失败恢复测试',
    });
    const source = await service.addMagnetSource(task.id, {
      contentKind: 'embedded_subtitle_media',
      expectedRevision: 1,
      magnetUri: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
      seasonNumbers: ['S01'],
      sourceRole: 'primary_media',
    });
    await service.inspectSource(task.id, source.id, { expectedRevision: 2 });
    const envelope = dispatch.mock.calls[0]![0];
    const base = {
      action: 'source.inspect' as const,
      observedAt: new Date().toISOString(),
      runId: envelope.runId,
      taskId: task.id,
      taskRevision: 3,
    };
    await service.applyExecutorEvent({
      ...base,
      eventType: 'run-started',
      sequence: 1,
      summary: '来源检查开始',
    });
    await service.applyExecutorEvent({
      ...base,
      eventType: 'run-failed',
      sequence: 2,
      sourceHealth: 'unavailable',
      sourceHealthReason: 'magnet_metadata_unavailable',
      sourceId: source.id,
      summary: 'NAS 执行失败：magnet_metadata_unavailable',
    });

    expect(task).toMatchObject({
      activeRunId: null,
      nextCommandLabel: '可重新填写来源、编辑文件清单或删除任务',
      runState: 'blocked',
      stage: 'intake',
    });
    expect(task.semanticProjection).toMatchObject({
      discardAllowed: true,
      discardReasonLabel: null,
    });
    expect(source).toMatchObject({
      sourceHealth: 'unavailable',
      sourceHealthLabel: '来源检查失败',
      sourceHealthReasonLabel: '磁链在限定时间内未取得文件清单',
    });
  });

  it('keeps a reserved outbox run queued when immediate dispatch is unavailable', async () => {
    const { dispatch, service } = fixture();
    dispatch.mockRejectedValueOnce(new Error('executor-offline'));
    await service.onModuleInit();
    const task = await service.create({
      mediaType: 'movie',
      titleHint: '调度重试测试',
    });
    const source = await service.addMagnetSource(task.id, {
      contentKind: 'embedded_subtitle_media',
      expectedRevision: 1,
      magnetUri: 'magnet:?xt=urn:btih:fedcba9876543210fedcba9876543210fedcba98',
      sourceRole: 'primary_media',
    });

    await expect(
      service.inspectSource(task.id, source.id, { expectedRevision: 2 }),
    ).resolves.toBe(source);
    expect(task).toMatchObject({
      activeRunId: expect.stringMatching(/^media-run-/),
      nextCommandLabel: 'Jenkins 暂不可用，正在进行第 2/5 次调度',
      runState: 'queued',
    });
  });

  it('keeps the active run when a malformed terminal callback is rejected', async () => {
    const { dispatch, service } = fixture();
    await service.onModuleInit();
    const task = await service.create({
      mediaType: 'movie',
      titleHint: '终态回调原子性测试',
    });
    const source = await service.addMagnetSource(task.id, {
      contentKind: 'embedded_subtitle_media',
      expectedRevision: 1,
      magnetUri: 'magnet:?xt=urn:btih:fedcba9876543210fedcba9876543210fedcba98',
      sourceRole: 'primary_media',
    });
    await service.inspectSource(task.id, source.id, { expectedRevision: 2 });
    const envelope = dispatch.mock.calls[0]![0];
    await service.applyExecutorEvent({
      action: 'source.inspect',
      eventType: 'run-started',
      observedAt: new Date().toISOString(),
      runId: envelope.runId,
      sequence: 1,
      summary: '来源清单检查开始',
      taskId: task.id,
      taskRevision: 3,
    });

    await expect(
      service.applyExecutorEvent({
        action: 'source.download',
        evidenceSha256: 'e'.repeat(64),
        eventType: 'run-succeeded',
        observedAt: new Date().toISOString(),
        runId: envelope.runId,
        sequence: 2,
        summary: '缺少下载载荷合同',
        taskId: task.id,
        taskRevision: 3,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(task).toMatchObject({
      activeRunId: envelope.runId,
      gateReason: null,
      runState: 'running',
    });
  });

  it('fails closed after the bounded Jenkins dispatch attempts are exhausted', async () => {
    const { dispatch, service, stateStore } = fixture();
    dispatch.mockRejectedValue(new Error('executor-offline'));
    (stateStore.recordRunDispatchFailure as jest.Mock).mockResolvedValue(5);
    await service.onModuleInit();
    const task = await service.create({
      mediaType: 'movie',
      titleHint: '调度失败关闭测试',
    });
    const source = await service.addMagnetSource(task.id, {
      contentKind: 'embedded_subtitle_media',
      expectedRevision: 1,
      magnetUri: 'magnet:?xt=urn:btih:fedcba9876543210fedcba9876543210fedcba98',
      sourceRole: 'primary_media',
    });

    await service.inspectSource(task.id, source.id, { expectedRevision: 2 });

    expect(task).toMatchObject({
      activeRunId: null,
      gateReason: 'Jenkins 调度连续失败 5 次，未启动任何 NAS 执行器',
      revision: 4,
      runState: 'blocked',
    });
    expect(stateStore.failRunDispatch).toHaveBeenCalledTimes(1);
  });

  it('restores and reconciles a vanished sealed Run into one durable blocked terminal state', async () => {
    const { dispatch, gateway, service, setGatewayEnabled, stateStore } =
      fixture({ durable: true });
    await service.onModuleInit();
    const task = await service.create({
      mediaType: 'movie',
      titleHint: '执行单元终态对账测试',
    });
    const source = await service.addMagnetSource(task.id, {
      contentKind: 'embedded_subtitle_media',
      expectedRevision: 1,
      magnetUri: 'magnet:?xt=urn:btih:fedcba9876543210fedcba9876543210fedcba98',
      sourceRole: 'primary_media',
    });
    await service.inspectSource(task.id, source.id, { expectedRevision: 2 });
    const envelope = dispatch.mock.calls[0]![0];
    await service.applyExecutorEvent({
      action: envelope.action,
      eventType: 'run-started',
      observedAt: new Date().toISOString(),
      runId: envelope.runId,
      sequence: 1,
      summary: '执行器开始运行',
      taskId: task.id,
      taskRevision: task.revision,
    });
    service.onModuleDestroy();
    setGatewayEnabled(false);
    const restoredService = new MediaGovernanceService(
      undefined,
      undefined,
      stateStore,
      gateway,
    );
    await restoredService.onModuleInit();
    const restoredTask = restoredService.detail(task.id);
    expect(restoredTask).toMatchObject({
      activeRunId: envelope.runId,
      revision: envelope.taskRevision,
      runState: 'running',
      stage: 'intake',
    });

    setGatewayEnabled(true);
    dispatch.mockClear();
    (gateway.control as jest.Mock).mockClear();
    (stateStore.applyExecutorEvent as jest.Mock).mockClear();
    const reconcile = restoredService as unknown as {
      reconcileActiveExecutions(): Promise<void>;
    };
    (gateway.status as jest.Mock).mockResolvedValueOnce({
      activeState: 'inactive',
      exitCode: 1,
      result: 'exit-code',
      runId: envelope.runId,
      runnerId: 'kt-media-governance-0123456789abcdef0123456789abcdef.service',
      sealedInputSha256: envelope.sealedInputSha256,
      status: 'lost',
      subState: 'dead',
      taskId: task.id,
    });
    await reconcile.reconcileActiveExecutions();
    expect(stateStore.applyExecutorEvent).not.toHaveBeenCalled();
    expect(restoredTask).toMatchObject({
      activeRunId: envelope.runId,
      revision: envelope.taskRevision,
      runState: 'running',
    });

    (gateway.status as jest.Mock).mockResolvedValueOnce({
      activeState: 'inactive',
      exitCode: 1,
      manifestSha256: 'f'.repeat(64),
      result: 'exit-code',
      runId: envelope.runId,
      runnerId: 'kt-media-governance-0123456789abcdef0123456789abcdef.service',
      sealedInputSha256: envelope.sealedInputSha256,
      status: 'lost',
      subState: 'dead',
      taskId: task.id,
      terminalEvent: {
        action: envelope.action,
        eventType: 'run-failed',
        observedAt: new Date().toISOString(),
        runId: envelope.runId,
        sequence: 2,
        summary: 'NAS 执行单元已退出或被回收，但未返回可验证终态',
        taskId: task.id,
        taskRevision: envelope.taskRevision,
      },
    });
    await reconcile.reconcileActiveExecutions();

    expect(gateway.status).toHaveBeenCalledWith({
      runId: envelope.runId,
      sealedInputSha256: envelope.sealedInputSha256,
      taskId: task.id,
    });
    expect(stateStore.applyExecutorEvent).toHaveBeenCalledTimes(1);
    expect(stateStore.applyExecutorEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: envelope.action,
        eventType: 'run-failed',
        runId: envelope.runId,
        sequence: 2,
        taskId: task.id,
        taskRevision: envelope.taskRevision,
      }),
    );
    expect(restoredTask).toMatchObject({
      activeRunId: null,
      gateReason: 'NAS 执行单元已退出或被回收，但未返回可验证终态',
      revision: 4,
      runState: 'blocked',
    });
    await reconcile.reconcileActiveExecutions();
    expect(restoredTask.revision).toBe(4);
    expect(stateStore.applyExecutorEvent).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
    expect(gateway.control).not.toHaveBeenCalled();
    restoredService.onModuleDestroy();
  });

  it('restarts an orphaned download as one recovery run and accepts its reused payload', async () => {
    const { dispatch, gateway, service } = fixture();
    await service.onModuleInit();
    const task = await service.create({
      mediaType: 'movie',
      titleHint: '失联下载接管测试',
    });
    const source = await service.addMagnetSource(task.id, {
      contentKind: 'embedded_subtitle_media',
      expectedRevision: 1,
      magnetUri: 'magnet:?xt=urn:btih:fedcba9876543210fedcba9876543210fedcba98',
      sourceRole: 'primary_media',
    });
    source.manifest = [
      {
        executable: false,
        index: 0,
        relativePath: 'Movie.mkv',
        sizeBytes: 8,
      },
    ];
    source.manifestSha256 = 'a'.repeat(64);
    source.manifestState = 'inspected';
    source.selectedBytes = 8;
    source.selectedFileCount = 1;
    source.selectedFileIndices = [0];
    source.selectedFileMappings = [
      {
        episodeNumber: null,
        fileRole: 'video',
        index: 0,
        language: null,
        unitId: task.units[0]!.id,
      },
    ];
    source.sourceHealth = 'viable';
    task.activeRunId = null;
    task.gateReason = 'NAS 执行单元已退出或被回收，但未返回可验证终态';
    task.runState = 'blocked';
    task.stage = 'download';

    await service.startDownload(task.id, { expectedRevision: 2 });

    const envelope = dispatch.mock.calls[0]![0];
    expect(envelope).toMatchObject({
      action: 'source.resume',
      taskId: task.id,
      taskRevision: 3,
    });
    expect(task).toMatchObject({
      activeRunId: envelope.runId,
      revision: 3,
      runState: 'queued',
      stage: 'download',
    });
    const base = {
      action: 'source.resume' as const,
      observedAt: new Date().toISOString(),
      runId: envelope.runId,
      taskId: task.id,
      taskRevision: 3,
    };
    await service.applyExecutorEvent({
      ...base,
      eventType: 'run-started',
      sequence: 1,
      summary: '恢复运行开始',
    });
    expect(task.gateReason).toBeNull();
    await service.pauseDownload(task.id, { expectedRevision: 3 });
    await service.resumeDownload(task.id, { expectedRevision: 3 });
    expect(gateway.control).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ command: 'pause', runId: envelope.runId }),
    );
    expect(gateway.control).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ command: 'resume', runId: envelope.runId }),
    );
    await service.applyExecutorEvent({
      ...base,
      evidenceSha256: 'b'.repeat(64),
      eventType: 'run-succeeded',
      payloadFiles: [
        {
          index: 0,
          mtimeMs: 1,
          path: `/vol2/1000/.kt-media-governance-staging/${task.id}/sources/${source.id}/Movie.mkv`,
          relativePath: 'Movie.mkv',
          sha256: 'c'.repeat(64),
          sizeBytes: 8,
          sourceId: source.id,
        },
      ],
      sequence: 2,
      summary: '复用载荷已就绪',
    });
    expect(task).toMatchObject({
      activeRunId: null,
      gateReason: null,
      nextCommandLabel: '开始本地治理',
      revision: 4,
      runState: 'succeeded',
      stage: 'download',
    });
    expect(task.payloadSeal).toMatchObject({
      evidenceSha256: 'b'.repeat(64),
      runId: envelope.runId,
    });
  });

  it('cancels one slow download and removes its exact source after sealed cleanup', async () => {
    const { dispatch, gateway, service } = fixture();
    await service.onModuleInit();
    const task = await service.create({
      mediaType: 'tv',
      seasonNumbers: ['S01'],
      titleHint: '低速来源换源测试',
      workItemId: 'media-069',
    });
    const source = await service.addMagnetSource(task.id, {
      contentKind: 'bundled_sidecar_media',
      expectedRevision: 1,
      magnetUri: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
      releaseGroup: 'Fixture-Group',
      seasonNumbers: ['S01'],
      sourceRole: 'primary_media',
    });
    source.manifest = [
      {
        executable: false,
        index: 0,
        relativePath: 'Movie.mkv',
        sizeBytes: 8,
      },
      {
        executable: false,
        index: 1,
        relativePath: 'Movie.zh-CN.ass',
        sizeBytes: 2,
      },
    ];
    source.manifestSha256 = 'a'.repeat(64);
    source.manifestState = 'inspected';
    await service.updateSourceSelection(task.id, source.id, {
      expectedRevision: 2,
      fileMappings: [
        {
          episodeNumber: 1,
          fileRole: 'video',
          index: 0,
          unitId: task.units[0]!.id,
        },
        {
          episodeNumber: 1,
          fileRole: 'subtitle',
          index: 1,
          language: 'zh-CN',
          unitId: task.units[0]!.id,
        },
      ],
      selectedFileIndices: [0, 1],
    });
    source.sourceHealth = 'viable';

    await service.startDownload(task.id, { expectedRevision: 3 });
    const download = dispatch.mock.calls[0]![0];
    const observedAt = new Date().toISOString();
    await service.applyExecutorEvent({
      action: 'source.download',
      eventType: 'run-started',
      observedAt,
      runId: download.runId,
      sequence: 1,
      summary: '下载开始',
      taskId: task.id,
      taskRevision: 4,
    });
    await service.cancelDownload(task.id, { expectedRevision: 4 });
    expect(gateway.control).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'cancel', runId: download.runId }),
    );
    await service.applyExecutorEvent({
      action: 'source.download',
      eventType: 'run-failed',
      observedAt,
      runId: download.runId,
      sequence: 2,
      summary: 'NAS 执行失败：download_cancelled',
      taskId: task.id,
      taskRevision: 4,
    });
    expect(task).toMatchObject({
      activeRunId: null,
      gateReason: '下载已取消，现有载荷等待精确清理',
      revision: 5,
      runState: 'blocked',
    });

    await service.removeSource(task.id, source.id, { expectedRevision: 5 });
    expect(source.descriptorTombstonedAt).not.toBeNull();
    const cleanup = dispatch.mock.calls[1]![0];
    expect(cleanup).toMatchObject({
      action: 'source.cleanup',
      sources: [expect.objectContaining({ sourceId: source.id })],
      taskRevision: 6,
    });
    await service.applyExecutorEvent({
      action: 'source.cleanup',
      eventType: 'run-started',
      observedAt,
      runId: cleanup.runId,
      sequence: 1,
      summary: '清理开始',
      taskId: task.id,
      taskRevision: 6,
    });
    await service.applyExecutorEvent({
      action: 'source.cleanup',
      evidenceSha256: 'c'.repeat(64),
      eventType: 'run-succeeded',
      observedAt,
      runId: cleanup.runId,
      sequence: 2,
      sourceId: source.id,
      summary: '来源运行时已精确清理',
      taskId: task.id,
      taskRevision: 6,
    });
    expect(task).toMatchObject({
      activeRunId: null,
      governanceProfile: null,
      nextCommandLabel: '添加新的主媒体来源',
      revision: 7,
      runState: 'draft',
      sources: [],
      stage: 'intake',
      units: [
        expect.objectContaining({
          expectedEpisodeNumbers: [],
          subtitleContract: null,
        }),
      ],
    });
  });

  it('cleans an unbound legacy metadata residue through the production executor', async () => {
    const { dispatch, service } = fixture();
    await service.onModuleInit();
    const task = await service.create({
      mediaType: 'tv',
      seasonNumbers: ['S01'],
      titleHint: 'KT restart canary',
    });
    const source = await service.addMagnetSource(task.id, {
      contentKind: 'embedded_subtitle_media',
      expectedRevision: 1,
      magnetUri: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
      sourceRole: 'primary_media',
    });
    task.stage = 'metadata';
    task.runState = 'blocked';
    task.metadataStatus = 'requires-agent';
    task.agentSession = {
      capsuleSha256: 'a'.repeat(64),
      checkpointSha256: 'b'.repeat(64),
      currentActionLabel: '等待人工处理',
      currentUnitId: task.units[0]!.id,
      lastHeartbeatLabel: '刚刚',
      lastSequence: 3,
      pendingPlanSha256: null,
      policyBoundaryLabel: '五层边界已启用',
      policySha256: 'c'.repeat(64),
      policyVersion: 'media-agent-policy-v1',
      status: 'needs-operator',
      statusLabel: '需要人工处理',
      threadId: '019ff01b-7f9a-7301-82aa-12cd0c3ce3ed',
    };

    await service.removeSource(task.id, source.id, { expectedRevision: 2 });
    const cleanup = dispatch.mock.calls[0]![0];
    expect(cleanup).toMatchObject({
      action: 'source.cleanup',
      sources: [expect.objectContaining({ sourceId: source.id })],
      taskRevision: 3,
    });
    const observedAt = new Date().toISOString();
    await service.applyExecutorEvent({
      action: 'source.cleanup',
      eventType: 'run-started',
      observedAt,
      runId: cleanup.runId,
      sequence: 1,
      summary: '清理开始',
      taskId: task.id,
      taskRevision: 3,
    });
    await service.applyExecutorEvent({
      action: 'source.cleanup',
      evidenceSha256: 'd'.repeat(64),
      eventType: 'run-succeeded',
      observedAt,
      runId: cleanup.runId,
      sequence: 2,
      sourceId: source.id,
      summary: '来源运行时已精确清理',
      taskId: task.id,
      taskRevision: 3,
    });

    expect(task).toMatchObject({
      activeRunId: null,
      agentSession: null,
      metadataStatus: 'pending',
      revision: 4,
      runState: 'draft',
      sources: [],
      stage: 'intake',
    });
  });

  it('rolls a dry-run-only governance failure back to intake while retaining its work item', async () => {
    const { dispatch, service } = fixture();
    await service.onModuleInit();
    const task = await service.create({
      mediaType: 'tv',
      seasonNumbers: ['S01'],
      titleHint: '治理前换源测试',
    });
    const source = await service.addMagnetSource(task.id, {
      contentKind: 'embedded_subtitle_media',
      expectedRevision: 1,
      magnetUri: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
      sourceRole: 'primary_media',
    });
    task.stage = 'governance';
    task.runState = 'blocked';
    task.workItemId = 'media-075';
    task.metadataStatus = 'pending';
    task.payloadSeal = {
      evidenceSha256: 'a'.repeat(64),
      files: [],
      runId: 'media-run-download-fixture',
    };
    task.sealedPlan = {} as never;
    task.sealedPlanSha256 = 'b'.repeat(64);
    task.progress = {
      completedBytes: 1,
      completedItems: 2,
      etaLabel: '已停止',
      heartbeatLabel: '刚刚',
      observedAt: new Date().toISOString(),
      percent: 40,
      progressLabel: '正式事务已经开始',
      speedLabel: '0 B/s',
      totalBytes: 5,
      totalItems: 5,
    };

    await expect(
      service.removeSource(task.id, source.id, { expectedRevision: 2 }),
    ).rejects.toMatchObject({ status: 409 });

    task.progress.completedItems = 1;
    task.progress.completedBytes = 1;
    task.progress.percent = 20;
    task.progress.progressLabel = '仅 dry-run 已完成';
    await service.removeSource(task.id, source.id, { expectedRevision: 2 });
    const cleanup = dispatch.mock.calls[0]![0];
    expect(cleanup).toMatchObject({
      action: 'source.cleanup',
      taskRevision: 3,
    });
    const observedAt = new Date().toISOString();
    await service.applyExecutorEvent({
      action: 'source.cleanup',
      eventType: 'run-started',
      observedAt,
      runId: cleanup.runId,
      sequence: 1,
      summary: '清理开始',
      taskId: task.id,
      taskRevision: 3,
    });
    await service.applyExecutorEvent({
      action: 'source.cleanup',
      evidenceSha256: 'c'.repeat(64),
      eventType: 'run-succeeded',
      observedAt,
      runId: cleanup.runId,
      sequence: 2,
      sourceId: source.id,
      summary: '错误替代来源已精确清理',
      taskId: task.id,
      taskRevision: 3,
    });

    expect(task).toMatchObject({
      activeRunId: null,
      governanceProfile: null,
      nextCommandLabel: '添加新的主媒体来源',
      payloadSeal: null,
      revision: 4,
      runState: 'draft',
      sealedPlan: null,
      sealedPlanSha256: null,
      sources: [],
      stage: 'intake',
      workItemId: 'media-075',
    });
  });

  it('seals one Schema 1.2.0 plan and retries a failed execution with a fresh replay key', async () => {
    const { dispatch, service, stateStore } = fixture();
    await service.onModuleInit();
    const task = await service.create({
      mediaType: 'movie',
      providerRef: { provider: 'tmdb', providerId: '603' },
      releaseYear: 1999,
      titleHint: '黑客帝国',
    });
    const source = await service.addMagnetSource(task.id, {
      contentKind: 'embedded_subtitle_media',
      expectedRevision: 1,
      magnetUri: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
      sourceRole: 'primary_media',
    });
    const sourceRoot = `/vol2/1000/.kt-media-governance-staging/${task.id}/sources/${source.id}`;
    source.manifest = [
      {
        executable: false,
        index: 0,
        relativePath: 'The.Matrix.1999.mkv',
        sizeBytes: 1_024,
      },
    ];
    source.selectedFileCount = 1;
    source.selectedFileIndices = [0];
    source.selectedFileMappings = [
      {
        episodeNumber: null,
        fileRole: 'video',
        index: 0,
        language: null,
        unitId: task.units[0].id,
      },
    ];
    task.stage = 'download';
    task.runState = 'succeeded';
    task.payloadSeal = {
      evidenceSha256: 'e'.repeat(64),
      files: [
        {
          index: 0,
          mtimeMs: 1_786_000_000_000,
          path: `${sourceRoot}/The.Matrix.1999.mkv`,
          relativePath: 'The.Matrix.1999.mkv',
          sha256: 'a'.repeat(64),
          sizeBytes: 1_024,
          sourceId: source.id,
        },
      ],
      runId: 'media-run-download-fixture',
    };
    task.progress = {
      completedBytes: 5,
      completedItems: 5,
      etaLabel: '已完成',
      heartbeatLabel: '刚刚',
      observedAt: new Date().toISOString(),
      percent: 100,
      progressLabel: '来源载荷已就绪',
      speedLabel: '0 B/s',
      totalBytes: 5,
      totalItems: 5,
    };

    await service.startGovernance(task.id, { expectedRevision: 2 });

    const firstEnvelope = dispatch.mock.calls.at(-1)?.[0];
    expect(firstEnvelope).toMatchObject({
      action: 'governance.execute',
      plan: {
        planGrantId: expect.stringMatching(/^media-plan-grant-/),
        planSha256: task.sealedPlanSha256,
        schemaVersion: '1.2.0',
        strategy: 'embedded',
      },
      taskId: task.id,
    });
    expect(firstEnvelope.sources).toBeUndefined();
    expect(task).toMatchObject({
      activeRunId: firstEnvelope.runId,
      revision: 3,
      runState: 'queued',
      stage: 'governance',
      workItemId: 'media-063',
    });
    expect(task.progress).toMatchObject({
      completedBytes: 0,
      completedItems: 0,
      percent: 0,
      progressLabel: '已入队，等待 Jenkins 调度',
      totalBytes: 0,
      totalItems: 0,
    });

    await service.applyExecutorEvent({
      action: 'governance.execute',
      eventType: 'run-started',
      observedAt: new Date().toISOString(),
      runId: firstEnvelope.runId,
      sequence: 1,
      summary: '本地事务开始',
      taskId: task.id,
      taskRevision: 3,
    });
    const fullFailureSummary = '原始执行器失败：'.padEnd(400, '错');
    await service.applyExecutorEvent({
      action: 'governance.execute',
      eventType: 'run-failed',
      observedAt: new Date().toISOString(),
      runId: firstEnvelope.runId,
      sequence: 2,
      summary: fullFailureSummary,
      taskId: task.id,
      taskRevision: 3,
    });
    expect(task).toMatchObject({
      activeRunId: null,
      revision: 4,
      runState: 'blocked',
      stage: 'governance',
    });
    expect(task.gateReason).toBe(fullFailureSummary.slice(0, 160));
    expect(task.gateReason).toHaveLength(160);
    expect(stateStore.applyExecutorEvent).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'run-failed',
        summary: fullFailureSummary,
      }),
    );

    await service.startGovernance(task.id, { expectedRevision: 4 });
    const retryEnvelope = dispatch.mock.calls.at(-1)?.[0];
    expect(retryEnvelope).toMatchObject({
      action: 'governance.execute',
      plan: {
        planSha256: task.sealedPlanSha256,
      },
      replayKey: `${task.id}:governance.execute:r5`,
      taskRevision: 5,
    });
    expect(retryEnvelope.runId).not.toBe(firstEnvelope.runId);

    await service.applyExecutorEvent({
      action: 'governance.execute',
      eventType: 'run-started',
      observedAt: new Date().toISOString(),
      runId: retryEnvelope.runId,
      sequence: 1,
      summary: '本地事务重新开始',
      taskId: task.id,
      taskRevision: 5,
    });
    await service.applyExecutorEvent({
      action: 'governance.execute',
      evidenceSha256: 'b'.repeat(64),
      eventType: 'run-succeeded',
      observedAt: new Date().toISOString(),
      runId: retryEnvelope.runId,
      sequence: 2,
      summary: '本地事务完成',
      taskId: task.id,
      taskRevision: 5,
    });
    expect(task).toMatchObject({
      activeRunId: null,
      metadataStatus: 'pending',
      revision: 6,
      runState: 'succeeded',
      stage: 'metadata',
    });

    await service.startMetadataVerification(task.id, { expectedRevision: 6 });
    const metadataEnvelope = dispatch.mock.calls.at(-1)?.[0];
    expect(metadataEnvelope).toMatchObject({
      action: 'metadata.verify',
      taskRevision: 7,
    });
    await service.applyExecutorEvent({
      action: 'metadata.verify',
      eventType: 'run-started',
      observedAt: new Date().toISOString(),
      runId: metadataEnvelope.runId,
      sequence: 1,
      summary: '元数据核验开始',
      taskId: task.id,
      taskRevision: 7,
    });
    await service.applyExecutorEvent({
      action: 'metadata.verify',
      evidenceSha256: 'c'.repeat(64),
      eventType: 'run-succeeded',
      metadata: {
        canAccept: true,
        identity: {
          provider: 'tmdb',
          providerId: '202821',
          releaseYear: 2023,
        },
        repairAttempts: 0,
        schemaVersion: 'media-admin-metadata-verification-v1',
        units: [
          {
            accepted: true,
            missingA: [],
            missingB: [],
            missingC: [],
            unitId: task.units[0]!.id,
          },
        ],
        writeBoundaries: {
          cloud: 0,
          databaseDirect: 0,
          mechanicalScan: 0,
          ui: 0,
        },
      },
      observedAt: new Date().toISOString(),
      runId: metadataEnvelope.runId,
      sequence: 2,
      summary: '元数据核验通过',
      taskId: task.id,
      taskRevision: 7,
    });
    expect(task).toMatchObject({
      metadataStatus: 'verified',
      revision: 8,
      runState: 'succeeded',
      stage: 'metadata',
    });

    await service.startAcceptanceVerification(task.id, { expectedRevision: 8 });
    const acceptanceEnvelope = dispatch.mock.calls.at(-1)?.[0];
    expect(acceptanceEnvelope).toMatchObject({
      action: 'acceptance.verify',
      taskRevision: 9,
    });
    expect(acceptanceEnvelope.sources).toHaveLength(task.sources.length);
    await service.applyExecutorEvent({
      action: 'acceptance.verify',
      eventType: 'run-started',
      observedAt: new Date().toISOString(),
      runId: acceptanceEnvelope.runId,
      sequence: 1,
      summary: '独立验收开始',
      taskId: task.id,
      taskRevision: 9,
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
      evidenceSha256: 'd'.repeat(64),
      eventType: 'run-succeeded',
      observedAt: new Date().toISOString(),
      runId: acceptanceEnvelope.runId,
      sequence: 2,
      summary: '独立验收通过',
      taskId: task.id,
      taskRevision: 9,
    });
    expect(task).toMatchObject({
      activeRunId: null,
      metadataStatus: 'verified',
      progress: {
        etaLabel: '已完成',
        percent: 100,
        progressLabel: '独立验收通过',
        speedLabel: '0 B/s',
      },
      revision: 10,
      runState: 'succeeded',
      stage: 'closed',
    });
  });

  it('retries failed metadata and acceptance verification with fresh run identities', async () => {
    const { dispatch, service } = fixture();
    await service.onModuleInit();
    const metadataTask = await service.create({
      mediaType: 'tv',
      seasonNumbers: ['S01'],
      titleHint: '元数据核验失败重试测试',
    });
    metadataTask.governanceProfile = 'sidecar-bundled';
    metadataTask.metadataStatus = 'pending';
    metadataTask.runState = 'succeeded';
    sealCanonicalPlan(metadataTask);
    metadataTask.stage = 'metadata';

    await service.startMetadataVerification(metadataTask.id, {
      expectedRevision: 1,
    });
    const firstMetadataEnvelope = dispatch.mock.calls.at(-1)?.[0];
    await service.applyExecutorEvent({
      action: 'metadata.verify',
      eventType: 'run-started',
      observedAt: new Date().toISOString(),
      runId: firstMetadataEnvelope.runId,
      sequence: 1,
      summary: '元数据核验开始',
      taskId: metadataTask.id,
      taskRevision: 2,
    });
    await service.applyExecutorEvent({
      action: 'metadata.verify',
      eventType: 'run-failed',
      observedAt: new Date().toISOString(),
      runId: firstMetadataEnvelope.runId,
      sequence: 2,
      summary: 'NAS 执行失败：元数据核验输入不完整',
      taskId: metadataTask.id,
      taskRevision: 2,
    });
    expect(metadataTask).toMatchObject({
      activeRunId: null,
      metadataStatus: 'pending',
      revision: 3,
      runState: 'blocked',
      stage: 'metadata',
    });

    await service.startMetadataVerification(metadataTask.id, {
      expectedRevision: 3,
    });
    const retryMetadataEnvelope = dispatch.mock.calls.at(-1)?.[0];
    expect(retryMetadataEnvelope).toMatchObject({
      action: 'metadata.verify',
      replayKey: `${metadataTask.id}:metadata.verify:r4`,
      taskRevision: 4,
    });
    expect(retryMetadataEnvelope.runId).not.toBe(firstMetadataEnvelope.runId);

    const acceptanceTask = await service.create({
      mediaType: 'tv',
      seasonNumbers: ['S01'],
      titleHint: '独立验收失败重试测试',
    });
    acceptanceTask.governanceProfile = 'sidecar-bundled';
    acceptanceTask.metadataStatus = 'verified';
    acceptanceTask.runState = 'succeeded';
    sealCanonicalPlan(acceptanceTask);
    acceptanceTask.stage = 'metadata';

    await service.startAcceptanceVerification(acceptanceTask.id, {
      expectedRevision: 1,
    });
    const firstAcceptanceEnvelope = dispatch.mock.calls.at(-1)?.[0];
    await service.applyExecutorEvent({
      action: 'acceptance.verify',
      eventType: 'run-started',
      observedAt: new Date().toISOString(),
      runId: firstAcceptanceEnvelope.runId,
      sequence: 1,
      summary: '独立验收开始',
      taskId: acceptanceTask.id,
      taskRevision: 2,
    });
    await service.applyExecutorEvent({
      action: 'acceptance.verify',
      eventType: 'run-failed',
      observedAt: new Date().toISOString(),
      runId: firstAcceptanceEnvelope.runId,
      sequence: 2,
      summary: 'NAS 执行失败：独立验收证据暂不可用',
      taskId: acceptanceTask.id,
      taskRevision: 2,
    });
    expect(acceptanceTask).toMatchObject({
      activeRunId: null,
      metadataStatus: 'verified',
      revision: 3,
      runState: 'blocked',
      stage: 'acceptance',
    });

    await service.startAcceptanceVerification(acceptanceTask.id, {
      expectedRevision: 3,
    });
    const retryAcceptanceEnvelope = dispatch.mock.calls.at(-1)?.[0];
    expect(retryAcceptanceEnvelope).toMatchObject({
      action: 'acceptance.verify',
      replayKey: `${acceptanceTask.id}:acceptance.verify:r4`,
      taskRevision: 4,
    });
    expect(retryAcceptanceEnvelope.runId).not.toBe(
      firstAcceptanceEnvelope.runId,
    );
  });

  it('rechecks deferred fnOS identity through the deterministic metadata path', async () => {
    const { dispatch, service } = fixture();
    await service.onModuleInit();
    const task = await service.create({
      mediaType: 'tv',
      seasonNumbers: ['S01'],
      titleHint: 'fnOS 身份延迟测试',
    });
    task.governanceProfile = 'embedded';
    task.metadataStatus = 'pending';
    task.runState = 'succeeded';
    sealCanonicalPlan(task);
    task.stage = 'metadata';

    await service.startMetadataVerification(task.id, { expectedRevision: 1 });
    const firstEnvelope = dispatch.mock.calls.at(-1)?.[0];
    await service.applyExecutorEvent({
      action: 'metadata.verify',
      eventType: 'run-started',
      observedAt: new Date().toISOString(),
      runId: firstEnvelope.runId,
      sequence: 1,
      summary: '元数据核验开始',
      taskId: task.id,
      taskRevision: 2,
    });
    await service.applyExecutorEvent({
      action: 'metadata.verify',
      evidenceSha256: 'b'.repeat(64),
      eventType: 'run-succeeded',
      metadata: {
        canAccept: false,
        repairAttempts: 0,
        schemaVersion: 'media-admin-metadata-verification-v1',
        units: [
          {
            accepted: false,
            missingA: ['identity.provider', 'identity.providerId'],
            missingB: ['metadata.local-nfo', 'artwork.poster'],
            missingC: [],
            unitId: task.units[0]!.id,
          },
        ],
        writeBoundaries: {
          cloud: 0,
          databaseDirect: 0,
          mechanicalScan: 0,
          ui: 0,
        },
      },
      observedAt: new Date().toISOString(),
      runId: firstEnvelope.runId,
      sequence: 2,
      summary: 'fnOS 身份尚未回填',
      taskId: task.id,
      taskRevision: 2,
    });

    expect(task).toMatchObject({
      activeRunId: null,
      metadataStatus: 'requires-agent',
      nextCommandLabel: 'fnOS 身份回填尚未稳定，重新采集元数据事实',
      revision: 3,
      runState: 'blocked',
      stage: 'metadata',
    });
    await service.startMetadataVerification(task.id, { expectedRevision: 3 });
    const retryEnvelope = dispatch.mock.calls.at(-1)?.[0];
    expect(retryEnvelope).toMatchObject({
      action: 'metadata.verify',
      replayKey: `${task.id}:metadata.verify:r4`,
      taskRevision: 4,
    });
    expect(retryEnvelope.runId).not.toBe(firstEnvelope.runId);

    await service.applyExecutorEvent({
      action: 'metadata.verify',
      eventType: 'run-started',
      observedAt: new Date().toISOString(),
      runId: retryEnvelope.runId,
      sequence: 1,
      summary: '延迟身份重新核验开始',
      taskId: task.id,
      taskRevision: 4,
    });
    await service.applyExecutorEvent({
      action: 'metadata.verify',
      evidenceSha256: 'b'.repeat(64),
      eventType: 'run-succeeded',
      metadata: {
        canAccept: false,
        repairAttempts: 0,
        schemaVersion: 'media-admin-metadata-verification-v1',
        units: [
          {
            accepted: false,
            missingA: ['identity.provider', 'identity.providerId'],
            missingB: ['metadata.local-nfo', 'artwork.poster'],
            missingC: [],
            unitId: task.units[0]!.id,
          },
        ],
        writeBoundaries: {
          cloud: 0,
          databaseDirect: 0,
          mechanicalScan: 0,
          ui: 0,
        },
      },
      observedAt: new Date().toISOString(),
      runId: retryEnvelope.runId,
      sequence: 2,
      summary: '延迟身份重新核验仍未回填',
      taskId: task.id,
      taskRevision: 4,
    });

    expect(task).toMatchObject({
      activeRunId: null,
      metadataStatus: 'requires-agent',
      nextCommandLabel: '启动 CodexAgent 有界人工治理',
      revision: 5,
      runState: 'blocked',
      units: [
        expect.objectContaining({
          metadataProjection: expect.objectContaining({
            identityRefreshAttempts: 1,
          }),
        }),
      ],
    });
    await expect(
      service.startMetadataVerification(task.id, { expectedRevision: 5 }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.startAgent(task.id, { expectedRevision: 5 }),
    ).resolves.toMatchObject({ status: 'needs-operator' });
    expect(task.llmConversationId).toMatch(/^204170000000019/u);
  });

  it('migrates persisted deferred identity tasks to the bounded Agent branch', async () => {
    const { gateway, service, stateStore } = fixture();
    await service.onModuleInit();
    const task = await service.create({
      mediaType: 'tv',
      seasonNumbers: ['S01'],
      titleHint: '旧延迟身份状态迁移测试',
    });
    task.governanceProfile = 'sidecar-bundled';
    task.metadataStatus = 'requires-agent';
    task.runState = 'blocked';
    sealCanonicalPlan(task);
    task.stage = 'metadata';
    task.units[0]!.evidenceSha256 = 'b'.repeat(64);
    task.units[0]!.metadataProjection.missingA = [
      'identity.provider',
      'identity.providerId',
    ];
    task.units[0]!.metadataProjection.missingB = [
      'metadata.local-nfo',
      'artwork.poster',
    ];
    delete task.units[0]!.metadataProjection.identityRefreshAttempts;
    const storedTask = structuredClone(
      task,
    ) as unknown as MediaGovernanceStoredTask;
    (
      stateStore.loadTasks as jest.MockedFunction<
        MediaGovernanceStateStore['loadTasks']
      >
    ).mockResolvedValue([storedTask]);

    const restoredService = new MediaGovernanceService(
      undefined,
      undefined,
      stateStore,
      gateway,
      undefined,
      {
        resolveModel: jest.fn(async () => 'gpt-test'),
        runtimeForProvider: jest.fn(async () => ({
          entity: { id: '2041700000000100002' },
        })),
      } as never,
      {
        createScene: jest.fn(async () => ({
          id: '2041700000000199001',
        })),
        resolveIdentity: jest.fn(async (input) => ({
          activeTurnId: null,
          conversationId: input.conversationId,
          providerThreadId: null,
          scene: input.scene,
          sceneRefId: input.sceneRefId,
        })),
      } as never,
    );
    await restoredService.onModuleInit();
    const restored = restoredService.detail(task.id);

    expect(restored).toMatchObject({
      nextCommandLabel: '启动 CodexAgent 有界人工治理',
      units: [
        expect.objectContaining({
          metadataProjection: expect.objectContaining({
            identityRefreshAttempts: 1,
          }),
        }),
      ],
    });
    await expect(
      restoredService.startAgent(restored.id, {
        expectedRevision: restored.revision,
      }),
    ).resolves.toMatchObject({ status: 'needs-operator' });
    expect(restored.llmConversationId).toBe('2041700000000199001');
  });

  it.each([
    ['sidecar-bundled', null, 'bounded_repair'],
    ['embedded', 'automatic', 'automatic'],
  ] as const)(
    'persists exact metadata facts and closes %s repair with the correct mode',
    async (governanceProfile, modeAfterRepair, expectedClosedMode) => {
      const { dispatch, service } = fixture();
      await service.onModuleInit();
      const task = await service.create({
        mediaType: 'tv',
        seasonNumbers: ['S01'],
        titleHint: '有界元数据修复测试',
      });
      task.governanceProfile = governanceProfile;
      task.metadataIdentity = {
        provider: 'tmdb',
        providerId: '202821',
        releaseYear: 2023,
      };
      task.metadataStatus = 'requires-agent';
      task.runState = 'blocked';
      task.stage = 'metadata';
      sealCanonicalPlan(task);
      task.units[0]!.expectedEpisodeNumbers = [1];
      task.units[0]!.metadataProjection.missingB = [
        'metadata.local-nfo',
        'artwork.poster',
      ];

      await service.startMetadataRepair(task.id, { expectedRevision: 1 });
      const envelope = dispatch.mock.calls.at(-1)?.[0];
      expect(envelope).toMatchObject({
        action: 'metadata.repair',
        metadataRepairAttempt: 1,
        taskRevision: 2,
      });
      await service.applyExecutorEvent({
        action: 'metadata.repair',
        eventType: 'run-started',
        observedAt: new Date().toISOString(),
        runId: envelope.runId,
        sequence: 1,
        summary: '有界元数据修复开始',
        taskId: task.id,
        taskRevision: 2,
      });
      await expect(
        service.applyExecutorEvent({
          action: 'metadata.repair',
          evidenceSha256: 'b'.repeat(64),
          eventType: 'run-succeeded',
          metadata: {
            canAccept: true,
            identity: {
              provider: 'tmdb',
              providerId: '202821',
              releaseYear: 2023,
            },
            repairAttempts: 1,
            schemaVersion: 'media-admin-metadata-verification-v1',
            units: [
              {
                accepted: true,
                missingA: [],
                missingB: [],
                missingC: [],
                unitId: task.units[0]!.id,
              },
            ],
            writeBoundaries: {
              cloud: 1,
              databaseDirect: 0,
              mechanicalScan: 0,
              ui: 0,
            },
          },
          observedAt: new Date().toISOString(),
          runId: envelope.runId,
          sequence: 2,
          summary: '越界元数据修复',
          taskId: task.id,
          taskRevision: 2,
        }),
      ).rejects.toMatchObject({ status: 400 });
      await service.applyExecutorEvent({
        action: 'metadata.repair',
        evidenceSha256: 'b'.repeat(64),
        eventType: 'run-succeeded',
        metadata: {
          canAccept: true,
          identity: {
            provider: 'tmdb',
            providerId: '202821',
            releaseYear: 2023,
          },
          repairAttempts: 1,
          schemaVersion: 'media-admin-metadata-verification-v1',
          units: [
            {
              accepted: true,
              missingA: [],
              missingB: [],
              missingC: [],
              unitId: task.units[0]!.id,
            },
          ],
          writeBoundaries: {
            cloud: 0,
            databaseDirect: 0,
            mechanicalScan: 0,
            ui: 0,
          },
        },
        observedAt: new Date().toISOString(),
        runId: envelope.runId,
        sequence: 2,
        summary: '有界元数据修复完成',
        taskId: task.id,
        taskRevision: 2,
      });

      expect(task).toMatchObject({
        activeRunId: null,
        closedMode: modeAfterRepair,
        metadataIdentity: {
          provider: 'tmdb',
          providerId: '202821',
          releaseYear: 2023,
        },
        metadataStatus: 'pending',
        nextCommandLabel: '重新运行 A/B/C 分档元数据核验',
        revision: 3,
        runState: 'succeeded',
      });
      expect(task.identityPreview).toMatchObject({
        providerLabel: 'TMDB · 202821',
        releaseYearLabel: '2023 年',
        status: 'verified-provider-identity',
        statusLabel: '元数据身份已验证',
      });
      expect(task.units[0]).toMatchObject({
        evidenceSha256: 'b'.repeat(64),
        metadataProjection: {
          missingA: [],
          missingB: [],
          missingC: [],
          repairAttempts: 1,
          validBFallbacks: [],
        },
      });

      await service.startMetadataVerification(task.id, { expectedRevision: 3 });
      const verificationEnvelope = dispatch.mock.calls.at(-1)?.[0];
      await service.applyExecutorEvent({
        action: 'metadata.verify',
        eventType: 'run-started',
        observedAt: new Date().toISOString(),
        runId: verificationEnvelope.runId,
        sequence: 1,
        summary: '元数据复核开始',
        taskId: task.id,
        taskRevision: 4,
      });
      await service.applyExecutorEvent({
        action: 'metadata.verify',
        evidenceSha256: 'c'.repeat(64),
        eventType: 'run-succeeded',
        metadata: {
          canAccept: true,
          identity: {
            provider: 'tmdb',
            providerId: '202821',
            releaseYear: 2023,
          },
          repairAttempts: 0,
          schemaVersion: 'media-admin-metadata-verification-v1',
          units: [
            {
              accepted: true,
              missingA: [],
              missingB: [],
              missingC: [],
              unitId: task.units[0]!.id,
            },
          ],
          writeBoundaries: {
            cloud: 0,
            databaseDirect: 0,
            mechanicalScan: 0,
            ui: 0,
          },
        },
        observedAt: new Date().toISOString(),
        runId: verificationEnvelope.runId,
        sequence: 2,
        summary: '元数据复核通过',
        taskId: task.id,
        taskRevision: 4,
      });
      await service.startAcceptanceVerification(task.id, {
        expectedRevision: 5,
      });
      const acceptanceEnvelope = dispatch.mock.calls.at(-1)?.[0];
      await service.applyExecutorEvent({
        action: 'acceptance.verify',
        eventType: 'run-started',
        observedAt: new Date().toISOString(),
        runId: acceptanceEnvelope.runId,
        sequence: 1,
        summary: '独立验收开始',
        taskId: task.id,
        taskRevision: 6,
      });
      await service.applyExecutorEvent({
        acceptance: {
          acceptedFiles: 2,
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
        runId: acceptanceEnvelope.runId,
        sequence: 2,
        summary: '独立验收通过',
        taskId: task.id,
        taskRevision: 6,
      });
      expect(task).toMatchObject({
        closedMode: expectedClosedMode,
        metadataStatus: 'verified',
        revision: 7,
        stage: 'closed',
      });
    },
  );

  it('recollects legacy empty metadata facts through deterministic verification', async () => {
    const { dispatch, service } = fixture();
    await service.onModuleInit();
    const task = await service.create({
      mediaType: 'tv',
      seasonNumbers: ['S01'],
      titleHint: '旧元数据投影迁移测试',
    });
    task.governanceProfile = 'sidecar-bundled';
    task.metadataStatus = 'requires-agent';
    task.runState = 'blocked';
    sealCanonicalPlan(task);
    task.stage = 'metadata';

    await service.startMetadataVerification(task.id, { expectedRevision: 1 });

    expect(dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'metadata.verify',
        taskRevision: 2,
      }),
    );
  });

  it('retries a revisioned plan-sealing failure after its contract is corrected', async () => {
    const { dispatch, service, stateStore } = fixture();
    await service.onModuleInit();
    const task = await service.create({
      mediaType: 'movie',
      titleHint: '可重试计划测试',
    });
    const source = await service.addMagnetSource(task.id, {
      contentKind: 'embedded_subtitle_media',
      expectedRevision: 1,
      magnetUri: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
      sourceRole: 'primary_media',
    });
    const relativePath = 'Retryable.Movie.mkv';
    source.manifest = [
      { executable: false, index: 0, relativePath, sizeBytes: 1_024 },
    ];
    source.selectedFileCount = 1;
    source.selectedFileIndices = [0];
    task.stage = 'download';
    task.runState = 'succeeded';
    task.payloadSeal = {
      evidenceSha256: 'e'.repeat(64),
      files: [
        {
          index: 0,
          mtimeMs: 1_786_000_000_000,
          path: `/vol2/1000/.kt-media-governance-staging/${task.id}/sources/${source.id}/${relativePath}`,
          relativePath,
          sha256: 'a'.repeat(64),
          sizeBytes: 1_024,
          sourceId: source.id,
        },
      ],
      runId: 'media-run-download-retry-fixture',
    };

    await expect(
      service.startGovernance(task.id, { expectedRevision: 2 }),
    ).rejects.toMatchObject({ status: 409 });
    expect(task).toMatchObject({
      activeRunId: null,
      revision: 3,
      runState: 'blocked',
      stage: 'download',
      workItemId: 'media-063',
    });
    expect(task.gateReason).toContain(
      'governance-selected-file-mapping-missing',
    );

    source.selectedFileMappings = [
      {
        episodeNumber: null,
        fileRole: 'video',
        index: 0,
        language: null,
        unitId: task.units[0]!.id,
      },
    ];
    await service.startGovernance(task.id, { expectedRevision: 3 });

    expect(stateStore.reserveWorkItemId).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls.at(-1)?.[0]).toMatchObject({
      action: 'governance.execute',
      taskRevision: 4,
    });
    expect(task).toMatchObject({
      gateReason: null,
      revision: 4,
      runState: 'queued',
      stage: 'governance',
    });
  });
});

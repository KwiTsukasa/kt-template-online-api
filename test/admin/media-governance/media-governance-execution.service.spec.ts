import type {
  MediaGovernanceExecutionEnvelope,
  MediaGovernanceExecutionGateway,
} from '../../../src/modules/admin/media-governance/media-governance-execution.gateway';
import type { MediaGovernanceStateStore } from '../../../src/modules/admin/media-governance/media-governance-state.store';
import { MediaGovernanceService } from '../../../src/modules/admin/media-governance/media-governance.service';

describe('MediaGovernanceService production execution adapter', () => {
  function fixture() {
    const sequences = new Map<string, number>();
    const envelopes = new Map<string, MediaGovernanceExecutionEnvelope>();
    const reserved: unknown[] = [];
    const acknowledged: unknown[] = [];
    const stateStore: MediaGovernanceStateStore = {
      acknowledgeRunDispatch: jest.fn(async (...args) => {
        acknowledged.push(args);
      }),
      applyExecutorEvent: jest.fn(async (_task, event) => {
        sequences.set(event.runId, event.sequence);
        return true;
      }),
      consumeDescriptorGrant: jest.fn(),
      isReady: () => true,
      loadTasks: jest.fn(async () => []),
      pendingRunDispatches: jest.fn(async () => []),
      recordRunDispatchFailure: jest.fn(async () => 1),
      readRunSequence: jest.fn(async (runId) => sequences.get(runId) ?? 0),
      readRunEnvelope: jest.fn(async (runId) => envelopes.get(runId) ?? null),
      reserveWorkItemId: jest.fn(async () => 'media-063'),
      reserveRunDispatch: jest.fn(async (...args) => {
        reserved.push(args);
        envelopes.set(args[1].runId, args[1]);
      }),
      failRunDispatch: jest.fn(async () => undefined),
      saveTask: jest.fn(async () => undefined),
      saveTaskWithAgentEvent: jest.fn(async () => undefined),
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
      enabled: () => true,
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
      undefined,
      undefined,
      undefined,
      stateStore,
      gateway,
    );
    return {
      acknowledged,
      dispatch,
      gateway,
      reserved,
      service,
      stateStore,
    };
  }

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
    ).resolves.toEqual({ applied: true, revision: 3 });
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
      sequence: 2,
      sourceId: source.id,
      summary: '已检查 1 个来源文件',
    });
    await expect(
      service.applyExecutorEvent({
        ...base,
        evidenceSha256: 'e'.repeat(64),
        eventType: 'run-succeeded',
        sequence: 3,
        summary: '来源清单检查完成',
      }),
    ).resolves.toEqual({ applied: true, revision: 4 });

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
        sequence: 3,
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

  it('reconciles a vanished runner into one durable blocked terminal state', async () => {
    const { dispatch, gateway, service } = fixture();
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

    const reconcile = service as unknown as {
      reconcileActiveExecutions(): Promise<void>;
    };
    await reconcile.reconcileActiveExecutions();

    expect(task).toMatchObject({
      activeRunId: null,
      gateReason: 'NAS 执行单元已退出或被回收，但未返回可验证终态',
      revision: 4,
      runState: 'blocked',
    });
    await reconcile.reconcileActiveExecutions();
    expect(task.revision).toBe(4);
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
    metadataTask.sealedPlan = { schemaVersion: '1.2.0' };
    metadataTask.sealedPlanSha256 = 'a'.repeat(64);
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
    acceptanceTask.sealedPlan = { schemaVersion: '1.2.0' };
    acceptanceTask.sealedPlanSha256 = 'b'.repeat(64);
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

  it('rechecks deferred fnOS identity before escalating metadata to Agent', async () => {
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
    task.sealedPlan = { schemaVersion: '1.2.0' };
    task.sealedPlanSha256 = 'a'.repeat(64);
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
    await expect(
      service.startAgent(task.id, { expectedRevision: 3 }),
    ).rejects.toMatchObject({
      response: { msg: '当前任务应先重新采集元数据事实' },
      status: 409,
    });

    await service.startMetadataVerification(task.id, { expectedRevision: 3 });
    const retryEnvelope = dispatch.mock.calls.at(-1)?.[0];
    expect(retryEnvelope).toMatchObject({
      action: 'metadata.verify',
      replayKey: `${task.id}:metadata.verify:r4`,
      taskRevision: 4,
    });
    expect(retryEnvelope.runId).not.toBe(firstEnvelope.runId);
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
    task.sealedPlan = { schemaVersion: '1.2.0' };
    task.sealedPlanSha256 = 'a'.repeat(64);
    task.units[0]!.expectedEpisodeNumbers = [1];
    task.units[0]!.metadataProjection.missingB = [
      'metadata.local-nfo',
      'artwork.poster',
    ];

    await expect(
      service.startAgent(task.id, { expectedRevision: 1 }),
    ).rejects.toMatchObject({
      response: { msg: '当前缺口应先执行确定性有界元数据修复' },
      status: 409,
    });

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
    await service.startAcceptanceVerification(task.id, { expectedRevision: 5 });
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

  it('recollects legacy empty metadata facts before repair or Agent routing', async () => {
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
    task.sealedPlan = { schemaVersion: '1.2.0' };
    task.sealedPlanSha256 = 'a'.repeat(64);
    task.stage = 'metadata';

    await expect(
      service.startAgent(task.id, { expectedRevision: 1 }),
    ).rejects.toMatchObject({
      response: { msg: '当前任务应先重新采集元数据事实' },
      status: 409,
    });
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

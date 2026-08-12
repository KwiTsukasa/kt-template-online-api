import type { MediaGovernanceExecutionGateway } from '../../../src/modules/admin/media-governance/media-governance-execution.gateway';
import type { MediaGovernanceStateStore } from '../../../src/modules/admin/media-governance/media-governance-state.store';
import { MediaGovernanceService } from '../../../src/modules/admin/media-governance/media-governance.service';

describe('MediaGovernanceService production execution adapter', () => {
  function fixture() {
    const sequences = new Map<string, number>();
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
      reserveRunDispatch: jest.fn(async (...args) => {
        reserved.push(args);
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
    };
    const service = new MediaGovernanceService(
      undefined,
      undefined,
      undefined,
      stateStore,
      gateway,
    );
    return { acknowledged, dispatch, reserved, service, stateStore };
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

  it('seals one Schema 1.2.0 plan before dispatching the formal local transaction', async () => {
    const { dispatch, service } = fixture();
    await service.onModuleInit();
    const task = await service.create({
      mediaType: 'movie',
      providerRef: { provider: 'tmdb', providerId: '603' },
      releaseYear: 1999,
      titleHint: '黑客帝国',
      workItemId: 'media-063',
    });
    const source = await service.addMagnetSource(task.id, {
      contentKind: 'embedded_subtitle_media',
      expectedRevision: 1,
      magnetUri: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
      sourceRole: 'primary_media',
    });
    const sourceRoot = `/vol2/1000/.kt-media-governance-staging/${task.id}/sources/${source.id}`;
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

    const envelope = dispatch.mock.calls.at(-1)?.[0];
    expect(envelope).toMatchObject({
      action: 'governance.execute',
      plan: {
        planGrantId: expect.stringMatching(/^media-plan-grant-/),
        planSha256: task.sealedPlanSha256,
        schemaVersion: '1.2.0',
        strategy: 'embedded',
      },
      taskId: task.id,
    });
    expect(envelope.sources).toBeUndefined();
    expect(task).toMatchObject({
      activeRunId: envelope.runId,
      revision: 3,
      runState: 'queued',
      stage: 'governance',
    });

    await service.applyExecutorEvent({
      action: 'governance.execute',
      eventType: 'run-started',
      observedAt: new Date().toISOString(),
      runId: envelope.runId,
      sequence: 1,
      summary: '本地事务开始',
      taskId: task.id,
      taskRevision: 3,
    });
    await service.applyExecutorEvent({
      action: 'governance.execute',
      evidenceSha256: 'b'.repeat(64),
      eventType: 'run-succeeded',
      observedAt: new Date().toISOString(),
      runId: envelope.runId,
      sequence: 2,
      summary: '本地事务完成',
      taskId: task.id,
      taskRevision: 3,
    });
    expect(task).toMatchObject({
      activeRunId: null,
      metadataStatus: 'pending',
      revision: 4,
      runState: 'succeeded',
      stage: 'metadata',
    });

    await service.startMetadataVerification(task.id, { expectedRevision: 4 });
    const metadataEnvelope = dispatch.mock.calls.at(-1)?.[0];
    expect(metadataEnvelope).toMatchObject({
      action: 'metadata.verify',
      taskRevision: 5,
    });
    await service.applyExecutorEvent({
      action: 'metadata.verify',
      eventType: 'run-started',
      observedAt: new Date().toISOString(),
      runId: metadataEnvelope.runId,
      sequence: 1,
      summary: '元数据核验开始',
      taskId: task.id,
      taskRevision: 5,
    });
    await service.applyExecutorEvent({
      action: 'metadata.verify',
      evidenceSha256: 'c'.repeat(64),
      eventType: 'run-succeeded',
      metadata: {
        canAccept: true,
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
      taskRevision: 5,
    });
    expect(task).toMatchObject({
      metadataStatus: 'verified',
      revision: 6,
      runState: 'succeeded',
      stage: 'metadata',
    });

    await service.startAcceptanceVerification(task.id, { expectedRevision: 6 });
    const acceptanceEnvelope = dispatch.mock.calls.at(-1)?.[0];
    expect(acceptanceEnvelope).toMatchObject({
      action: 'acceptance.verify',
      taskRevision: 7,
    });
    await service.applyExecutorEvent({
      action: 'acceptance.verify',
      eventType: 'run-started',
      observedAt: new Date().toISOString(),
      runId: acceptanceEnvelope.runId,
      sequence: 1,
      summary: '独立验收开始',
      taskId: task.id,
      taskRevision: 7,
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
      taskRevision: 7,
    });
    expect(task).toMatchObject({
      activeRunId: null,
      metadataStatus: 'verified',
      revision: 8,
      runState: 'succeeded',
      stage: 'closed',
    });
  });
});

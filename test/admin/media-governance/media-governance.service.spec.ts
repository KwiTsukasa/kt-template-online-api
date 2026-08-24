import { HttpException } from '@nestjs/common';
import {
  MediaGovernanceService,
  type MediaGovernanceTask,
} from '../../../src/modules/admin/media-governance/application/media-governance.service';

describe('MediaGovernanceService', () => {
  let service: MediaGovernanceService;

  beforeEach(() => {
    service = new MediaGovernanceService();
  });

  it('keeps the production Agent callback gate closed for process-only tasks', () => {
    expect(service.agentCallbackHealth()).toEqual({
      persistenceMode: 'process-simulator',
      status: 'not-ready',
    });
  });

  it('creates one TV task with independent S00 and normal-season units', async () => {
    const task = await service.create({
      mediaType: 'tv',
      providerRef: {
        provider: 'tmdb',
        providerId: '105476',
      },
      releaseYear: 2021,
      seasonNumbers: ['S00', 'S01'],
      titleHint: '异世界迷宫黑心企业',
    });

    expect(task).toMatchObject({
      gateReason: null,
      mediaType: 'tv',
      persistenceMode: 'process-simulator',
      revision: 1,
      runState: 'draft',
      stage: 'intake',
      titleHint: '异世界迷宫黑心企业',
    });
    expect(task.id).toMatch(/^media-task-/);
    expect(task.units).toEqual([
      expect.objectContaining({ seasonNumber: 'S00', unitKind: 'season' }),
      expect.objectContaining({ seasonNumber: 'S01', unitKind: 'season' }),
    ]);
    expect(task.identityPreview).toMatchObject({
      mediaTypeLabel: 'TV 正常剧集',
      providerLabel: 'TMDB · 105476',
      releaseYearLabel: '2021 年',
      seasonLabel: 'S00、S01',
      status: 'pending-provider-verification',
      statusLabel: '待资料源核验',
    });
    expect(service.detail(task.id).id).toBe(task.id);
    expect(service.summary()).toMatchObject({
      agentPending: 0,
      attentionRequired: 0,
      blocked: 0,
      closed: 0,
      downloading: 0,
      evidenceDriftCount: 0,
      governing: 0,
      healthLabel: '运行核对正常',
      mixedSubtitleSeasonCount: 0,
      stagingResidualCount: null,
      stuckRunCount: 0,
      total: 1,
    });
    expect(task.semanticProjection).toEqual({
      currentActionLabel: '等待补充来源',
      discardAllowed: true,
      discardReasonLabel: null,
      gateReasonLabel: '无阻塞',
      metadataStatusLabel: '待校验',
      runStateLabel: '草稿',
      sourceHealthLabel: '未检查',
      stageLabel: '接收资料',
    });
  });

  it.each([
    [
      'TV 缺少季号',
      { mediaType: 'tv', seasonNumbers: [], titleHint: '测试作品' },
    ],
    [
      '电影错误携带季号',
      { mediaType: 'movie', seasonNumbers: ['S00'], titleHint: '测试电影' },
    ],
    [
      '同一季重复声明',
      {
        mediaType: 'tv',
        seasonNumbers: ['S01', 'S01'],
        titleHint: '测试作品',
      },
    ],
  ])('rejects %s before creating a draft', async (_name, input) => {
    await expect(service.create(input as never)).rejects.toThrow(HttpException);
    expect(service.page({ pageNo: 1, pageSize: 20 }).total).toBe(0);
  });

  it('creates a movie unit without disguising it as S00', async () => {
    const task = await service.create({
      mediaType: 'theatrical',
      titleHint: '剧场版测试',
    });

    expect(task.units).toEqual([
      expect.objectContaining({ seasonNumber: null, unitKind: 'movie' }),
    ]);
    expect(task.identityPreview.seasonLabel).toBe('电影单元（不使用 S00）');
  });

  it('automatically starts the first pending RSS source inspection', async () => {
    const task = await service.create({
      mediaType: 'tv',
      operationKind: 'rss-intake',
      seasonNumbers: ['S01'],
      titleHint: 'RSS 自动接收测试',
    });
    const source = await service.addMagnetSource(task.id, {
      contentKind: 'bundled_sidecar_media',
      expectedRevision: task.revision,
      magnetUri: 'magnet:?xt=urn:btih:7123456789abcdef0123456789abcdef01234567',
      releaseGroup: 'LoliHouse',
      seasonNumbers: ['S01'],
      sourceRole: 'primary_media',
    });
    const inspectSource = jest
      .spyOn(service, 'inspectSource')
      .mockResolvedValue(source);
    const internal = service as unknown as {
      continueRssIntakePipeline: (
        task: MediaGovernanceTask,
      ) => Promise<boolean>;
    };

    await expect(internal.continueRssIntakePipeline(task)).resolves.toBe(true);
    expect(inspectSource).toHaveBeenCalledWith(task.id, source.id, {
      expectedRevision: task.revision,
    });
  });

  it('maps an inspected RSS source before probing and downloading it', async () => {
    const task = await service.create({
      mediaType: 'tv',
      operationKind: 'rss-intake',
      seasonNumbers: ['S01'],
      titleHint: '死神 千年血战篇-相克谭-',
    });
    const source = await service.addMagnetSource(task.id, {
      contentKind: 'bundled_sidecar_media',
      expectedRevision: task.revision,
      magnetUri: 'magnet:?xt=urn:btih:8123456789abcdef0123456789abcdef01234567',
      releaseGroup: 'LoliHouse',
      seasonNumbers: ['S01'],
      sourceRole: 'primary_media',
    });
    source.manifestState = 'inspected';
    source.manifest = [
      {
        executable: false,
        index: 0,
        relativePath: 'BLEACH - 27.mkv',
        sizeBytes: 500_000_000,
      },
      {
        executable: false,
        index: 1,
        relativePath: 'BLEACH - 27.sc.ass',
        sizeBytes: 500_000,
      },
      {
        executable: false,
        index: 2,
        relativePath: 'BLEACH - 27.nfo',
        sizeBytes: 2_000,
      },
    ];
    source.selectedFileCount = 3;
    source.selectedFileIndices = [0, 1, 2];
    source.selectedBytes = 500_502_000;
    source.sourceHealth = 'unchecked';
    const probeRuntimeSource = jest
      .spyOn(service, 'probeRuntimeSource')
      .mockResolvedValue(source);
    const internal = service as unknown as {
      continueRssIntakePipeline: (
        task: MediaGovernanceTask,
      ) => Promise<boolean>;
    };

    await expect(internal.continueRssIntakePipeline(task)).resolves.toBe(true);
    expect(source.selectedFileMappings).toEqual([
      expect.objectContaining({
        episodeNumber: 27,
        fileRole: 'video',
        index: 0,
      }),
      expect.objectContaining({
        episodeNumber: 27,
        fileRole: 'subtitle',
        index: 1,
        language: 'zh-CN',
      }),
    ]);
    expect(probeRuntimeSource).toHaveBeenCalledWith(task.id, source.id, {
      expectedRevision: task.revision,
    });

    probeRuntimeSource.mockRestore();
    source.sourceHealth = 'viable';
    const startDownload = jest
      .spyOn(service, 'startDownload')
      .mockResolvedValue(task);
    await expect(internal.continueRssIntakePipeline(task)).resolves.toBe(true);
    expect(startDownload).toHaveBeenCalledWith(task.id, {
      expectedRevision: task.revision,
    });
  });

  it('updates a draft identity without replacing its existing source state', async () => {
    const task = await service.create({
      mediaType: 'tv',
      releaseYear: 2015,
      seasonNumbers: ['S01'],
      titleHint: '下载前身份修正',
    });
    await service.addMagnetSource(task.id, {
      contentKind: 'bundled_sidecar_media',
      expectedRevision: 1,
      magnetUri: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
      releaseGroup: 'TestGroup',
      seasonNumbers: ['S01'],
      sourceRole: 'primary_media',
    });
    const sourceBefore = structuredClone(task.sources[0]);
    const snapshotBefore = task.inputSnapshotSha256;

    const updated = await service.updateIdentity(task.id, {
      expectedRevision: 2,
      providerRef: { provider: 'tmdb', providerId: '63145' },
    });

    expect(updated).toMatchObject({
      providerRef: { provider: 'tmdb', providerId: '63145' },
      releaseYear: 2015,
      revision: 3,
      runState: 'draft',
      stage: 'intake',
    });
    expect(updated.identityPreview.providerLabel).toBe('TMDB · 63145');
    expect(updated.inputSnapshotSha256).not.toBe(snapshotBefore);
    expect(updated.sources[0]).toEqual(sourceBefore);
  });

  it('updates draft media units while removing only invalid source mappings', async () => {
    const task = await service.create({
      mediaType: 'tv',
      seasonNumbers: ['S01', 'S02'],
      titleHint: '结构修正前',
    });
    await service.addMagnetSource(task.id, {
      contentKind: 'bundled_sidecar_media',
      expectedRevision: 1,
      magnetUri: 'magnet:?xt=urn:btih:1123456789abcdef0123456789abcdef01234567',
      releaseGroup: 'TestGroup',
      seasonNumbers: ['S01', 'S02'],
      sourceRole: 'primary_media',
    });
    const [seasonOneUnit, seasonTwoUnit] = task.units;
    task.sources[0].selectedFileMappings = [
      {
        episodeNumber: 1,
        fileRole: 'video',
        index: 0,
        language: null,
        unitId: seasonOneUnit.id,
      },
      {
        episodeNumber: 1,
        fileRole: 'video',
        index: 1,
        language: null,
        unitId: seasonTwoUnit.id,
      },
    ];

    const updated = await service.updateIdentity(task.id, {
      expectedRevision: 2,
      mediaType: 'tv',
      seasonNumbers: ['S00', 'S02'],
      titleHint: '结构修正后',
    });

    expect(updated).toMatchObject({
      mediaType: 'tv',
      revision: 3,
      titleHint: '结构修正后',
    });
    expect(updated.units.map((unit) => unit.seasonNumber)).toEqual([
      'S00',
      'S02',
    ]);
    expect(updated.units.find((unit) => unit.seasonNumber === 'S02')?.id).toBe(
      seasonTwoUnit.id,
    );
    expect(updated.sources[0].seasonNumbers).toEqual(['S02']);
    expect(updated.sources[0].selectedFileMappings).toEqual([
      expect.objectContaining({ index: 1, unitId: seasonTwoUnit.id }),
    ]);
    expect(updated.identityPreview).toMatchObject({
      seasonLabel: 'S00、S02',
      title: '结构修正后',
    });
  });

  it('searches, edits and discards only a pristine draft', async () => {
    const task = await service.create({
      mediaType: 'tv',
      providerRef: { provider: 'tmdb', providerId: '100' },
      releaseYear: 2024,
      seasonNumbers: ['S00', 'S01'],
      titleHint: '待整理的作品',
    });

    expect(service.page({ keyword: task.id.slice(-8) }).total).toBe(1);
    expect(service.page({ keyword: '不存在的关键词' }).total).toBe(0);

    const updated = await service.updateIdentity(task.id, {
      expectedRevision: 1,
      providerRef: null,
      releaseYear: null,
      titleHint: '已确认作品名',
    });
    expect(updated).toMatchObject({
      providerRef: null,
      releaseYear: null,
      revision: 2,
      titleHint: '已确认作品名',
    });
    expect(updated.identityPreview).toMatchObject({
      providerLabel: '未填写（后续由资料源候选核验）',
      releaseYearLabel: '未填写（后续按候选消歧）',
      title: '已确认作品名',
    });

    await expect(
      service.discardTask(task.id, { expectedRevision: 1 }),
    ).rejects.toThrow(HttpException);
    await expect(
      service.discardTask(task.id, { expectedRevision: 2 }),
    ).resolves.toEqual({
      clearedWorkItemId: null,
      deletedTaskId: task.id,
    });
    expect(service.page({ keyword: '已确认作品名' }).total).toBe(0);
    expect(() => service.detail(task.id)).toThrow(HttpException);
  });

  it('discards an intake draft together with its sources and bound local ledger', async () => {
    const task = await service.create({
      mediaType: 'movie',
      titleHint: '可删除草稿',
      workItemId: 'media-063',
    });
    await service.addMagnetSource(task.id, {
      contentKind: 'embedded_subtitle_media',
      expectedRevision: 1,
      magnetUri: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
      sourceRole: 'primary_media',
    });

    await expect(
      service.discardTask(task.id, { expectedRevision: 2 }),
    ).resolves.toEqual({
      clearedWorkItemId: 'media-063',
      deletedTaskId: task.id,
    });
    expect(() => service.detail(task.id)).toThrow(HttpException);
  });

  it('discards a blocked intake task after source inspection failed', async () => {
    const task = await service.create({
      mediaType: 'tv',
      seasonNumbers: ['S01'],
      titleHint: '来源检查失败后可删除',
    });
    await service.addMagnetSource(task.id, {
      contentKind: 'embedded_subtitle_media',
      expectedRevision: 1,
      magnetUri: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
      seasonNumbers: ['S01'],
      sourceRole: 'primary_media',
    });
    task.runState = 'blocked';
    task.gateReason = 'NAS 执行失败：magnet_metadata_unavailable';
    task.nextCommandLabel = '可重新填写来源、编辑文件清单或删除任务';

    expect(service.detail(task.id).semanticProjection).toMatchObject({
      discardAllowed: true,
      discardReasonLabel: null,
    });
    await expect(
      service.discardTask(task.id, { expectedRevision: 2 }),
    ).resolves.toEqual({
      clearedWorkItemId: null,
      deletedTaskId: task.id,
    });
  });

  it('refuses to discard a task after execution has started', async () => {
    const task = await service.create({
      mediaType: 'movie',
      titleHint: '已进入执行阶段',
    });
    task.activeRunId = 'media-run-active';
    task.runState = 'queued';
    task.stage = 'download';

    await expect(
      service.discardTask(task.id, { expectedRevision: 1 }),
    ).rejects.toThrow(HttpException);
  });

  it('resets an unbound legacy metadata residue after its last source is removed', async () => {
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
    task.units[0]!.metadataProjection = {
      identityRefreshAttempts: 1,
      missingA: ['identity.provider'],
      missingB: ['season.poster'],
      missingC: [],
      repairAttempts: 2,
      validBFallbacks: ['season.poster'],
    };

    await expect(
      service.removeSource(task.id, source.id, { expectedRevision: 2 }),
    ).resolves.toMatchObject({
      agentSession: null,
      metadataStatus: 'pending',
      revision: 3,
      runState: 'draft',
      sources: [],
      stage: 'intake',
      units: [
        expect.objectContaining({
          metadataProjection: {
            identityRefreshAttempts: 0,
            missingA: [],
            missingB: [],
            missingC: [],
            repairAttempts: 0,
            validBFallbacks: [],
          },
        }),
      ],
    });
    await expect(
      service.discardTask(task.id, { expectedRevision: 3 }),
    ).resolves.toEqual({
      clearedWorkItemId: null,
      deletedTaskId: task.id,
    });
  });

  it('fails closed when identity correction is stale or execution has begun', async () => {
    const task = await service.create({
      mediaType: 'movie',
      titleHint: '身份门禁测试',
    });

    await expect(
      service.updateIdentity(task.id, {
        expectedRevision: 2,
        providerRef: { provider: 'tmdb', providerId: '12345' },
      }),
    ).rejects.toThrow(HttpException);

    task.stage = 'download';
    await expect(
      service.updateIdentity(task.id, {
        expectedRevision: 1,
        providerRef: { provider: 'tmdb', providerId: '12345' },
      }),
    ).rejects.toThrow(HttpException);
  });

  it('rejects an unknown detail identity', () => {
    expect(() => service.detail('media-task-missing')).toThrow(HttpException);
  });

  it('reports blocked, stale-run and closed-evidence drift without fixed green counters', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-14T12:00:00.000Z'));
    try {
      const blocked = await service.create({
        mediaType: 'tv',
        seasonNumbers: ['S01'],
        titleHint: '阻塞任务',
      });
      blocked.persistenceMode = 'database';
      blocked.activeRunId = 'media-run-paused-fixture';
      blocked.runState = 'blocked';
      blocked.sources = [
        {
          releaseGroup: 'Group-A',
          selectedFileMappings: [
            {
              fileRole: 'subtitle',
              unitId: blocked.units[0].id,
            },
          ],
        },
        {
          releaseGroup: 'Group-B',
          selectedFileMappings: [
            {
              fileRole: 'subtitle',
              unitId: blocked.units[0].id,
            },
          ],
        },
      ] as never;

      const staleRun = await service.create({
        mediaType: 'tv',
        seasonNumbers: ['S01'],
        titleHint: '失联运行',
      });
      staleRun.persistenceMode = 'database';
      staleRun.activeRunId = 'media-run-stale-fixture';
      staleRun.runState = 'running';
      Object.assign(staleRun.progress, {
        observedAt: '2026-08-14T11:49:59.000Z',
      });

      const evidenceDrift = await service.create({
        mediaType: 'movie',
        titleHint: '闭环证据漂移',
      });
      evidenceDrift.stage = 'closed';
      evidenceDrift.runState = 'succeeded';

      expect(service.summary()).toMatchObject({
        attentionRequired: 3,
        blocked: 1,
        evidenceDriftCount: 1,
        healthLabel: '发现 3 个任务需要处理',
        mixedSubtitleSeasonCount: 1,
        stagingResidualCount: null,
        stuckRunCount: 1,
      });
      expect(service.detail(staleRun.id).progress.heartbeatLabel).toBe(
        '10 分钟前',
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('runs the complete source, subtitle and progress Demo without storing raw trackers', async () => {
    jest.useFakeTimers();
    try {
      const task = await service.create({
        mediaType: 'tv',
        seasonNumbers: ['S01'],
        titleHint: '完整 Demo',
      });
      const primary = await service.addMagnetSource(task.id, {
        contentKind: 'subtitleless_media',
        expectedRevision: 1,
        magnetUri:
          'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=demo&tr=https%3A%2F%2Fprivate.invalid%2Fpasskey',
        releaseGroup: 'DBD-Raws',
        seasonNumbers: ['S01'],
        sourceRole: 'primary_media',
      });
      expect(primary.infoHash).toBe('0123456789abcdef0123456789abcdef01234567');
      expect(JSON.stringify(service.detail(task.id))).not.toContain(
        'private.invalid',
      );

      const supplemental = await service.addMagnetSource(task.id, {
        contentKind: 'sidecar_subtitle_package',
        expectedRevision: 2,
        magnetUri:
          'magnet:?xt=urn:btih:fedcba9876543210fedcba9876543210fedcba98&dn=subtitle',
        releaseGroup: 'DBD-Raws',
        seasonNumbers: ['S01'],
        sourceRole: 'supplemental_subtitle',
      });
      await service.bindSubtitleContract(task.id, task.units[0].id, {
        expectedEpisodeNumbers: [1],
        expectedRevision: 3,
        mappings: [{ episodeNumber: 1, relativePath: 'S01/01.zh-Hans.ass' }],
        releaseGroup: 'DBD-Raws',
        sourceId: supplemental.id,
      });
      await service.inspectSource(task.id, primary.id, { expectedRevision: 4 });
      await service.updateSourceSelection(task.id, primary.id, {
        expectedRevision: 5,
        fileMappings: [
          {
            episodeNumber: 1,
            fileRole: 'video',
            index: 0,
            unitId: task.units[0].id,
          },
        ],
        selectedFileIndices: [0],
      });
      await service.probeRuntimeSource(task.id, primary.id, {
        expectedRevision: 6,
      });
      await service.inspectSource(task.id, supplemental.id, {
        expectedRevision: 7,
      });
      await service.updateSourceSelection(task.id, supplemental.id, {
        expectedRevision: 8,
        fileMappings: [
          {
            episodeNumber: 1,
            fileRole: 'subtitle',
            index: 0,
            language: 'zh-CN',
            unitId: task.units[0].id,
          },
        ],
        selectedFileIndices: [0],
      });
      await service.probeRuntimeSource(task.id, supplemental.id, {
        expectedRevision: 9,
      });
      await service.startDownload(task.id, { expectedRevision: 10 });
      jest.advanceTimersByTime(1_000);
      await Promise.resolve();

      expect(service.detail(task.id)).toMatchObject({
        progress: { percent: 100, progressLabel: '来源载荷已就绪' },
        runState: 'succeeded',
        stage: 'download',
      });
      expect(service.summary()).toMatchObject({ downloading: 0, total: 1 });
    } finally {
      jest.useRealTimers();
    }
  });

  it('fails closed on a stale command revision', async () => {
    const task = await service.create({
      mediaType: 'movie',
      titleHint: '陈旧版本测试',
    });

    await expect(
      service.addMagnetSource(task.id, {
        contentKind: 'embedded_subtitle_media',
        expectedRevision: 9,
        magnetUri:
          'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
        seasonNumbers: [],
        sourceRole: 'primary_media',
      }),
    ).rejects.toThrow(HttpException);
  });

  it('allows multiple primary episode sources but keeps one governance profile', async () => {
    const task = await service.create({
      mediaType: 'movie',
      titleHint: '多来源下载 owner 测试',
    });
    await service.addMagnetSource(task.id, {
      contentKind: 'embedded_subtitle_media',
      expectedRevision: 1,
      magnetUri: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
      seasonNumbers: [],
      sourceRole: 'primary_media',
    });

    await expect(
      service.addMagnetSource(task.id, {
        contentKind: 'embedded_subtitle_media',
        expectedRevision: 2,
        magnetUri:
          'magnet:?xt=urn:btih:fedcba9876543210fedcba9876543210fedcba98',
        seasonNumbers: [],
        sourceRole: 'primary_media',
      }),
    ).resolves.toMatchObject({ sourceRole: 'primary_media' });
    expect(service.detail(task.id).sources).toHaveLength(2);

    await expect(
      service.addMagnetSource(task.id, {
        contentKind: 'bundled_sidecar_media',
        expectedRevision: 3,
        magnetUri:
          'magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        seasonNumbers: [],
        sourceRole: 'primary_media',
      }),
    ).rejects.toMatchObject({
      response: {
        msg: '同一任务的主媒体来源必须使用一致治理类型',
      },
      status: 409,
    });
  });

  it('derives one bundled subtitle contract across multiple episode sources', async () => {
    const task = await service.create({
      mediaType: 'tv',
      seasonNumbers: ['S02'],
      titleHint: '多磁链逐集字幕合同测试',
    });
    const first = await service.addMagnetSource(task.id, {
      contentKind: 'bundled_sidecar_media',
      expectedRevision: 1,
      magnetUri: 'magnet:?xt=urn:btih:1111111111111111111111111111111111111111',
      releaseGroup: 'LoliHouse',
      seasonNumbers: ['S02'],
      sourceRole: 'primary_media',
    });
    const second = await service.addMagnetSource(task.id, {
      contentKind: 'bundled_sidecar_media',
      expectedRevision: 2,
      magnetUri: 'magnet:?xt=urn:btih:2222222222222222222222222222222222222222',
      releaseGroup: 'LoliHouse',
      seasonNumbers: ['S02'],
      sourceRole: 'primary_media',
    });
    for (const [source, episode] of [
      [first, 27],
      [second, 28],
    ] as const) {
      source.manifestState = 'inspected';
      source.manifest = [
        {
          executable: false,
          index: 0,
          relativePath: `BLEACH - ${episode}.mkv`,
          sizeBytes: 1_000,
        },
        {
          executable: false,
          index: 1,
          relativePath: `BLEACH - ${episode}.SC.ass`,
          sizeBytes: 100,
        },
      ];
    }
    await service.updateSourceSelection(task.id, first.id, {
      expectedRevision: 3,
      fileMappings: [
        {
          episodeNumber: 27,
          fileRole: 'video',
          index: 0,
          unitId: task.units[0].id,
        },
        {
          episodeNumber: 27,
          fileRole: 'subtitle',
          index: 1,
          language: 'zh-CN',
          unitId: task.units[0].id,
        },
      ],
      selectedFileIndices: [0, 1],
    });
    await service.updateSourceSelection(task.id, second.id, {
      expectedRevision: 4,
      fileMappings: [
        {
          episodeNumber: 28,
          fileRole: 'video',
          index: 0,
          unitId: task.units[0].id,
        },
        {
          episodeNumber: 28,
          fileRole: 'subtitle',
          index: 1,
          language: 'zh-CN',
          unitId: task.units[0].id,
        },
      ],
      selectedFileIndices: [0, 1],
    });

    expect(service.detail(task.id).units[0].subtitleContract).toMatchObject({
      expectedEpisodeNumbers: [27, 28],
      mappings: [
        expect.objectContaining({ episodeNumber: 27, sourceId: first.id }),
        expect.objectContaining({ episodeNumber: 28, sourceId: second.id }),
      ],
      releaseGroup: 'LoliHouse',
      sourceIds: [first.id, second.id],
    });
  });

  it('seals only subtitle and necessary font indices for a supplemental source', async () => {
    const task = await service.create({
      mediaType: 'tv',
      seasonNumbers: ['S01'],
      titleHint: '补充字幕选择测试',
    });
    await service.addMagnetSource(task.id, {
      contentKind: 'subtitleless_media',
      expectedRevision: 1,
      magnetUri: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
      seasonNumbers: ['S01'],
      sourceRole: 'primary_media',
    });
    const supplemental = await service.addMagnetSource(task.id, {
      contentKind: 'sidecar_subtitle_package',
      expectedRevision: 2,
      magnetUri: 'magnet:?xt=urn:btih:fedcba9876543210fedcba9876543210fedcba98',
      seasonNumbers: ['S01'],
      sourceRole: 'supplemental_subtitle',
    });
    supplemental.manifest = [
      {
        executable: false,
        index: 0,
        relativePath: 'S01E01.zh-Hans.ass',
        sizeBytes: 10,
      },
      {
        executable: false,
        index: 1,
        relativePath: 'S01E01.mkv',
        sizeBytes: 100,
      },
      {
        executable: false,
        index: 2,
        relativePath: '[Release][Fonts].7z',
        sizeBytes: 20,
      },
    ];

    await expect(
      service.updateSourceSelection(task.id, supplemental.id, {
        expectedRevision: 3,
        fileMappings: [
          {
            episodeNumber: 1,
            fileRole: 'subtitle',
            index: 0,
            language: 'zh-CN',
            unitId: task.units[0].id,
          },
          {
            episodeNumber: 1,
            fileRole: 'video',
            index: 1,
            unitId: task.units[0].id,
          },
        ],
        selectedFileIndices: [0, 1],
      }),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      service.updateSourceSelection(task.id, supplemental.id, {
        expectedRevision: 3,
        fileMappings: [
          {
            episodeNumber: 1,
            fileRole: 'subtitle',
            index: 0,
            language: 'zh-CN',
            unitId: task.units[0].id,
          },
          {
            fileRole: 'font',
            index: 2,
            unitId: task.units[0].id,
          },
        ],
        selectedFileIndices: [0, 2],
      }),
    ).resolves.toMatchObject({
      selectedBytes: 30,
      selectedFileCount: 2,
      selectedFileIndices: [0, 2],
      selectedFileMappings: [
        expect.objectContaining({ fileRole: 'subtitle', index: 0 }),
        expect.objectContaining({ fileRole: 'font', index: 2 }),
      ],
    });
  });

  it('allows different subtitle release groups between seasons while keeping each season consistent', async () => {
    const task = await service.create({
      mediaType: 'tv',
      seasonNumbers: ['S01', 'S02'],
      titleHint: '分季字幕发布组测试',
    });
    await service.addMagnetSource(task.id, {
      contentKind: 'subtitleless_media',
      expectedRevision: 1,
      magnetUri: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
      seasonNumbers: ['S01', 'S02'],
      sourceRole: 'primary_media',
    });
    const seasonOneSource = await service.addMagnetSource(task.id, {
      contentKind: 'sidecar_subtitle_package',
      expectedRevision: 2,
      magnetUri: 'magnet:?xt=urn:btih:1111111111111111111111111111111111111111',
      releaseGroup: 'Subtitle-Group-A',
      seasonNumbers: ['S01'],
      sourceRole: 'supplemental_subtitle',
    });
    await service.bindSubtitleContract(task.id, task.units[0].id, {
      expectedEpisodeNumbers: [1, 2],
      expectedRevision: 3,
      mappings: [
        { episodeNumber: 1, relativePath: 'S01/01.zh-Hans.ass' },
        { episodeNumber: 2, relativePath: 'S01/02.zh-Hans.ass' },
      ],
      releaseGroup: 'Subtitle-Group-A',
      sourceId: seasonOneSource.id,
    });
    const seasonTwoSource = await service.addMagnetSource(task.id, {
      contentKind: 'sidecar_subtitle_package',
      expectedRevision: 4,
      magnetUri: 'magnet:?xt=urn:btih:2222222222222222222222222222222222222222',
      releaseGroup: 'Subtitle-Group-B',
      seasonNumbers: ['S02'],
      sourceRole: 'supplemental_subtitle',
    });
    await service.bindSubtitleContract(task.id, task.units[1].id, {
      expectedEpisodeNumbers: [1, 2],
      expectedRevision: 5,
      mappings: [
        { episodeNumber: 1, relativePath: 'S02/01.zh-Hans.ass' },
        { episodeNumber: 2, relativePath: 'S02/02.zh-Hans.ass' },
      ],
      releaseGroup: 'Subtitle-Group-B',
      sourceId: seasonTwoSource.id,
    });

    expect(service.detail(task.id).units).toEqual([
      expect.objectContaining({
        seasonNumber: 'S01',
        subtitleContract: expect.objectContaining({
          releaseGroup: 'Subtitle-Group-A',
        }),
      }),
      expect.objectContaining({
        seasonNumber: 'S02',
        subtitleContract: expect.objectContaining({
          releaseGroup: 'Subtitle-Group-B',
        }),
      }),
    ]);
    await expect(
      service.bindSubtitleContract(task.id, task.units[0].id, {
        expectedEpisodeNumbers: [1],
        expectedRevision: 6,
        mappings: [{ episodeNumber: 1, relativePath: 'S01/01.zh-Hans.ass' }],
        releaseGroup: 'Subtitle-Group-B',
        sourceId: seasonTwoSource.id,
      }),
    ).rejects.toMatchObject({
      response: { msg: '字幕来源季范围与目标季不匹配' },
      status: 400,
    });
  });

  it('derives one complete-season subtitle contract from a bundled primary source', async () => {
    const task = await service.create({
      mediaType: 'tv',
      seasonNumbers: ['S01'],
      titleHint: '同包字幕合同测试',
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
        relativePath: 'S01E01.mkv',
        sizeBytes: 100,
      },
      {
        executable: false,
        index: 1,
        relativePath: 'S01E01.zh-CN.ass',
        sizeBytes: 10,
      },
      {
        executable: false,
        index: 2,
        relativePath: 'S01E02.mkv',
        sizeBytes: 100,
      },
      {
        executable: false,
        index: 3,
        relativePath: 'S01E02.zh-CN.ass',
        sizeBytes: 10,
      },
    ];

    await service.updateSourceSelection(task.id, source.id, {
      expectedRevision: 2,
      fileMappings: [
        {
          episodeNumber: 1,
          fileRole: 'video',
          index: 0,
          unitId: task.units[0].id,
        },
        {
          episodeNumber: 1,
          fileRole: 'subtitle',
          index: 1,
          language: 'zh-CN',
          unitId: task.units[0].id,
        },
        {
          episodeNumber: 2,
          fileRole: 'video',
          index: 2,
          unitId: task.units[0].id,
        },
        {
          episodeNumber: 2,
          fileRole: 'subtitle',
          index: 3,
          language: 'zh-CN',
          unitId: task.units[0].id,
        },
      ],
      selectedFileIndices: [0, 1, 2, 3],
    });

    expect(task.units[0]).toMatchObject({
      expectedEpisodeNumbers: [1, 2],
      subtitleContract: {
        expectedEpisodeNumbers: [1, 2],
        mappings: [
          { episodeNumber: 1, relativePath: 'S01E01.zh-CN.ass' },
          { episodeNumber: 2, relativePath: 'S01E02.zh-CN.ass' },
        ],
        releaseGroup: 'Fixture-Group',
        sourceId: source.id,
      },
    });
  });
});

import { HttpException } from '@nestjs/common';
import { MediaGovernanceService } from '../../../src/modules/admin/media-governance/media-governance.service';

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
      closed: 0,
      downloading: 0,
      governing: 0,
      mixedSubtitleSeasonCount: 0,
      stagingResidualCount: 0,
      total: 1,
    });
    expect(task.semanticProjection).toEqual({
      currentActionLabel: '等待补充来源',
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

  it('rejects an unknown detail identity', () => {
    expect(() => service.detail('media-task-missing')).toThrow(HttpException);
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
        expectedEpisodeNumbers: [1, 2],
        expectedRevision: 3,
        mappings: [
          { episodeNumber: 1, relativePath: 'S01/01.zh-Hans.ass' },
          { episodeNumber: 2, relativePath: 'S01/02.zh-Hans.ass' },
        ],
        releaseGroup: 'DBD-Raws',
        sourceId: supplemental.id,
      });
      await service.inspectSource(task.id, primary.id, { expectedRevision: 4 });
      await service.probeRuntimeSource(task.id, primary.id, {
        expectedRevision: 5,
      });
      await service.inspectSource(task.id, supplemental.id, {
        expectedRevision: 6,
      });
      await service.probeRuntimeSource(task.id, supplemental.id, {
        expectedRevision: 7,
      });
      await service.startDownload(task.id, { expectedRevision: 8 });
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

  it('rejects a second primary download owner', async () => {
    const task = await service.create({
      mediaType: 'movie',
      titleHint: '唯一下载 owner 测试',
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
        contentKind: 'burned_in_subtitle_media',
        expectedRevision: 2,
        magnetUri:
          'magnet:?xt=urn:btih:fedcba9876543210fedcba9876543210fedcba98',
        seasonNumbers: [],
        sourceRole: 'primary_media',
      }),
    ).rejects.toMatchObject({
      response: { msg: '同一任务只能有一个主媒体下载 owner' },
      status: 409,
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
});

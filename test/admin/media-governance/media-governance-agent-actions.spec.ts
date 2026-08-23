import { MediaGovernanceService } from '../../../src/modules/admin/media-governance/application/media-governance.service';

describe('MediaGovernanceService Agent typed actions', () => {
  it('auto-selects only unambiguous root episodes and the requested subtitle language', async () => {
    const service = new MediaGovernanceService();
    const task = await service.create({
      mediaType: 'tv',
      seasonNumbers: ['S01'],
      titleHint: '自动选择测试',
    });
    const source = await service.addMagnetSource(task.id, {
      contentKind: 'bundled_sidecar_media',
      expectedRevision: task.revision,
      magnetUri: `magnet:?xt=urn:btih:${'a'.repeat(40)}&dn=agent-selection`,
      releaseGroup: 'DBD-Raws',
      seasonNumbers: ['S01'],
      sourceRole: 'primary_media',
    });
    source.manifestState = 'inspected';
    source.manifest = [
      manifest(0, '[DBD-Raws][作品][001][1080P].mkv', 1000),
      manifest(1, '[DBD-Raws][作品][001][1080P].sc.ass', 10),
      manifest(2, '[DBD-Raws][作品][001][1080P].tc.ass', 10),
      manifest(3, 'PV/[DBD-Raws][作品][PV][01][1080P].mkv', 100),
      manifest(4, '[DBD-Raws][作品][002][1080P].mkv', 1100),
      manifest(5, '[DBD-Raws][作品][002][1080P].sc.ass', 11),
      manifest(6, 'menu/[DBD-Raws][作品][01][1080P].mkv', 20),
    ];
    source.manifestSha256 = 'b'.repeat(64);
    const apply = Reflect.get(service, 'applyAgentAutomaticSelection').bind(
      service,
    ) as (
      currentTask: typeof task,
      value: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;

    await expect(
      apply(task, { sourceId: source.id, subtitleLanguage: 'zh-CN' }),
    ).resolves.toMatchObject({
      accepted: true,
      action: 'media.selection.auto',
      selectedFileCount: 4,
      subtitleCount: 2,
      videoCount: 2,
    });
    expect(source.selectedFileIndices).toEqual([0, 1, 4, 5]);
    expect(source.selectedFileMappings).toEqual([
      expect.objectContaining({
        episodeNumber: 1,
        fileRole: 'video',
        index: 0,
      }),
      expect.objectContaining({
        episodeNumber: 1,
        fileRole: 'subtitle',
        index: 1,
        language: 'zh-CN',
      }),
      expect.objectContaining({
        episodeNumber: 2,
        fileRole: 'video',
        index: 4,
      }),
      expect.objectContaining({
        episodeNumber: 2,
        fileRole: 'subtitle',
        index: 5,
        language: 'zh-CN',
      }),
    ]);
  });

  it('projects stage actions instead of advertising impossible plan submission', async () => {
    const service = new MediaGovernanceService();
    const task = await service.create({
      mediaType: 'movie',
      titleHint: '能力投影测试',
    });
    const available = Reflect.get(service, 'agentAvailableActions').bind(
      service,
    ) as (currentTask: typeof task) => string[];

    expect(available(task)).toEqual(
      expect.arrayContaining([
        'media.identity.confirm',
        'media.source.add-magnet',
      ]),
    );
    expect(available(task)).not.toContain('plan.submit.sealed');
  });

  it('keeps a selected Bangumi catalog identity when sealing TMDB metadata identity', async () => {
    const service = new MediaGovernanceService();
    const task = await service.create({
      mediaType: 'tv',
      providerRef: { provider: 'bangumi', providerId: '302286' },
      releaseYear: 2022,
      seasonNumbers: ['S01'],
      titleHint: '死神 千年血战篇',
    });
    const amendmentPlanSha256 = 'a'.repeat(64);
    task.metadataStatus = 'requires-agent';
    task.runState = 'blocked';
    task.stage = 'metadata';
    task.sealedPlan = {
      agentPendingAmendment: {
        identity: {
          provider: 'tmdb',
          providerId: '30984',
          releaseYear: 2004,
        },
        planSha256: amendmentPlanSha256,
        providerTitle: '死神',
        replayKey: `${task.id}-operator-r${task.revision}`,
        summary: '仅密封 TMDB 二级元数据身份',
        taskRevision: task.revision,
      },
      catalogIdentity: {
        mediaType: 'tv',
        providerRef: { provider: 'bangumi', providerId: '302286' },
        releaseYear: 2022,
        title: '死神 千年血战篇',
      },
      identity: {
        mediaType: 'tv',
        providerRef: { provider: 'bangumi', providerId: '302286' },
        releaseYear: 2022,
        title: '死神 千年血战篇',
      },
      manifests: { local: { forward: [], inverse: [] } },
      metadataIdentity: null,
      schemaVersion: '1.2.0',
      sealed: true,
    };
    task.sealedPlanSha256 = 'b'.repeat(64);
    const finalize = Reflect.get(
      service,
      'finalizeAgentIdentityAmendment',
    ).bind(service) as (currentTask: typeof task, planSha256: string) => void;

    finalize(task, amendmentPlanSha256);

    expect(task).toMatchObject({
      metadataIdentity: {
        provider: 'tmdb',
        providerId: '30984',
        providerTitle: '死神',
        releaseYear: 2004,
      },
      metadataStatus: 'pending',
      providerRef: { provider: 'bangumi', providerId: '302286' },
      releaseYear: 2022,
      runState: 'succeeded',
      stage: 'metadata',
    });
    expect(task.identityPreview).toMatchObject({
      providerLabel: 'Bangumi · 302286',
      releaseYearLabel: '2022 年',
      statusLabel: '元数据身份已验证',
    });
    expect(task.sealedPlan).toMatchObject({
      catalogIdentity: {
        providerRef: { provider: 'bangumi', providerId: '302286' },
        releaseYear: 2022,
      },
      identity: {
        providerRef: { provider: 'bangumi', providerId: '302286' },
        releaseYear: 2022,
      },
      metadataIdentity: {
        provider: 'tmdb',
        providerId: '30984',
        providerTitle: '死神',
        releaseYear: 2004,
      },
    });
    expect(task.sealedPlan).not.toHaveProperty('transition');
  });

  it('auto-selects root episode numbers delimited by release punctuation', async () => {
    const service = new MediaGovernanceService();
    const task = await service.create({
      mediaType: 'tv',
      seasonNumbers: ['S01'],
      titleHint: '标点集号测试',
    });
    const source = await service.addMagnetSource(task.id, {
      contentKind: 'embedded_subtitle_media',
      expectedRevision: task.revision,
      magnetUri: `magnet:?xt=urn:btih:${'c'.repeat(40)}&dn=agent-selection`,
      releaseGroup: 'Erai-raws',
      seasonNumbers: ['S01'],
      sourceRole: 'primary_media',
    });
    source.manifestState = 'inspected';
    source.manifest = [
      manifest(
        0,
        '[Erai-raws] Bleach - 001 [720p DSNP WEB-DL AVC AAC][MultiSub].mkv',
        1000,
      ),
      manifest(
        1,
        '[Erai-raws] Bleach - 002 [720p DSNP WEB-DL AVC AAC][MultiSub].mkv',
        1100,
      ),
      manifest(2, '[Erai-raws] Bleach - 003 - 004 [720p].mkv', 1200),
    ];
    source.manifestSha256 = 'd'.repeat(64);
    const apply = Reflect.get(service, 'applyAgentAutomaticSelection').bind(
      service,
    ) as (
      currentTask: typeof task,
      value: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;

    await expect(
      apply(task, { sourceId: source.id, subtitleLanguage: 'zh-CN' }),
    ).resolves.toMatchObject({
      selectedFileCount: 2,
      subtitleCount: 0,
      videoCount: 2,
    });
    expect(source.selectedFileMappings).toEqual([
      expect.objectContaining({ episodeNumber: 1, index: 0 }),
      expect.objectContaining({ episodeNumber: 2, index: 1 }),
    ]);
  });

  it('auto-selects one dominant movie feature while excluding tiny promo videos', async () => {
    const service = new MediaGovernanceService();
    const task = await service.create({
      mediaType: 'movie',
      titleHint: '电影正片测试',
    });
    const source = await service.addMagnetSource(task.id, {
      contentKind: 'embedded_subtitle_media',
      expectedRevision: task.revision,
      magnetUri: `magnet:?xt=urn:btih:${'e'.repeat(40)}&dn=movie-selection`,
      releaseGroup: 'BATWEB',
      seasonNumbers: [],
      sourceRole: 'primary_media',
    });
    source.manifestState = 'inspected';
    source.manifest = [
      manifest(0, 'The.Wind.Will.Carry.Us.1999.mkv', 4 * 1024 ** 3),
      manifest(1, '更多影视.mp4', 300 * 1024),
      manifest(2, '更多影视.mkv', 700 * 1024),
    ];
    source.manifestSha256 = 'f'.repeat(64);
    const apply = Reflect.get(service, 'applyAgentAutomaticSelection').bind(
      service,
    ) as (
      currentTask: typeof task,
      value: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;

    await expect(
      apply(task, { sourceId: source.id, subtitleLanguage: 'zh-CN' }),
    ).resolves.toMatchObject({
      selectedFileCount: 1,
      videoCount: 1,
    });
    expect(source.selectedFileIndices).toEqual([0]);

    source.manifest = [
      manifest(0, 'The.Wind.Will.Carry.Us.1999.mkv', 4 * 1024 ** 3),
      manifest(1, 'The.Wind.Will.Carry.Us.1999.alt.mkv', 2 * 1024 ** 3),
    ];
    await expect(
      apply(task, { sourceId: source.id, subtitleLanguage: 'zh-CN' }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

/**
 * 创建用于 Agent 自动选择测试的安全来源文件条目。
 * @param index - 来源清单索引。
 * @param relativePath - 来源根内相对路径。
 * @param sizeBytes - 文件字节数。
 * @returns 可直接写入模拟 manifest 的条目。
 */
function manifest(index: number, relativePath: string, sizeBytes: number) {
  return { executable: false, index, relativePath, sizeBytes };
}

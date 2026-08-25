import type { DataSource } from 'typeorm';
import { MediaGovernanceCatalogService } from '../../../src/modules/admin/media-governance/application/media-governance-catalog.service';
import { MediaGovernanceEventStreamService } from '../../../src/modules/admin/media-governance/application/media-governance-event-stream.service';
import type {
  MediaGovernanceService,
  MediaGovernanceTask,
} from '../../../src/modules/admin/media-governance/application/media-governance.service';
import {
  MediaGovernanceEpisodeEntity,
  MediaGovernanceSeasonEntity,
  MediaGovernanceSeriesEntity,
  MediaGovernanceSeriesExternalRefEntity,
  MediaGovernanceTaskEpisodeBindingEntity,
  MediaGovernanceWorkEntity,
  MediaGovernanceWorkExternalRefEntity,
} from '../../../src/modules/admin/media-governance/infrastructure/persistence/media-governance-catalog.entities';

type EntityToken = abstract new (...args: never[]) => unknown;

/**
 * 创建一个具备已验证双资料身份、已检查清单和完整视频映射的自动归类任务夹具。
 *
 * @param overrides - 需要覆盖到默认任务顶层的测试字段。
 * @returns 可进入自动目录同步的 TV Task 快照。
 */
function automaticTask(
  overrides: Partial<MediaGovernanceTask> = {},
): MediaGovernanceTask {
  return {
    id: 'media-task-auto-0001',
    mediaType: 'tv',
    metadataIdentity: {
      provider: 'tmdb',
      providerId: '90001',
      providerTitle: '自动归类作品',
      releaseYear: 2026,
    },
    metadataStatus: 'verified',
    providerRef: { provider: 'bangumi', providerId: '80001' },
    releaseYear: 2026,
    runState: 'succeeded',
    sources: [
      {
        manifestState: 'inspected',
        selectedFileMappings: [
          {
            episodeNumber: 1,
            fileRole: 'video',
            unitId: 'media-unit-auto-s01',
          },
          {
            episodeNumber: 2,
            fileRole: 'video',
            unitId: 'media-unit-auto-s01',
          },
        ],
        sourceRole: 'primary_media',
      },
    ],
    stage: 'metadata',
    titleHint: '自动归类作品',
    units: [
      {
        expectedEpisodeNumbers: [1, 2],
        id: 'media-unit-auto-s01',
        seasonNumber: 'S01',
        unitKind: 'season',
      },
    ],
    ...overrides,
  } as unknown as MediaGovernanceTask;
}

/**
 * 只实现目录分类读取所需 Repository.find，供自动归类测试隔离事务写入。
 *
 * @param rows - 按 Entity 类索引的只读目录行。
 * @returns 可供 CatalogService 读取分类作用域的 DataSource 替身。
 */
function automaticDataSource(rows: Map<EntityToken, unknown[]>): DataSource {
  return {
    getRepository: jest.fn((entity: EntityToken) => ({
      find: jest.fn().mockResolvedValue(rows.get(entity) ?? []),
    })),
  } as unknown as DataSource;
}

describe('MediaGovernanceCatalogService historical classification', () => {
  it('classifies exact identities without mutating tasks and remains idempotent', async () => {
    const bleachSeries = {
      canonicalProvider: 'tmdb',
      canonicalProviderId: '30984',
      id: 'media-series-bleach',
      mediaType: 'tv',
      primaryWorkId: 'media-work-bleach',
      releaseYear: 2004,
      title: '死神',
    } as MediaGovernanceSeriesEntity;
    const conflictingSeries = {
      canonicalProvider: 'bangumi',
      canonicalProviderId: '302286',
      id: 'media-series-conflict',
      mediaType: 'tv',
      primaryWorkId: 'media-work-conflict',
      releaseYear: 2022,
      title: '冲突系列',
    } as MediaGovernanceSeriesEntity;
    const jjkSeries = {
      canonicalProvider: 'tmdb',
      canonicalProviderId: '95479',
      id: 'media-series-jjk',
      mediaType: 'tv',
      primaryWorkId: 'media-work-jjk',
      releaseYear: 2020,
      title: '咒术回战',
    } as MediaGovernanceSeriesEntity;
    const bleachSeason = {
      episodeCount: 50,
      id: 'media-season-bleach-02',
      seasonNumber: 2,
      seriesId: bleachSeries.id,
      title: '千年血战篇',
      workId: 'media-work-bleach',
    } as MediaGovernanceSeasonEntity;
    const jjkSeason = {
      episodeCount: 23,
      episodeStart: 25,
      id: 'media-season-jjk-02',
      seasonNumber: 2,
      seriesId: jjkSeries.id,
      title: '怀玉·玉折 / 涩谷事变',
      workId: 'media-work-jjk',
    } as MediaGovernanceSeasonEntity;
    const episode14 = {
      episodeNumber: 14,
      id: 'media-episode-bleach-02-14',
      seasonId: bleachSeason.id,
      seasonNumber: 2,
      seriesId: bleachSeries.id,
      status: 'completed',
    } as MediaGovernanceEpisodeEntity;
    const episode15 = {
      episodeNumber: 15,
      id: 'media-episode-bleach-02-15',
      seasonId: bleachSeason.id,
      seasonNumber: 2,
      seriesId: bleachSeries.id,
      status: 'known',
    } as MediaGovernanceEpisodeEntity;
    const jjkEpisode25 = {
      episodeNumber: 25,
      id: 'media-episode-jjk-02-25',
      seasonId: jjkSeason.id,
      seasonNumber: 2,
      seriesId: jjkSeries.id,
      status: 'completed',
    } as MediaGovernanceEpisodeEntity;
    const jjkEpisode47 = {
      episodeNumber: 47,
      id: 'media-episode-jjk-02-47',
      seasonId: jjkSeason.id,
      seasonNumber: 2,
      seriesId: jjkSeries.id,
      status: 'completed',
    } as MediaGovernanceEpisodeEntity;
    const runtimeTasks = [
      {
        id: 'media-task-classifiable',
        mediaType: 'tv',
        metadataIdentity: {
          provider: 'tmdb',
          providerId: '30984',
          releaseYear: 2004,
        },
        metadataStatus: 'verified',
        sources: [
          {
            selectedFileMappings: [
              { episodeNumber: 14, unitId: 'unit-classifiable' },
              { episodeNumber: 15, unitId: 'unit-classifiable' },
            ],
          },
        ],
        titleHint: '死神 千年血战篇 14-15',
        units: [
          {
            expectedEpisodeNumbers: [14, 15],
            id: 'unit-classifiable',
            seasonNumber: 'S02',
            unitKind: 'season',
          },
        ],
      },
      {
        id: 'media-task-global-episode-numbering',
        mediaType: 'tv',
        metadataIdentity: {
          provider: 'tmdb',
          providerId: '95479',
          releaseYear: 2020,
        },
        metadataStatus: 'verified',
        sources: [
          {
            selectedFileMappings: [
              { episodeNumber: 25, unitId: 'unit-global-numbering' },
              { episodeNumber: 47, unitId: 'unit-global-numbering' },
            ],
          },
        ],
        titleHint: '咒术回战 第二季',
        units: [
          {
            expectedEpisodeNumbers: [25, 47],
            id: 'unit-global-numbering',
            seasonNumber: 'S02',
            unitKind: 'season',
          },
        ],
      },
      {
        id: 'media-task-movie',
        mediaType: 'movie',
        metadataIdentity: {
          provider: 'tmdb',
          providerId: '43423',
          releaseYear: 1999,
        },
        metadataStatus: 'verified',
        sources: [],
        titleHint: '随风而逝',
        units: [],
      },
      {
        id: 'media-task-missing-evidence',
        mediaType: 'tv',
        metadataIdentity: {
          provider: 'tmdb',
          providerId: '30984',
          releaseYear: 2004,
        },
        metadataStatus: 'verified',
        sources: [],
        titleHint: '死神 缺集号',
        units: [
          {
            expectedEpisodeNumbers: [],
            id: 'unit-missing-evidence',
            seasonNumber: 'S02',
            unitKind: 'season',
          },
        ],
      },
      {
        id: 'media-task-identity-conflict',
        mediaType: 'tv',
        metadataIdentity: {
          provider: 'bangumi',
          providerId: '302286',
          releaseYear: 2022,
        },
        metadataStatus: 'verified',
        sources: [],
        titleHint: '身份冲突',
        units: [
          {
            expectedEpisodeNumbers: [1],
            id: 'unit-conflict',
            seasonNumber: 'S02',
            unitKind: 'season',
          },
        ],
      },
      {
        id: 'media-task-already-bound',
        mediaType: 'tv',
        metadataIdentity: null,
        metadataStatus: 'verified',
        sources: [],
        titleHint: '既有绑定',
        units: [],
      },
      {
        id: 'media-task-unverified-identity',
        mediaType: 'tv',
        metadataIdentity: {
          provider: 'tmdb',
          providerId: '30984',
          releaseYear: 2004,
        },
        metadataStatus: 'requires-agent',
        sources: [],
        titleHint: '身份尚未核实',
        units: [
          {
            expectedEpisodeNumbers: [14],
            id: 'unit-unverified-identity',
            seasonNumber: 'S02',
            unitKind: 'season',
          },
        ],
      },
    ] as unknown as MediaGovernanceTask[];
    const taskSnapshot = structuredClone(runtimeTasks);
    const repositoryRows = new Map<EntityToken, unknown[]>([
      [
        MediaGovernanceSeriesEntity,
        [bleachSeries, conflictingSeries, jjkSeries],
      ],
      [
        MediaGovernanceSeriesExternalRefEntity,
        [
          {
            id: 'media-ref-bleach-bangumi',
            provider: 'bangumi',
            providerId: '302286',
            seriesId: bleachSeries.id,
          } as MediaGovernanceSeriesExternalRefEntity,
        ],
      ],
      [MediaGovernanceSeasonEntity, [bleachSeason, jjkSeason]],
      [
        MediaGovernanceEpisodeEntity,
        [episode14, episode15, jjkEpisode25, jjkEpisode47],
      ],
      [
        MediaGovernanceTaskEpisodeBindingEntity,
        [
          {
            episodeId: episode14.id,
            id: 'media-binding-existing',
            seasonId: bleachSeason.id,
            seriesId: bleachSeries.id,
            taskId: 'media-task-already-bound',
          } as MediaGovernanceTaskEpisodeBindingEntity,
        ],
      ],
    ]);
    const writeMocks: jest.Mock[] = [];
    const repositories = new Map<EntityToken, Record<string, jest.Mock>>();
    for (const [entity, rows] of repositoryRows) {
      const save = jest.fn();
      const remove = jest.fn();
      const update = jest.fn();
      writeMocks.push(save, remove, update);
      repositories.set(entity, {
        delete: remove,
        find: jest.fn().mockResolvedValue(rows),
        save,
        update,
      });
    }
    const dataSource = {
      getRepository: jest.fn((entity: EntityToken) => repositories.get(entity)),
    } as unknown as DataSource;
    const mediaTasks = {
      page: jest.fn().mockReturnValue({
        items: runtimeTasks,
        total: runtimeTasks.length,
      }),
    } as unknown as MediaGovernanceService;
    const service = new MediaGovernanceCatalogService(dataSource, mediaTasks);

    const first = await service.historyClassification();
    const second = await service.historyClassification();

    expect(second).toEqual(first);
    expect(first.summary).toEqual({
      classifiable: 2,
      classified: 1,
      notApplicable: 0,
      pending: 4,
      total: 7,
    });
    expect(
      first.items.find((item) => item.taskId === 'media-task-classifiable'),
    ).toMatchObject({
      reasonCode: 'catalog-binding-missing',
      status: 'classifiable',
      target: {
        canonicalProvider: 'tmdb',
        canonicalProviderId: '30984',
        matchRole: 'canonical',
        seasons: [
          {
            canonicalEpisodeCount: 50,
            canonicalEpisodeStart: 1,
            episodeCount: 2,
            episodeRanges: [{ end: 15, start: 14 }],
            missingBindingCount: 2,
            seasonNumber: 2,
          },
        ],
        seriesId: bleachSeries.id,
      },
    });
    expect(
      first.items.find(
        (item) => item.taskId === 'media-task-global-episode-numbering',
      ),
    ).toMatchObject({
      reasonCode: 'catalog-binding-missing',
      status: 'classifiable',
      target: {
        canonicalProviderId: '95479',
        seasons: [
          {
            canonicalEpisodeCount: 23,
            canonicalEpisodeStart: 25,
            episodeCount: 2,
            episodeRanges: [
              { end: 25, start: 25 },
              { end: 47, start: 47 },
            ],
            seasonNumber: 2,
          },
        ],
      },
    });
    expect(
      first.items.find(
        (item) => item.taskId === 'media-task-identity-conflict',
      ),
    ).toMatchObject({
      reasonCode: 'canonical-identity-conflict',
      status: 'pending',
    });
    expect(
      first.items.find((item) => item.taskId === 'media-task-missing-evidence'),
    ).toMatchObject({
      reasonCode: 'episode-evidence-missing',
      status: 'pending',
    });
    expect(
      first.items.find((item) => item.taskId === 'media-task-movie'),
    ).toMatchObject({
      reasonCode: 'pending-series-membership',
      status: 'pending',
    });
    expect(
      first.items.find((item) => item.taskId === 'media-task-already-bound'),
    ).toMatchObject({
      reasonCode: 'catalog-binding-existing',
      status: 'classified',
    });
    expect(
      first.items.find(
        (item) => item.taskId === 'media-task-unverified-identity',
      ),
    ).toMatchObject({
      reasonCode: 'metadata-identity-unverified',
      status: 'pending',
    });
    expect(runtimeTasks).toEqual(taskSnapshot);
    for (const write of writeMocks) expect(write).not.toHaveBeenCalled();
  });
});

describe('MediaGovernanceCatalogService automatic synchronization', () => {
  it('never creates a Series from a verified Task without an existing Work binding', async () => {
    const task = automaticTask();
    const mediaTasks = {
      detail: jest.fn().mockReturnValue(task),
      page: jest.fn().mockReturnValue({ items: [task], total: 1 }),
    } as unknown as MediaGovernanceService;
    const service = new MediaGovernanceCatalogService(
      automaticDataSource(new Map()),
      mediaTasks,
    );
    const reconcile = jest.spyOn(service, 'reconcile');

    await expect(
      service.synchronizeVerifiedTask(task.id),
    ).resolves.toMatchObject({
      changed: false,
      reasonCode: 'catalog-work-binding-required',
      status: 'pending',
    });
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('does not infer a Work from a same-identity Series without explicit binding', async () => {
    const task = automaticTask({
      providerRef: null,
    });
    const series = {
      canonicalProvider: 'tmdb',
      canonicalProviderId: '90001',
      id: 'media-series-existing-0001',
      mediaType: 'tv',
      originalTitle: null,
      releaseYear: 2025,
      revision: 3,
      status: 'active',
      title: '既有自动归类作品',
    } as MediaGovernanceSeriesEntity;
    const season = {
      episodeCount: 12,
      episodeStart: 1,
      id: 'media-season-existing-s01',
      releaseYear: 2025,
      seasonNumber: 1,
      seriesId: series.id,
      title: '第 1 季',
    } as MediaGovernanceSeasonEntity;
    const rows = new Map<EntityToken, unknown[]>([
      [MediaGovernanceSeriesEntity, [series]],
      [MediaGovernanceSeriesExternalRefEntity, []],
      [MediaGovernanceSeasonEntity, [season]],
      [MediaGovernanceEpisodeEntity, []],
      [MediaGovernanceTaskEpisodeBindingEntity, []],
    ]);
    const mediaTasks = {
      detail: jest.fn().mockReturnValue(task),
      page: jest.fn().mockReturnValue({ items: [task], total: 1 }),
    } as unknown as MediaGovernanceService;
    const service = new MediaGovernanceCatalogService(
      automaticDataSource(rows),
      mediaTasks,
    );
    const reconcile = jest.spyOn(service, 'reconcile');

    await expect(
      service.synchronizeVerifiedTask(task.id),
    ).resolves.toMatchObject({
      changed: false,
      reasonCode: 'catalog-work-binding-required',
      status: 'pending',
    });
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('does not inspect cross-Series candidates when the Task lacks a Work binding', async () => {
    const task = automaticTask();
    const catalogSeries = {
      canonicalProvider: 'bangumi',
      canonicalProviderId: '80001',
      id: 'media-series-catalog-conflict',
    } as MediaGovernanceSeriesEntity;
    const metadataSeries = {
      canonicalProvider: 'tmdb',
      canonicalProviderId: '90001',
      id: 'media-series-metadata-conflict',
    } as MediaGovernanceSeriesEntity;
    const rows = new Map<EntityToken, unknown[]>([
      [MediaGovernanceSeriesEntity, [catalogSeries, metadataSeries]],
      [MediaGovernanceSeriesExternalRefEntity, []],
      [MediaGovernanceSeasonEntity, []],
      [MediaGovernanceEpisodeEntity, []],
      [MediaGovernanceTaskEpisodeBindingEntity, []],
    ]);
    const mediaTasks = {
      detail: jest.fn().mockReturnValue(task),
      page: jest.fn().mockReturnValue({ items: [task], total: 1 }),
    } as unknown as MediaGovernanceService;
    const service = new MediaGovernanceCatalogService(
      automaticDataSource(rows),
      mediaTasks,
    );
    const reconcile = jest.spyOn(service, 'reconcile');

    await expect(
      service.synchronizeVerifiedTask(task.id),
    ).resolves.toMatchObject({
      changed: false,
      reasonCode: 'catalog-work-binding-required',
      status: 'pending',
    });
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('queues verified full task events but ignores progress patches', async () => {
    const task = automaticTask();
    const eventStream = new MediaGovernanceEventStreamService({
      heartbeatMs: 60_000,
    });
    const mediaTasks = {
      detail: jest.fn().mockReturnValue(task),
      page: jest.fn().mockReturnValue({ items: [], total: 0 }),
    } as unknown as MediaGovernanceService;
    const service = new MediaGovernanceCatalogService(
      automaticDataSource(new Map()),
      mediaTasks,
      eventStream,
    );
    const synchronize = jest
      .spyOn(service, 'synchronizeVerifiedTask')
      .mockResolvedValue({
        changed: false,
        reasonCode: 'fixture',
        reasonLabel: 'fixture',
        seriesId: null,
        status: 'pending',
        taskId: task.id,
      });
    service.onModuleInit();
    eventStream.publishTaskChanged({
      changeType: 'state-updated',
      patchMode: 'progress',
      revision: 1,
      runId: 'media-run-auto-0001',
      runSequence: 1,
      summary: {} as never,
      task: { id: task.id, metadataStatus: 'verified', revision: 1 },
      taskId: task.id,
      updatedAt: '2026-08-24T00:00:00.000Z',
    });
    eventStream.publishTaskChanged({
      changeType: 'state-updated',
      patchMode: 'full',
      revision: 2,
      runId: null,
      runSequence: null,
      summary: {} as never,
      task: { id: task.id, metadataStatus: 'verified', revision: 2 },
      taskId: task.id,
      updatedAt: '2026-08-24T00:00:01.000Z',
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(synchronize).toHaveBeenCalledTimes(1);
    expect(synchronize).toHaveBeenCalledWith(task.id);
    service.onModuleDestroy();
  });

  it('compensates verified tasks after every application bootstrap', async () => {
    const verified = automaticTask();
    const pending = automaticTask({
      id: 'media-task-pending-0001',
      metadataStatus: 'pending',
    });
    const mediaTasks = {
      page: jest.fn().mockReturnValue({
        items: [pending, verified],
        total: 2,
      }),
    } as unknown as MediaGovernanceService;
    const service = new MediaGovernanceCatalogService(
      automaticDataSource(new Map()),
      mediaTasks,
    );
    const synchronize = jest
      .spyOn(service, 'synchronizeVerifiedTask')
      .mockResolvedValue({
        changed: false,
        reasonCode: 'fixture',
        reasonLabel: 'fixture',
        seriesId: null,
        status: 'pending',
        taskId: verified.id,
      });

    service.onApplicationBootstrap();
    await Promise.resolve();
    await Promise.resolve();

    expect(synchronize).toHaveBeenCalledTimes(1);
    expect(synchronize).toHaveBeenCalledWith(verified.id);
  });

  it('atomically creates a Series and one verified primary Work', async () => {
    const savedSeries: unknown[] = [];
    const savedWorks: unknown[] = [];
    const savedWorkRefs: unknown[] = [];
    const savedSeriesRefs: unknown[] = [];
    const repositories = new Map<EntityToken, Record<string, jest.Mock>>([
      [
        MediaGovernanceSeriesEntity,
        {
          create: jest.fn((value) => value),
          findOneBy: jest.fn().mockResolvedValue(null),
          save: jest.fn(async (value) => {
            savedSeries.push(value);
            return value;
          }),
        },
      ],
      [
        MediaGovernanceWorkEntity,
        {
          create: jest.fn((value) => value),
          findOneBy: jest.fn().mockResolvedValue(null),
          save: jest.fn(async (value) => {
            savedWorks.push(value);
            return value;
          }),
        },
      ],
      [
        MediaGovernanceWorkExternalRefEntity,
        {
          create: jest.fn((value) => value),
          findOneBy: jest.fn().mockResolvedValue(null),
          save: jest.fn(async (value) => {
            savedWorkRefs.push(value);
            return value;
          }),
        },
      ],
      [
        MediaGovernanceSeriesExternalRefEntity,
        {
          create: jest.fn((value) => value),
          findOneBy: jest.fn().mockResolvedValue(null),
          save: jest.fn(async (value) => {
            savedSeriesRefs.push(value);
            return value;
          }),
        },
      ],
    ]);
    const manager = {
      getRepository: jest.fn((entity: EntityToken) => repositories.get(entity)),
    };
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
    } as unknown as DataSource;
    const service = new MediaGovernanceCatalogService(
      dataSource,
      {} as MediaGovernanceService,
    );
    Object.assign(service, {
      detail: jest.fn().mockResolvedValue({
        series: { id: 'media-series-jjk' },
        works: [{ id: 'media-work-jjk-tv' }],
      }),
      publishCatalogChanged: jest.fn().mockResolvedValue(undefined),
      verifyWorkIdentity: jest.fn().mockResolvedValue({
        candidateId: 'tmdb:95479',
        episodeCount: null,
        originalTitle: null,
        posterUrl: null,
        provider: 'tmdb',
        providerId: '95479',
        releaseYear: 2020,
        title: '咒术回战',
      }),
    });

    await expect(
      service.createSeries({
        identity: {
          provider: 'tmdb',
          providerId: '95479',
          releaseYear: 2020,
        },
        workType: 'tv',
      }),
    ).resolves.toMatchObject({ series: { id: 'media-series-jjk' } });
    expect(savedSeries).toHaveLength(1);
    expect(savedWorks).toEqual([
      expect.objectContaining({
        canonicalNamespace: 'tv',
        canonicalProviderId: '95479',
        workType: 'tv',
      }),
    ]);
    expect(savedWorkRefs).toHaveLength(1);
    expect(savedSeriesRefs).toHaveLength(0);
  });

  it('requires the Work identity when two Works can both contain S01', async () => {
    const findSeason = jest.fn().mockResolvedValue({
      id: 'media-season-work-b-01',
      seasonNumber: 1,
      seriesId: 'media-series-shared',
      workId: 'media-work-b',
    });
    const dataSource = {
      getRepository: jest.fn((entity: EntityToken) => {
        if (entity === MediaGovernanceSeasonEntity) {
          return { findOneBy: findSeason };
        }
        if (entity === MediaGovernanceEpisodeEntity) {
          return { findAndCount: jest.fn().mockResolvedValue([[], 0]) };
        }
        if (entity === MediaGovernanceTaskEpisodeBindingEntity) {
          return { findBy: jest.fn().mockResolvedValue([]) };
        }
        throw new Error(`unexpected repository ${String(entity)}`);
      }),
    } as unknown as DataSource;
    const service = new MediaGovernanceCatalogService(
      dataSource,
      {} as MediaGovernanceService,
    );

    await expect(
      service.episodePage('media-series-shared', 'media-work-b', 1, {
        pageNo: 1,
        pageSize: 20,
      }),
    ).resolves.toEqual({ items: [], total: 0 });
    expect(findSeason).toHaveBeenCalledWith({
      seasonNumber: 1,
      seriesId: 'media-series-shared',
      workId: 'media-work-b',
    });
  });

  it('binds an exact legacy movie Task when the confirmed Work is theatrical', async () => {
    const movieTask = automaticTask({
      id: 'media-task-jjk-zero-movie',
      mediaType: 'movie',
      metadataIdentity: null,
      providerRef: { provider: 'tmdb', providerId: '810693' },
      workId: null,
    });
    const tvTask = automaticTask({
      id: 'media-task-jjk-zero-tv',
      providerRef: { provider: 'tmdb', providerId: '810693' },
      workId: null,
    });
    const bindWorkContext = jest.fn().mockResolvedValue(movieTask);
    const mediaTasks = {
      bindWorkContext,
      page: jest.fn().mockReturnValue({ items: [movieTask, tvTask], total: 2 }),
    } as unknown as MediaGovernanceService;
    const service = new MediaGovernanceCatalogService(
      {} as DataSource,
      mediaTasks,
    );
    const internal = service as unknown as {
      bindExactLegacyTasksToWork: (
        work: MediaGovernanceWorkEntity,
      ) => Promise<void>;
    };

    await internal.bindExactLegacyTasksToWork({
      canonicalProvider: 'tmdb',
      canonicalProviderId: '810693',
      id: 'media-work-jjk-zero',
      seriesId: 'media-series-jjk',
      workType: 'theatrical',
    } as MediaGovernanceWorkEntity);

    expect(bindWorkContext).toHaveBeenCalledTimes(1);
    expect(bindWorkContext).toHaveBeenCalledWith(movieTask.id, {
      operationKind: 'legacy-pipeline',
      seriesId: 'media-series-jjk',
      workId: 'media-work-jjk-zero',
    });
  });

  it('resumes exact legacy binding when the same Series Work already exists', async () => {
    const existingWork = {
      canonicalNamespace: 'movie',
      canonicalProvider: 'tmdb',
      canonicalProviderId: '810693',
      id: 'media-work-jjk-zero',
      seriesId: 'media-series-jjk',
      workType: 'theatrical',
    } as MediaGovernanceWorkEntity;
    const existingReference = {
      provider: 'tmdb',
      providerId: '810693',
      providerNamespace: 'movie',
      referenceRole: 'canonical',
      workId: existingWork.id,
    };
    const movieTask = automaticTask({
      id: 'media-task-jjk-zero-movie',
      mediaType: 'movie',
      providerRef: { provider: 'tmdb', providerId: '810693' },
      workId: null,
    });
    const bindWorkContext = jest.fn().mockResolvedValue(movieTask);
    const mediaTasks = {
      bindWorkContext,
      page: jest.fn().mockReturnValue({ items: [movieTask], total: 1 }),
    } as unknown as MediaGovernanceService;
    const referenceSave = jest.fn().mockResolvedValue(existingReference);
    const repositories = new Map<EntityToken, unknown>([
      [
        MediaGovernanceWorkEntity,
        {
          create: jest.fn(),
          findOneBy: jest.fn().mockResolvedValue(existingWork),
          save: jest.fn(),
        },
      ],
      [
        MediaGovernanceWorkExternalRefEntity,
        {
          findOneBy: jest.fn().mockResolvedValue(existingReference),
          save: referenceSave,
        },
      ],
    ]);
    const manager = {
      getRepository: jest.fn((entity: EntityToken) => repositories.get(entity)),
    };
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
    } as unknown as DataSource;
    const service = new MediaGovernanceCatalogService(dataSource, mediaTasks);
    const detail = {
      series: { id: 'media-series-jjk' },
      works: [existingWork],
    };
    Object.assign(service, {
      detail: jest.fn().mockResolvedValue(detail),
      publishCatalogChanged: jest.fn().mockResolvedValue(undefined),
      requireSeries: jest.fn().mockResolvedValue({ id: 'media-series-jjk' }),
      verifyWorkIdentity: jest.fn().mockResolvedValue({
        candidateId: 'tmdb:810693',
        episodeCount: null,
        originalTitle: '劇場版 呪術廻戦 0',
        posterUrl: null,
        provider: 'tmdb',
        providerId: '810693',
        releaseYear: 2022,
        title: '剧场版 咒术回战 0',
      }),
    });

    await expect(
      service.createWork('media-series-jjk', {
        identity: { provider: 'tmdb', providerId: '810693' },
        workType: 'theatrical',
      }),
    ).resolves.toEqual(detail);

    expect(referenceSave).toHaveBeenCalledTimes(1);
    expect(bindWorkContext).toHaveBeenCalledWith(movieTask.id, {
      operationKind: 'legacy-pipeline',
      seriesId: 'media-series-jjk',
      workId: existingWork.id,
    });
  });

  it('derives every new Task identity from its Work instead of client fields', async () => {
    const createTask = jest.fn().mockResolvedValue({
      id: 'media-task-work-derived',
    });
    const seasonRepository = {
      findBy: jest.fn().mockResolvedValue([
        {
          seasonNumber: 2,
          seriesId: 'media-series-jjk',
          workId: 'media-work-jjk-tv',
        },
      ]),
    };
    const dataSource = {
      getRepository: jest.fn((entity: EntityToken) => {
        if (entity === MediaGovernanceSeasonEntity) return seasonRepository;
        throw new Error(`unexpected repository ${String(entity)}`);
      }),
    } as unknown as DataSource;
    const service = new MediaGovernanceCatalogService(dataSource, {
      create: createTask,
    } as unknown as MediaGovernanceService);
    Object.assign(service, {
      publishCatalogChanged: jest.fn().mockResolvedValue(undefined),
      requireWork: jest.fn().mockResolvedValue({
        canonicalProvider: 'tmdb',
        canonicalProviderId: '95479',
        id: 'media-work-jjk-tv',
        releaseYear: 2020,
        seriesId: 'media-series-jjk',
        title: '咒术回战',
        workType: 'tv',
      } as MediaGovernanceWorkEntity),
    });

    await service.createWorkTask('media-series-jjk', 'media-work-jjk-tv', {
      seasonNumbers: [2],
    });

    expect(createTask).toHaveBeenCalledWith({
      mediaType: 'tv',
      metadataIdentity: {
        provider: 'tmdb',
        providerId: '95479',
        providerTitle: '咒术回战',
        releaseYear: 2020,
      },
      operationKind: 'source-intake',
      providerRef: { provider: 'tmdb', providerId: '95479' },
      releaseYear: 2020,
      seasonNumbers: ['S02'],
      seriesId: 'media-series-jjk',
      titleHint: '咒术回战',
      workId: 'media-work-jjk-tv',
    });
  });

  it('binds verified Task mappings only to Episodes inside its existing Work', async () => {
    const task = automaticTask({
      seriesId: 'media-series-auto',
      workId: 'media-work-auto-tv',
    });
    const season = {
      episodeCount: 2,
      episodeStart: 1,
      id: 'media-season-auto-01',
      seasonNumber: 1,
      seriesId: 'media-series-auto',
      workId: 'media-work-auto-tv',
    } as MediaGovernanceSeasonEntity;
    const episodes = [1, 2].map(
      (episodeNumber) =>
        ({
          episodeNumber,
          id: `media-episode-auto-${episodeNumber}`,
          seasonId: season.id,
          seasonNumber: 1,
          seriesId: 'media-series-auto',
          status: 'known',
        }) as MediaGovernanceEpisodeEntity,
    );
    const savedBindings: unknown[] = [];
    const bindingRepository = {
      create: jest.fn((value) => value),
      findBy: jest.fn().mockResolvedValue([]),
      save: jest.fn(async (values) => {
        savedBindings.push(...values);
        return values;
      }),
    };
    const episodeRepository = {
      findBy: jest.fn().mockResolvedValue(episodes),
      save: jest.fn(async (values) => values),
    };
    const dataSource = {
      getRepository: jest.fn((entity: EntityToken) => {
        if (entity === MediaGovernanceWorkEntity) {
          return {
            findOneBy: jest.fn().mockResolvedValue({
              id: 'media-work-auto-tv',
              seriesId: 'media-series-auto',
              workType: 'tv',
            }),
          };
        }
        if (entity === MediaGovernanceSeasonEntity) {
          return { findBy: jest.fn().mockResolvedValue([season]) };
        }
        if (entity === MediaGovernanceEpisodeEntity) return episodeRepository;
        if (entity === MediaGovernanceTaskEpisodeBindingEntity) {
          return bindingRepository;
        }
        throw new Error(`unexpected repository ${String(entity)}`);
      }),
      transaction: jest.fn(async (callback) =>
        callback({
          getRepository: (entity: EntityToken) => {
            if (entity === MediaGovernanceTaskEpisodeBindingEntity) {
              return bindingRepository;
            }
            if (entity === MediaGovernanceEpisodeEntity) {
              return episodeRepository;
            }
            throw new Error(
              `unexpected transaction repository ${String(entity)}`,
            );
          },
        }),
      ),
    } as unknown as DataSource;
    const service = new MediaGovernanceCatalogService(dataSource, {
      detail: jest.fn().mockReturnValue(task),
    } as unknown as MediaGovernanceService);

    await expect(
      service.synchronizeVerifiedTask(task.id),
    ).resolves.toMatchObject({
      changed: true,
      reasonCode: 'catalog-work-binding-created',
      seriesId: 'media-series-auto',
      status: 'synchronized',
    });
    expect(savedBindings).toHaveLength(2);
    expect(savedBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bindingRole: 'work-execution',
          seriesId: 'media-series-auto',
          taskId: task.id,
        }),
      ]),
    );
    expect(episodeRepository.save).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ status: 'queued' })]),
    );
  });

  it('rejects a synthetic Season for movie and theatrical Works', async () => {
    const dataSource = {
      transaction: jest.fn(),
    } as unknown as DataSource;
    const service = new MediaGovernanceCatalogService(
      dataSource,
      {} as MediaGovernanceService,
    );
    Object.assign(service, {
      requireWork: jest.fn().mockResolvedValue({
        id: 'media-work-jjk-zero',
        seriesId: 'media-series-jjk',
        workType: 'theatrical',
      } as MediaGovernanceWorkEntity),
    });

    await expect(
      service.createSeason('media-series-jjk', 'media-work-jjk-zero', {
        episodeCount: 1,
        seasonNumber: 0,
        title: '禁止伪造 S00',
      }),
    ).rejects.toMatchObject({
      response: { msg: '电影或剧场版 Work 不能创建 Season' },
      status: 409,
    });
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });
});

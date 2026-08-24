import { DataSource } from 'typeorm';
import { createConnection } from 'mysql2/promise';
import { MediaGovernanceCatalogService } from '../../../src/modules/admin/media-governance/application/media-governance-catalog.service';
import { MediaGovernanceEventStreamService } from '../../../src/modules/admin/media-governance/application/media-governance-event-stream.service';
import {
  MediaGovernanceService,
  type MediaGovernanceTask,
} from '../../../src/modules/admin/media-governance/application/media-governance.service';
import {
  MEDIA_GOVERNANCE_CATALOG_ENTITIES,
  MediaGovernanceEpisodeEntity,
  MediaGovernanceSeasonEntity,
  MediaGovernanceSeriesEntity,
  MediaGovernanceSeriesExternalRefEntity,
  MediaGovernanceTaskEpisodeBindingEntity,
} from '../../../src/modules/admin/media-governance/infrastructure/persistence/media-governance-catalog.entities';

const DATABASE = 'kt_template_local_catalog_sync';
let describeIntegration = describe.skip;
if (process.env.KT_MEDIA_CATALOG_INTEGRATION === '1') {
  describeIntegration = describe;
}

/**
 * 把真实 create 生成的 Task 推进到自动目录同步要求的验证边界。
 *
 * @param task - 本地进程模拟器创建的 TV Task。
 * @param metadataProviderId - 要作为 verified metadata identity 的 TMDB 编号。
 */
function verifyTaskBoundary(
  task: MediaGovernanceTask,
  metadataProviderId: string,
) {
  const unit = task.units[0];
  task.metadataIdentity = {
    provider: 'tmdb',
    providerId: metadataProviderId,
    providerTitle: task.titleHint,
    releaseYear: 2026,
  };
  task.metadataStatus = 'verified';
  task.stage = 'metadata';
  task.runState = 'succeeded';
  unit.expectedEpisodeNumbers = [1, 2];
  task.sources = [
    {
      manifestState: 'inspected',
      selectedFileMappings: [
        {
          episodeNumber: 1,
          fileRole: 'video',
          index: 0,
          language: null,
          unitId: unit.id,
        },
        {
          episodeNumber: 2,
          fileRole: 'video',
          index: 1,
          language: null,
          unitId: unit.id,
        },
      ],
      sourceRole: 'primary_media',
    },
  ] as MediaGovernanceTask['sources'];
}

describeIntegration('MediaGovernanceCatalogService MySQL auto sync', () => {
  jest.setTimeout(15_000);
  let catalog: MediaGovernanceCatalogService;
  let dataSource: DataSource;
  let eventStream: MediaGovernanceEventStreamService;
  let tasks: MediaGovernanceService;

  beforeAll(async () => {
    if (process.env.DB_DATABASE !== DATABASE) {
      throw new Error(
        'integration test requires the fixed disposable database',
      );
    }
    dataSource = new DataSource({
      charset: 'utf8mb4',
      database: DATABASE,
      entities: MEDIA_GOVERNANCE_CATALOG_ENTITIES,
      host: process.env.DB_HOST,
      password: process.env.DB_PASSWORD,
      port: Number(process.env.DB_PORT),
      synchronize: false,
      type: 'mysql',
      username: process.env.DB_USERNAME,
    });
    await dataSource.initialize();
    eventStream = new MediaGovernanceEventStreamService({
      heartbeatMs: 60_000,
    });
    tasks = new MediaGovernanceService(eventStream);
    catalog = new MediaGovernanceCatalogService(dataSource, tasks, eventStream);
    catalog.onModuleInit();
  });

  afterAll(async () => {
    catalog?.onModuleDestroy();
    if (dataSource?.isInitialized) await dataSource.destroy();
    const connection = await createConnection({
      host: process.env.DB_HOST,
      password: process.env.DB_PASSWORD,
      port: Number(process.env.DB_PORT),
      user: process.env.DB_USERNAME,
    });
    try {
      await connection.query(
        'DROP DATABASE IF EXISTS kt_template_local_catalog_sync',
      );
    } finally {
      await connection.end();
    }
  });

  it('commits Series/Season/Episode/Binding and emits catalog-changed', async () => {
    const task = await tasks.create({
      mediaType: 'tv',
      providerRef: { provider: 'bangumi', providerId: '80001' },
      releaseYear: 2026,
      seasonNumbers: ['S01'],
      titleHint: 'KT_TEST_自动归类作品',
    });
    verifyTaskBoundary(task, '90001');
    const catalogEvent = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        subscription.unsubscribe();
        reject(new Error('catalog-changed timeout'));
      }, 5_000);
      const subscription = eventStream.stream().subscribe((event) => {
        if (event.type !== 'catalog-changed') return;
        if (!('taskId' in event.data) || event.data.taskId !== task.id) return;
        clearTimeout(timeout);
        subscription.unsubscribe();
        resolve(event);
      });
    });
    eventStream.publishTaskChanged({
      changeType: 'state-updated',
      patchMode: 'full',
      revision: task.revision,
      runId: null,
      runSequence: null,
      summary: tasks.summary(),
      task,
      taskId: task.id,
      updatedAt: new Date().toISOString(),
    });
    await expect(catalogEvent).resolves.toMatchObject({
      data: { taskId: task.id },
      type: 'catalog-changed',
    });
    const series = await dataSource
      .getRepository(MediaGovernanceSeriesEntity)
      .findOneByOrFail({
        canonicalProvider: 'bangumi',
        canonicalProviderId: '80001',
      });
    const [references, seasonCount, episodeCount, bindingCount] =
      await Promise.all([
        dataSource
          .getRepository(MediaGovernanceSeriesExternalRefEntity)
          .findBy({ seriesId: series.id }),
        dataSource
          .getRepository(MediaGovernanceSeasonEntity)
          .countBy({ seriesId: series.id }),
        dataSource
          .getRepository(MediaGovernanceEpisodeEntity)
          .countBy({ seriesId: series.id }),
        dataSource
          .getRepository(MediaGovernanceTaskEpisodeBindingEntity)
          .countBy({ seriesId: series.id }),
      ]);
    expect({ bindingCount, episodeCount, seasonCount }).toEqual({
      bindingCount: 2,
      episodeCount: 2,
      seasonCount: 1,
    });
    expect(
      references.map((reference) => reference.provider).toSorted(),
    ).toEqual(['bangumi', 'tmdb']);
  });

  it('keeps every catalog row unchanged for cross-Series identity conflicts', async () => {
    await catalog.reconcile({
      canonicalProviderRef: { provider: 'tmdb', providerId: '90002' },
      releaseYear: 2026,
      seasons: [
        {
          episodeCount: 2,
          episodeStart: 1,
          releaseYear: 2026,
          seasonNumber: 1,
          title: '第 1 季',
        },
      ],
      title: 'KT_TEST_冲突目标系列',
    });
    const task = await tasks.create({
      mediaType: 'tv',
      providerRef: { provider: 'bangumi', providerId: '80001' },
      releaseYear: 2026,
      seasonNumbers: ['S01'],
      titleHint: 'KT_TEST_冲突任务',
    });
    verifyTaskBoundary(task, '90002');
    const repositories = {
      bindings: dataSource.getRepository(
        MediaGovernanceTaskEpisodeBindingEntity,
      ),
      episodes: dataSource.getRepository(MediaGovernanceEpisodeEntity),
      series: dataSource.getRepository(MediaGovernanceSeriesEntity),
    };
    const before = {
      bindings: await repositories.bindings.count(),
      episodes: await repositories.episodes.count(),
      series: await repositories.series.count(),
    };

    await expect(
      catalog.synchronizeVerifiedTask(task.id),
    ).resolves.toMatchObject({
      changed: false,
      reasonCode: 'catalog-identity-cross-series-conflict',
      status: 'pending',
    });
    await expect(
      Promise.all([
        repositories.bindings.count(),
        repositories.episodes.count(),
        repositories.series.count(),
      ]),
    ).resolves.toEqual([before.bindings, before.episodes, before.series]);
  });
});

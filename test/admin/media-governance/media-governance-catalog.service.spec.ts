import type { DataSource } from 'typeorm';
import { MediaGovernanceCatalogService } from '../../../src/modules/admin/media-governance/application/media-governance-catalog.service';
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
} from '../../../src/modules/admin/media-governance/infrastructure/persistence/media-governance-catalog.entities';

type EntityToken = abstract new (...args: never[]) => unknown;

describe('MediaGovernanceCatalogService historical classification', () => {
  it('classifies exact identities without mutating tasks and remains idempotent', async () => {
    const bleachSeries = {
      canonicalProvider: 'tmdb',
      canonicalProviderId: '30984',
      id: 'media-series-bleach',
      mediaType: 'tv',
      releaseYear: 2004,
      title: '死神',
    } as MediaGovernanceSeriesEntity;
    const conflictingSeries = {
      canonicalProvider: 'bangumi',
      canonicalProviderId: '302286',
      id: 'media-series-conflict',
      mediaType: 'tv',
      releaseYear: 2022,
      title: '冲突系列',
    } as MediaGovernanceSeriesEntity;
    const jjkSeries = {
      canonicalProvider: 'tmdb',
      canonicalProviderId: '95479',
      id: 'media-series-jjk',
      mediaType: 'tv',
      releaseYear: 2020,
      title: '咒术回战',
    } as MediaGovernanceSeriesEntity;
    const bleachSeason = {
      episodeCount: 50,
      id: 'media-season-bleach-02',
      seasonNumber: 2,
      seriesId: bleachSeries.id,
      title: '千年血战篇',
    } as MediaGovernanceSeasonEntity;
    const jjkSeason = {
      episodeCount: 23,
      episodeStart: 25,
      id: 'media-season-jjk-02',
      seasonNumber: 2,
      seriesId: jjkSeries.id,
      title: '怀玉·玉折 / 涩谷事变',
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
      notApplicable: 1,
      pending: 3,
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
      reasonCode: 'media-type-not-tv',
      status: 'not-applicable',
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

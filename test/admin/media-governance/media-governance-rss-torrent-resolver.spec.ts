import type { DataSource } from 'typeorm';

import { MediaGovernanceCatalogService } from '../../../src/modules/admin/media-governance/application/media-governance-catalog.service';
import type { MediaGovernanceService } from '../../../src/modules/admin/media-governance/application/media-governance.service';
import { parseTorrentDescriptor } from '../../../src/modules/admin/media-governance/domain/media-torrent-descriptor';
import {
  MediaGovernanceEpisodeEntity,
  MediaGovernanceRssItemEntity,
  MediaGovernanceRssSubscriptionEntity,
  MediaGovernanceSeasonEntity,
  MediaGovernanceTaskEpisodeBindingEntity,
  MediaGovernanceWorkEntity,
  MediaGovernanceWorkExternalRefEntity,
} from '../../../src/modules/admin/media-governance/infrastructure/persistence/media-governance-catalog.entities';
import type { MediaGovernanceRssEntry } from '../../../src/modules/admin/media-governance/infrastructure/integration/media-governance-rss-parser';

const TORRENT_FIXTURE = Buffer.from(
  'd8:announce23:https://tracker.invalid4:infod6:lengthi4e4:name8:demo.mkvee',
);

describe('media governance rss torrent resolver', () => {
  it('rejects an RSS identity that was never registered to the selected Work', async () => {
    const findOneBy = jest.fn().mockResolvedValue(null);
    const service = new MediaGovernanceCatalogService(
      {
        getRepository: jest.fn((entity) => {
          if (entity === MediaGovernanceWorkExternalRefEntity) {
            return { findOneBy };
          }
          throw new Error(`unexpected repository ${String(entity)}`);
        }),
      } as unknown as DataSource,
      {} as MediaGovernanceService,
    );
    const internal = service as unknown as {
      assertRssIdentityBelongsToWork: (
        work: MediaGovernanceWorkEntity,
        identity: {
          provider: 'bangumi';
          providerId: string;
        },
      ) => Promise<void>;
    };
    const work = {
      canonicalProvider: 'tmdb',
      canonicalProviderId: '30984',
      id: 'media-work-bleach',
      workType: 'tv',
    } as MediaGovernanceWorkEntity;

    await expect(
      internal.assertRssIdentityBelongsToWork(work, {
        provider: 'bangumi',
        providerId: '457326',
      }),
    ).rejects.toMatchObject({
      response: {
        msg: '所选 RSS 身份不属于当前 Work，请先在 Series 下添加对应作品',
      },
      status: 409,
    });
    expect(findOneBy).toHaveBeenCalledWith({
      provider: 'bangumi',
      providerId: '457326',
      providerNamespace: 'subject',
      workId: work.id,
    });
  });

  it('recomputes an allowlisted torrent enclosure into a canonical magnet', async () => {
    const response = new Response(TORRENT_FIXTURE, {
      headers: { 'content-type': 'application/x-bittorrent' },
      status: 200,
    });
    Object.defineProperty(response, 'url', {
      value: 'https://acg.rip/t/27.torrent',
    });
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(response);
    const service = new MediaGovernanceCatalogService(
      {} as DataSource,
      {} as MediaGovernanceService,
    );
    const resolver = service as unknown as {
      resolveRssTorrentMagnet: (torrentUrl: string) => Promise<string>;
    };

    await expect(
      resolver.resolveRssTorrentMagnet('https://acg.rip/t/27.torrent'),
    ).resolves.toBe(
      `magnet:?xt=urn:btih:${parseTorrentDescriptor(TORRENT_FIXTURE).infoHash}`,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRestore();
  });

  it('rejects arbitrary torrent enclosure hosts before network access', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const service = new MediaGovernanceCatalogService(
      {} as DataSource,
      {} as MediaGovernanceService,
    );
    const resolver = service as unknown as {
      resolveRssTorrentMagnet: (torrentUrl: string) => Promise<string>;
    };

    await expect(
      resolver.resolveRssTorrentMagnet('https://example.com/27.torrent'),
    ).rejects.toThrow('media-rss-torrent-url-rejected');
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it('reprocesses an ignored Mikan item after torrent enclosure support becomes available', async () => {
    const existing = {
      episodeNumber: 27,
      id: 'media-rss-item-27',
      infoHash: null,
      sourceId: null,
      state: 'ignored',
      stateReason: '条目未命中过滤、集号或磁链合同',
      subscriptionId: 'media-rss-subscription-xiangke',
      taskId: null,
      title: 'old title',
    } as MediaGovernanceRssItemEntity;
    const itemRepository = {
      create: jest.fn((value) => value),
      findOneBy: jest.fn().mockResolvedValue(existing),
      save: jest.fn(async (value) => value),
    };
    const dataSource = {
      getRepository: jest.fn((entity) => {
        if (entity === MediaGovernanceSeasonEntity) {
          return {
            findOneByOrFail: jest.fn().mockResolvedValue({
              episodeCount: 50,
              episodeStart: 1,
              id: 'media-season-bleach-02',
              seasonNumber: 2,
              workId: 'media-work-bleach',
            }),
          };
        }
        if (entity === MediaGovernanceRssItemEntity) return itemRepository;
        if (entity === MediaGovernanceEpisodeEntity) {
          return {
            findOneBy: jest.fn().mockResolvedValue({
              episodeNumber: 27,
              id: 'media-episode-bleach-02-27',
            }),
          };
        }
        if (entity === MediaGovernanceTaskEpisodeBindingEntity) {
          return { findOneBy: jest.fn().mockResolvedValue(null) };
        }
        throw new Error(`unexpected repository ${String(entity)}`);
      }),
    } as unknown as DataSource;
    const service = new MediaGovernanceCatalogService(
      dataSource,
      {} as MediaGovernanceService,
    );
    const internal = service as unknown as {
      createMagnetBatchWithRole: (...input: unknown[]) => Promise<{
        sources: Array<{ id: string }>;
        task: { id: string };
      }>;
      persistRssEntries: (
        subscription: MediaGovernanceRssSubscriptionEntity,
        entries: MediaGovernanceRssEntry[],
      ) => Promise<{
        createdTasks: number;
        discovered: number;
        ignored: number;
        queued: number;
      }>;
      resolveRssTorrentMagnet: (torrentUrl: string) => Promise<string>;
    };
    internal.resolveRssTorrentMagnet = jest
      .fn()
      .mockResolvedValue(
        'magnet:?xt=urn:btih:d9470856384840edd9b61478c8352095b2c3e885',
      );
    internal.createMagnetBatchWithRole = jest.fn().mockResolvedValue({
      sources: [{ id: 'media-source-xiangke-27' }],
      task: { id: 'media-task-xiangke' },
    });

    const result = await internal.persistRssEntries(
      {
        contentKind: 'bundled_sidecar_media',
        id: 'media-rss-subscription-xiangke',
        includePattern: 'LoliHouse',
        releaseGroup: 'LoliHouse',
        seasonId: 'media-season-bleach-02',
        seriesId: 'media-series-bleach',
      } as MediaGovernanceRssSubscriptionEntity,
      [
        {
          guid: 'xiangke-27',
          magnetUri: null,
          publishedAt: new Date('2024-10-15T15:32:16.164Z'),
          title: '[LoliHouse] BLEACH Sennen Kessen-hen - 27 [WebRip 1080p]',
          torrentUrl:
            'https://mikanani.kas.pub/Download/20241015/episode-27.torrent',
        },
      ],
    );

    expect(result).toEqual({
      createdTasks: 1,
      discovered: 1,
      ignored: 0,
      queued: 1,
    });
    expect(existing).toMatchObject({
      episodeNumber: 27,
      sourceId: 'media-source-xiangke-27',
      state: 'queued',
      stateReason: null,
      taskId: 'media-task-xiangke',
    });
  });

  it('keeps a duplicate feed idempotent without attaching a new Work identity', async () => {
    const duplicate = {
      feedUrl:
        'https://mikanani.kas.pub/RSS/Bangumi?bangumiId=3457&subgroupid=370',
      id: 'media-rss-subscription-xiangke',
      seasonId: 'media-season-bleach-02',
      seriesId: 'media-series-bleach',
    } as MediaGovernanceRssSubscriptionEntity;
    const subscriptionRepository = {
      findOneBy: jest.fn().mockResolvedValue(duplicate),
      save: jest.fn(),
    };
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === MediaGovernanceRssSubscriptionEntity) {
          return subscriptionRepository;
        }
        throw new Error(`unexpected transaction repository ${String(entity)}`);
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
    } as unknown as DataSource;
    const service = new MediaGovernanceCatalogService(
      dataSource,
      {} as MediaGovernanceService,
    );
    Object.assign(service, {
      publishCatalogChanged: jest.fn().mockResolvedValue(undefined),
      requireSeason: jest.fn().mockResolvedValue({
        id: 'media-season-bleach-02',
        seasonNumber: 2,
        workId: 'media-work-bleach',
      } as MediaGovernanceSeasonEntity),
      requireWork: jest.fn().mockResolvedValue({
        canonicalProvider: 'tmdb',
        canonicalProviderId: '30984',
        id: 'media-work-bleach',
        originalTitle: 'BLEACH',
        releaseYear: 2004,
        seriesId: 'media-series-bleach',
        title: '死神',
        workType: 'tv',
      } as MediaGovernanceWorkEntity),
      verifyRssSubscriptionIdentity: jest.fn().mockResolvedValue({
        candidateId: 'tmdb:30984',
        episodeCount: null,
        originalTitle: 'BLEACH',
        posterUrl: null,
        provider: 'tmdb',
        providerId: '30984',
        releaseYear: 2004,
        title: '死神',
      }),
    });

    await expect(
      service.createRssSubscription(
        'media-series-bleach',
        'media-work-bleach',
        2,
        {
          contentKind: 'bundled_sidecar_media',
          feedUrl: duplicate.feedUrl,
          identity: {
            provider: 'tmdb',
            providerId: '30984',
            releaseYear: 2004,
          },
          includePattern: 'LoliHouse',
          name: '死神 千年血战篇-相克谭- · LoliHouse · Mikan',
          pollIntervalMinutes: 15,
          releaseGroup: 'LoliHouse',
        },
      ),
    ).resolves.toBe(duplicate);
    expect(subscriptionRepository.save).not.toHaveBeenCalled();
  });

  it('rebinds a subscription only after its old Task no longer exists', async () => {
    const subscription = {
      enabled: true,
      id: 'media-rss-subscription-xiangke',
      revision: 21,
      seasonId: 'media-season-bleach-02',
      seriesId: 'media-series-bleach',
      status: 'idle',
    } as MediaGovernanceRssSubscriptionEntity;
    const items = [
      {
        id: 'media-rss-item-xiangke-27',
        sourceId: 'media-source-old-27',
        state: 'queued',
        stateReason: null,
        subscriptionId: subscription.id,
        taskId: 'media-task-old-xiangke',
      },
    ] as MediaGovernanceRssItemEntity[];
    const subscriptionRepository = {
      findOneBy: jest.fn().mockResolvedValue(subscription),
      save: jest.fn(async (value) => value),
    };
    const itemRepository = {
      find: jest.fn().mockResolvedValue(items),
      save: jest.fn(async (value) => value),
    };
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === MediaGovernanceRssSubscriptionEntity) {
          return subscriptionRepository;
        }
        if (entity === MediaGovernanceRssItemEntity) return itemRepository;
        throw new Error(`unexpected repository ${String(entity)}`);
      }),
    };
    const dataSource = {
      getRepository: jest.fn((entity) => {
        if (entity === MediaGovernanceRssItemEntity) return itemRepository;
        throw new Error(`unexpected root repository ${String(entity)}`);
      }),
      transaction: jest.fn(async (callback) => callback(manager)),
    } as unknown as DataSource;
    const service = new MediaGovernanceCatalogService(
      dataSource,
      {} as MediaGovernanceService,
    );
    Object.assign(service, {
      publishCatalogChanged: jest.fn().mockResolvedValue(undefined),
      readHistoricalTasks: jest.fn().mockReturnValue([]),
      requireSeason: jest.fn().mockResolvedValue({
        id: 'media-season-xiangke-01',
        seasonNumber: 1,
        seriesId: 'media-series-bleach',
        workId: 'media-work-xiangke',
      }),
      requireSubscription: jest.fn().mockResolvedValue(subscription),
      requireWork: jest.fn().mockResolvedValue({
        id: 'media-work-xiangke',
        seriesId: 'media-series-bleach',
        workType: 'tv',
      }),
    });

    await expect(
      service.rebindRssSubscription(
        'media-series-bleach',
        'media-work-xiangke',
        1,
        subscription.id,
        { expectedRevision: 21 },
      ),
    ).resolves.toMatchObject({
      revision: 22,
      seasonId: 'media-season-xiangke-01',
      status: 'idle',
    });
    expect(items[0]).toMatchObject({
      sourceId: null,
      state: 'discovered',
      taskId: null,
    });
  });
});

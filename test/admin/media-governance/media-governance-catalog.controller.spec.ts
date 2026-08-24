import type {
  CanActivate,
  ExecutionContext,
  INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { JwtAuthGuard } from '../../../src/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { MediaGovernanceCatalogController } from '../../../src/modules/admin/media-governance/presentation/media-governance-catalog.controller';
import { MediaGovernancePermissionGuard } from '../../../src/modules/admin/media-governance/presentation/media-governance-permission.guard';
import { MediaGovernanceCatalogService } from '../../../src/modules/admin/media-governance/application/media-governance-catalog.service';

describe('MediaGovernanceCatalogController', () => {
  let app: INestApplication;
  let apiUrl: string;
  const catalog = {
    createMagnetBatch: jest.fn(),
    createRssSubscription: jest.fn(),
    createSeason: jest.fn(),
    createSeries: jest.fn(),
    createWork: jest.fn(),
    createWorkTask: jest.fn(),
    detail: jest.fn(),
    discoverRssSources: jest.fn(),
    episodePage: jest.fn(),
    historyClassification: jest.fn(),
    identityCandidates: jest.fn(),
    page: jest.fn(),
    pollRssSubscription: jest.fn(),
    reconcile: jest.fn(),
    rssIdentityCandidates: jest.fn(),
    rssItemPage: jest.fn(),
    setRssSubscriptionState: jest.fn(),
  };
  const authGuard: CanActivate = {
    canActivate(context: ExecutionContext) {
      context.switchToHttp().getRequest().adminUser = {
        roles: [{ isDeleted: false, roleCode: 'super', status: 1 }],
      };
      return true;
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MediaGovernanceCatalogController],
      providers: [
        MediaGovernancePermissionGuard,
        { provide: MediaGovernanceCatalogService, useValue: catalog },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(authGuard)
      .overrideGuard(MediaGovernancePermissionGuard)
      .useValue(authGuard)
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    apiUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a Series with one verified primary Work before any Task exists', async () => {
    catalog.createSeries.mockResolvedValueOnce({
      series: {
        id: 'media-series-jjk',
        primaryWorkId: 'media-work-jjk-tv',
      },
      works: [{ id: 'media-work-jjk-tv', workType: 'tv' }],
    });

    const response = await request(apiUrl)
      .post('/media-governance/series')
      .send({
        identity: {
          provider: 'tmdb',
          providerId: '95479',
          releaseYear: 2020,
        },
        workType: 'tv',
      })
      .expect(201)
      .expect('Cache-Control', 'no-store');

    expect(response.body.data.series.primaryWorkId).toBe('media-work-jjk-tv');
    expect(catalog.createSeries).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: expect.objectContaining({ providerId: '95479' }),
        workType: 'tv',
      }),
    );
  });

  it('adds a movie Work to an existing Series without a synthetic Season', async () => {
    catalog.createWork.mockResolvedValueOnce({
      id: 'media-work-jjk-zero',
      seriesId: 'media-series-jjk',
      workType: 'movie',
    });

    await request(apiUrl)
      .post('/media-governance/series/media-series-jjk/works')
      .send({
        identity: {
          provider: 'tmdb',
          providerId: '810693',
          releaseYear: 2022,
        },
        workType: 'movie',
      })
      .expect(201);

    expect(catalog.createWork).toHaveBeenCalledWith(
      'media-series-jjk',
      expect.objectContaining({ workType: 'movie' }),
    );
  });

  it('creates an execution Task only through an existing Work route', async () => {
    catalog.createWorkTask.mockResolvedValueOnce({
      id: 'media-task-jjk-season-two',
      seriesId: 'media-series-jjk',
      workId: 'media-work-jjk-tv',
    });

    const response = await request(apiUrl)
      .post(
        '/media-governance/series/media-series-jjk/works/media-work-jjk-tv/tasks',
      )
      .send({ seasonNumbers: [2] })
      .expect(201)
      .expect('Cache-Control', 'no-store');

    expect(response.body.data.id).toBe('media-task-jjk-season-two');
    expect(catalog.createWorkTask).toHaveBeenCalledWith(
      'media-series-jjk',
      'media-work-jjk-tv',
      { seasonNumbers: [2] },
    );
  });

  it('does not expose the legacy Task-to-Series reconcile route', async () => {
    await request(apiUrl)
      .post('/media-governance/series/reconcile')
      .send({
        canonicalProviderRef: { provider: 'tmdb', providerId: '30984' },
        releaseYear: 2004,
        seasons: [{ episodeCount: 366, seasonNumber: 1, title: '本篇' }],
        title: '死神',
      })
      .expect(404);
    expect(catalog.reconcile).not.toHaveBeenCalled();
  });

  it('returns the no-store historical classification report', async () => {
    catalog.historyClassification.mockResolvedValueOnce({
      items: [
        {
          reasonCode: 'catalog-binding-missing',
          status: 'classifiable',
          taskId: 'media-task-history-12345678901234567890',
        },
      ],
      summary: {
        classifiable: 1,
        classified: 0,
        notApplicable: 0,
        pending: 0,
        total: 1,
      },
    });

    const response = await request(apiUrl)
      .get('/media-governance/series/history-classification')
      .expect(200)
      .expect('Cache-Control', 'no-store');

    expect(response.body.data.summary).toEqual(
      expect.objectContaining({ classifiable: 1, total: 1 }),
    );
    expect(catalog.historyClassification).toHaveBeenCalledTimes(1);
  });

  it('creates one task containing multiple episode magnets', async () => {
    catalog.createMagnetBatch.mockResolvedValueOnce({
      sources: [{ id: 'source-27' }, { id: 'source-28' }],
      task: { id: 'task-batch' },
    });

    await request(apiUrl)
      .post(
        '/media-governance/series/media-series-bleach/works/media-work-bleach/seasons/2/magnet-batch',
      )
      .send({
        contentKind: 'bundled_sidecar_media',
        items: [
          {
            episodeNumber: 27,
            magnetUri:
              'magnet:?xt=urn:btih:d9470856384840edd9b61478c8352095b2c3e885',
          },
          {
            episodeNumber: 28,
            magnetUri:
              'magnet:?xt=urn:btih:1111111111111111111111111111111111111111',
          },
        ],
        releaseGroup: 'LoliHouse',
      })
      .expect(201)
      .expect('Cache-Control', 'no-store');

    expect(catalog.createMagnetBatch).toHaveBeenCalledWith(
      'media-series-bleach',
      'media-work-bleach',
      2,
      expect.objectContaining({ items: expect.arrayContaining([]) }),
    );
    await request(apiUrl)
      .post(
        '/media-governance/series/media-series-bleach/seasons/2/magnet-batch',
      )
      .send({ contentKind: 'bundled_sidecar_media', items: [] })
      .expect(404);
  });

  it('creates and manually polls an RSS subscription', async () => {
    catalog.createRssSubscription.mockResolvedValueOnce({ id: 'rss-bleach' });
    catalog.pollRssSubscription.mockResolvedValueOnce({
      createdTasks: 1,
      discovered: 14,
      ignored: 0,
      queued: 14,
    });

    await request(apiUrl)
      .post(
        '/media-governance/series/media-series-bleach/works/media-work-bleach/seasons/2/rss-subscriptions',
      )
      .send({
        contentKind: 'bundled_sidecar_media',
        feedUrl:
          'https://mikanani.kas.pub/RSS/Bangumi?bangumiId=3457&subgroupid=370',
        includePattern: 'LoliHouse',
        identity: {
          provider: 'bangumi',
          providerId: '457326',
          releaseYear: 2024,
        },
        name: '死神 千年血战篇-相克谭- · LoliHouse · Mikan',
        pollIntervalMinutes: 15,
        releaseGroup: 'LoliHouse',
      })
      .expect(201);
    const poll = await request(apiUrl)
      .post('/media-governance/series/rss-subscriptions/rss-bleach/poll')
      .expect(201);

    expect(poll.body.data).toMatchObject({ queued: 14 });
    expect(catalog.createRssSubscription).toHaveBeenCalledWith(
      'media-series-bleach',
      'media-work-bleach',
      2,
      expect.objectContaining({
        feedUrl:
          'https://mikanani.kas.pub/RSS/Bangumi?bangumiId=3457&subgroupid=370',
        includePattern: 'LoliHouse',
        identity: expect.objectContaining({
          provider: 'bangumi',
          providerId: '457326',
        }),
        pollIntervalMinutes: 15,
      }),
    );
    expect(catalog.pollRssSubscription).toHaveBeenCalledWith('rss-bleach');
  });

  it('searches identities before routing the selected identity to source aggregation', async () => {
    catalog.rssIdentityCandidates.mockResolvedValueOnce({
      items: [{ candidateId: 'bangumi:302286', provider: 'bangumi' }],
      providers: [],
    });
    catalog.discoverRssSources.mockResolvedValueOnce({
      groups: [{ releaseGroup: 'LoliHouse' }],
      providers: [],
    });

    const identities = await request(apiUrl)
      .get(
        '/media-governance/series/rss-discovery/identity-candidates?keyword=%E6%AD%BB%E7%A5%9E',
      )
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(identities.body.data.items[0].candidateId).toBe('bangumi:302286');

    const discovery = await request(apiUrl)
      .post(
        '/media-governance/series/media-series-bleach/works/media-work-bleach/seasons/2/rss-discovery/search',
      )
      .send({ provider: 'bangumi', providerId: '302286', releaseYear: 2022 })
      .expect(201)
      .expect('Cache-Control', 'no-store');
    expect(discovery.body.data.groups[0].releaseGroup).toBe('LoliHouse');
    expect(catalog.rssIdentityCandidates).toHaveBeenCalledWith({
      keyword: '死神',
    });
    expect(catalog.discoverRssSources).toHaveBeenCalledWith(
      'media-series-bleach',
      'media-work-bleach',
      2,
      { provider: 'bangumi', providerId: '302286', releaseYear: 2022 },
    );
  });
});

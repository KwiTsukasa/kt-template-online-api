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
    detail: jest.fn(),
    episodePage: jest.fn(),
    page: jest.fn(),
    pollRssSubscription: jest.fn(),
    reconcile: jest.fn(),
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

  it('routes unique series reconciliation through real HTTP validation', async () => {
    catalog.reconcile.mockResolvedValueOnce({
      series: { canonicalProviderId: '30984', id: 'media-series-bleach' },
    });

    const response = await request(apiUrl)
      .post('/media-governance/series/reconcile')
      .send({
        canonicalProviderRef: { provider: 'tmdb', providerId: '30984' },
        externalRefs: [
          {
            providerRef: { provider: 'bangumi', providerId: '302286' },
            releaseYear: 2022,
            title: '死神 千年血战篇',
          },
        ],
        originalTitle: 'BLEACH',
        releaseYear: 2004,
        seasons: [
          { episodeCount: 366, seasonNumber: 1, title: '本篇' },
          {
            episodeCount: 50,
            releaseYear: 2022,
            seasonNumber: 2,
            title: '千年血战篇',
          },
        ],
        taskBindings: [
          {
            episodeEnd: 13,
            episodeStart: 1,
            seasonNumber: 2,
            taskId: 'media-task-d6ea930d-42a6-433f-8819-a1f214361697',
          },
        ],
        title: '死神',
      })
      .expect(201)
      .expect('Cache-Control', 'no-store');

    expect(response.body.data.series.canonicalProviderId).toBe('30984');
    expect(catalog.reconcile).toHaveBeenCalledWith(
      expect.objectContaining({ title: '死神' }),
    );
  });

  it('creates one task containing multiple episode magnets', async () => {
    catalog.createMagnetBatch.mockResolvedValueOnce({
      sources: [{ id: 'source-27' }, { id: 'source-28' }],
      task: { id: 'task-batch' },
    });

    await request(apiUrl)
      .post(
        '/media-governance/series/media-series-bleach/seasons/2/magnet-batch',
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
      2,
      expect.objectContaining({ items: expect.arrayContaining([]) }),
    );
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
        '/media-governance/series/media-series-bleach/seasons/2/rss-subscriptions',
      )
      .send({
        contentKind: 'bundled_sidecar_media',
        feedUrl: 'https://example.com/bleach.xml',
        name: 'LoliHouse',
        releaseGroup: 'LoliHouse',
      })
      .expect(201);
    const poll = await request(apiUrl)
      .post('/media-governance/series/rss-subscriptions/rss-bleach/poll')
      .expect(201);

    expect(poll.body.data).toMatchObject({ queued: 14 });
    expect(catalog.pollRssSubscription).toHaveBeenCalledWith('rss-bleach');
  });
});

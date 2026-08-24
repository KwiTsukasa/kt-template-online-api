import type {
  CanActivate,
  ExecutionContext,
  INestApplication,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { NextFunction, Request, Response } from 'express';

import { Readable } from 'node:stream';

import { Test } from '@nestjs/testing';
import { json } from 'express';
import * as request from 'supertest';

import { JwtAuthGuard } from '../../../src/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { MediaGovernanceCatalogService } from '../../../src/modules/admin/media-governance/application/media-governance-catalog.service';
import type { MediaGovernanceService } from '../../../src/modules/admin/media-governance/application/media-governance.service';
import {
  MediaGovernanceSeasonEntity,
  MediaGovernanceSeriesEntity,
} from '../../../src/modules/admin/media-governance/infrastructure/persistence/media-governance-catalog.entities';
import { MediaGovernanceCatalogController } from '../../../src/modules/admin/media-governance/presentation/media-governance-catalog.controller';
import { MediaGovernancePermissionGuard } from '../../../src/modules/admin/media-governance/presentation/media-governance-permission.guard';

let describeIntegration = describe.skip;
if (process.env.KT_MEDIA_RSS_DISCOVERY_LIVE === '1') {
  describeIntegration = describe;
}
const PREVIEW_MODE = process.env.KT_MEDIA_RSS_DISCOVERY_PREVIEW === '1';
const PREVIEW_PORT = 48_085;
const PRODUCTION_API = 'https://nas4.kwitsukasa.top:51524/api';

describeIntegration('Media RSS discovery real HTTP and live providers', () => {
  let timeout = 45_000;
  if (PREVIEW_MODE) timeout = 24 * 60 * 60 * 1_000;
  jest.setTimeout(timeout);
  let app: INestApplication;
  let apiUrl: string;

  beforeAll(async () => {
    const series = {
      canonicalProvider: 'tmdb',
      canonicalProviderId: '30984',
      id: 'media-series-bleach-live-rss',
      mediaType: 'tv',
      originalTitle: 'BLEACH',
      releaseYear: 2004,
      revision: 1,
      status: 'active',
      title: '死神',
    } as MediaGovernanceSeriesEntity;
    const season = {
      episodeCount: 50,
      episodeStart: 1,
      id: 'media-season-bleach-live-rss-02',
      releaseYear: 2022,
      seasonNumber: 2,
      seriesId: series.id,
      status: 'known',
      title: '千年血战篇',
    } as MediaGovernanceSeasonEntity;
    const dataSource = {
      getRepository: jest.fn((entity) => {
        if (entity === MediaGovernanceSeriesEntity) {
          return { findOneBy: jest.fn().mockResolvedValue(series) };
        }
        if (entity === MediaGovernanceSeasonEntity) {
          return { findOneBy: jest.fn().mockResolvedValue(season) };
        }
        return { findOneBy: jest.fn().mockResolvedValue(null) };
      }),
    } as unknown as DataSource;
    const catalog = new MediaGovernanceCatalogService(dataSource, {
      page: jest.fn().mockReturnValue({ items: [], total: 0 }),
    } as unknown as MediaGovernanceService);
    const authGuard: CanActivate = {
      canActivate(context: ExecutionContext) {
        context.switchToHttp().getRequest().adminUser = {
          roles: [{ isDeleted: false, roleCode: 'super', status: 1 }],
        };
        return true;
      },
    };
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
    if (PREVIEW_MODE) {
      app.use(json({ limit: '1mb' }));
      app.use((request: Request, response: Response, next: NextFunction) => {
        if (isLocalDiscoveryRequest(request)) {
          next();
          return;
        }
        void proxyProductionRequest(request, response).catch(() => {
          if (!response.headersSent) response.status(502).end();
        });
      });
    }
    let port = 0;
    if (PREVIEW_MODE) port = PREVIEW_PORT;
    await app.listen(port, '127.0.0.1');
    apiUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('selects Bangumi identity before aggregating active release groups', async () => {
    const identityResponse = await request(apiUrl)
      .get('/media-governance/series/rss-discovery/identity-candidates')
      .query({ keyword: '死神 千年血战篇' })
      .expect(200)
      .expect('Cache-Control', 'no-store');
    const identity = identityResponse.body.data.items.find(
      (candidate: { candidateId: string }) =>
        candidate.candidateId === 'bangumi:302286',
    );
    expect(identity).toBeDefined();

    const discoveryResponse = await request(apiUrl)
      .post(
        '/media-governance/series/media-series-bleach-live-rss/seasons/2/rss-discovery/search',
      )
      .send({ provider: 'bangumi', providerId: '302286', releaseYear: 2022 })
      .expect(201)
      .expect('Cache-Control', 'no-store');
    const result = discoveryResponse.body.data;
    const availableProviders = result.providers.filter(
      (provider: { status: string }) => provider.status === 'available',
    );
    expect(result.identity.candidateId).toBe('bangumi:302286');
    expect(result.providers).toHaveLength(9);
    expect(availableProviders.length).toBeGreaterThanOrEqual(6);
    expect(result.groups.length).toBeGreaterThan(0);
    expect(
      result.groups.some(
        (group: { subscriptionOptions: unknown[] }) =>
          group.subscriptionOptions.length > 0,
      ),
    ).toBe(true);
  });

  it('loads all Mikan 3457 subgroup feeds with their current feed items', async () => {
    const response = await request(apiUrl)
      .post(
        '/media-governance/series/media-series-bleach-live-rss/seasons/2/rss-discovery/search',
      )
      .send({ provider: 'bangumi', providerId: '457326', releaseYear: 2024 })
      .expect(201);
    const result = response.body.data;
    const groups = result.groups as Array<{
      latestPublishedAt: null | string;
      releaseGroup: string;
      subscriptionOptions: Array<{ feedUrl: string; provider: string }>;
      uniqueItemCount: number;
    }>;
    expect(result.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: 'acg-rip', status: 'available' }),
        expect.objectContaining({ provider: 'dmhy', status: 'available' }),
      ]),
    );
    const mikanFeeds = new Set(
      groups.flatMap((group) =>
        group.subscriptionOptions
          .filter(
            (option) =>
              option.provider === 'mikan' &&
              option.feedUrl.includes('bangumiId=3457&subgroupid='),
          )
          .map((option) => option.feedUrl),
      ),
    );
    expect(mikanFeeds.size).toBe(9);
    expect([...mikanFeeds]).toEqual(
      expect.arrayContaining([
        'https://mikanani.kas.pub/RSS/Bangumi?bangumiId=3457&subgroupid=12',
        'https://mikanani.kas.pub/RSS/Bangumi?bangumiId=3457&subgroupid=370',
        'https://mikanani.kas.pub/RSS/Bangumi?bangumiId=3457&subgroupid=615',
      ]),
    );
    expect(groups.some((group) => group.releaseGroup === '未识别发布组')).toBe(
      false,
    );
    const loliHouse = groups.find((group) =>
      group.subscriptionOptions.some((option) =>
        option.feedUrl.endsWith('bangumiId=3457&subgroupid=370'),
      ),
    );
    expect(loliHouse).toBeDefined();
    expect(loliHouse?.releaseGroup).toBe('LoliHouse');
    expect(loliHouse?.latestPublishedAt).toEqual(expect.any(String));
    expect(loliHouse?.uniqueItemCount).toBeGreaterThan(0);
  });

  if (PREVIEW_MODE) {
    it('keeps the local discovery and production-data proxy online', async () => {
      await new Promise<void>(() => undefined);
    });
  }
});

/**
 * 只让两个新增 RSS discovery 路由进入本地 Controller，其余接口继续读取生产 API。
 *
 * @param request - Vite 转发到 48085 的 Express 请求。
 * @returns 当前请求是否属于本地新增只读接口。
 */
function isLocalDiscoveryRequest(request: Request): boolean {
  if (
    request.method === 'GET' &&
    request.path ===
      '/media-governance/series/rss-discovery/identity-candidates'
  ) {
    return true;
  }
  return /^\/media-governance\/series\/[^/]+\/seasons\/\d+\/rss-discovery\/search$/u.test(
    request.path,
  );
}

/**
 * 把非新增接口的状态、Cookie 和流式正文透明转发到生产统一网关。
 *
 * @param request - 本地 Express 请求。
 * @param response - 本地 Express 响应。
 */
async function proxyProductionRequest(
  request: Request,
  response: Response,
): Promise<void> {
  const headers = new Headers();
  for (const name of [
    'accept',
    'authorization',
    'content-type',
    'cookie',
    'last-event-id',
  ]) {
    const value = request.headers[name];
    if (typeof value === 'string') headers.set(name, value);
  }
  let body: string | undefined;
  if (!['GET', 'HEAD'].includes(request.method) && request.body !== undefined) {
    body = JSON.stringify(request.body);
  }
  const upstream = await fetch(`${PRODUCTION_API}${request.originalUrl}`, {
    body,
    headers,
    method: request.method,
    redirect: 'manual',
  });
  response.status(upstream.status);
  for (const [name, value] of upstream.headers.entries()) {
    if (
      [
        'connection',
        'content-encoding',
        'content-length',
        'transfer-encoding',
      ].includes(name)
    ) {
      continue;
    }
    response.setHeader(name, value);
  }
  const setCookies = upstream.headers.getSetCookie();
  if (setCookies.length > 0) response.setHeader('set-cookie', setCookies);
  if (!upstream.body) {
    response.end();
    return;
  }
  Readable.fromWeb(upstream.body as never).pipe(response);
}

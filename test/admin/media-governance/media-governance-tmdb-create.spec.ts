import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as request from 'supertest';
import type { DataSource } from 'typeorm';
import { JwtAuthGuard } from '../../../src/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { MediaGovernanceCatalogService } from '../../../src/modules/admin/media-governance/application/media-governance-catalog.service';
import type { MediaGovernanceService } from '../../../src/modules/admin/media-governance/application/media-governance.service';
import {
  MediaGovernanceEpisodeEntity,
  MediaGovernanceSeriesEntity,
} from '../../../src/modules/admin/media-governance/infrastructure/persistence/media-governance-catalog.entities';
import { MediaGovernanceCatalogController } from '../../../src/modules/admin/media-governance/presentation/media-governance-catalog.controller';
import { MediaGovernancePermissionGuard } from '../../../src/modules/admin/media-governance/presentation/media-governance-permission.guard';

type Row = Record<string, unknown>;
type EntityToken = abstract new (...args: never[]) => unknown;

describe('TMDB Series creation through local HTTP', () => {
  let app: INestApplication;
  let apiUrl: string;
  let transaction: jest.Mock;
  const records = new Map<EntityToken, Row[]>();
  const nativeFetch = global.fetch;
  const detailHtml = readFileSync(
    join(__dirname, 'fixtures/tmdb-jackal-detail.html'),
    'utf8',
  );
  const seasonsHtml = readFileSync(
    join(__dirname, 'fixtures/tmdb-jackal-seasons.html'),
    'utf8',
  );
  const identity = {
    provider: 'tmdb',
    providerId: '222766',
    releaseYear: 2024,
  };

  // Only persistence and authentication are isolated; all catalog/provider methods remain real.
  beforeEach(async () => {
    records.clear();
    const getRepository = (entity: EntityToken) => {
      if (!records.has(entity)) records.set(entity, []);
      const rows = records.get(entity)!;
      const findBy = async (where: Row) =>
        rows.filter((row) =>
          Object.entries(where).every(([key, value]) => row[key] === value),
        );
      return {
        create: (value: Row) => ({ ...value }),
        save: async (value: Row | Row[]) => {
          if (Array.isArray(value)) rows.push(...value);
          else rows.push(value);
          return value;
        },
        findBy,
        find: async (options: { where?: Row }) => findBy(options.where ?? {}),
        findOneBy: async (where: Row) => (await findBy(where))[0] ?? null,
      };
    };
    transaction = jest.fn(async (callback) => callback({ getRepository }));
    const catalog = new MediaGovernanceCatalogService(
      { getRepository, transaction } as unknown as DataSource,
      {
        page: () => ({ items: [], total: 0 }),
      } as unknown as MediaGovernanceService,
    );
    const moduleRef = await Test.createTestingModule({
      controllers: [MediaGovernanceCatalogController],
      providers: [
        { provide: MediaGovernanceCatalogService, useValue: catalog },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(MediaGovernancePermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    apiUrl = await app.getUrl();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app?.close();
  });

  const mockTmdb = (seasonBody: string, failSeasons = false) =>
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      expect(url.origin).toBe('https://www.themoviedb.org');
      let body = detailHtml;
      if (url.pathname.endsWith('/seasons')) {
        if (failSeasons) throw new TypeError('fetch failed');
        body = seasonBody;
      }
      const response = new Response(body, {
        headers: { 'content-type': 'text/html;charset=utf-8' },
      });
      url.pathname = url.pathname.replace(
        '/222766',
        '/222766-the-day-of-the-jackal',
      );
      Object.defineProperty(response, 'url', { value: url.href });
      return response;
    });

  it('creates the verified Work, season and E01-E10 through the real service chain', async () => {
    const fetchMock = mockTmdb(seasonsHtml);
    const response = await request(apiUrl)
      .post('/media-governance/series')
      .send({ identity, workType: 'tv' })
      .expect(201);
    expect(response.body.data.series).toMatchObject({
      canonicalProviderId: '222766',
      title: '豺狼的日子',
    });
    expect(response.body.data.works).toHaveLength(1);
    expect(response.body.data.works[0]).toMatchObject({
      isPrimary: true,
      seasonCount: 1,
    });
    expect(response.body.data.seasons).toEqual([
      expect.objectContaining({ seasonNumber: 1, episodeCount: 10 }),
    ]);
    expect(
      records
        .get(MediaGovernanceEpisodeEntity)
        ?.map((row) => row.episodeNumber),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(
      fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname),
    ).toEqual(['/tv/222766', '/tv/222766/seasons']);
  });

  it('creates each populated season under the same Work and skips the announced empty season', async () => {
    const specials = seasonsHtml
      .replaceAll('/season/1', '/season/0')
      .replace('共 10 集', '共 2 集');
    const nextSeason = seasonsHtml
      .replaceAll('/season/1', '/season/2')
      .replace('共 10 集', '共 8 集');
    const futureSeason = seasonsHtml
      .replaceAll('/season/1', '/season/3')
      .replace('共 10 集', '共 0 集');
    mockTmdb(nextSeason + specials + futureSeason + seasonsHtml);
    const response = await request(apiUrl)
      .post('/media-governance/series')
      .send({ identity, workType: 'tv' })
      .expect(201);
    const workId = response.body.data.series.primaryWorkId;
    expect(
      response.body.data.seasons.map((season) => [
        season.seasonNumber,
        season.episodeCount,
        season.workId,
      ]),
    ).toEqual([
      [0, 2, workId],
      [1, 10, workId],
      [2, 8, workId],
    ]);
    const episodes = records.get(MediaGovernanceEpisodeEntity) ?? [];
    expect(episodes).toHaveLength(20);
    expect(
      episodes
        .filter((row) => row.seasonNumber === 2)
        .map((row) => row.episodeNumber),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['empty season list', '<section></section>', false],
    [
      'missing episode summary',
      seasonsHtml.replace('共 10 集', '未公布集数'),
      false,
    ],
    ['future season only', seasonsHtml.replace('共 10 集', '共 0 集'), false],
    [
      'wrong season identity',
      seasonsHtml.replaceAll('222766', '222767'),
      false,
    ],
    ['network failure', seasonsHtml, true],
  ])(
    'returns 409 before any transaction for %s',
    async (_label, body, fail) => {
      mockTmdb(body, fail);
      const response = await request(apiUrl)
        .post('/media-governance/series')
        .send({ identity, workType: 'tv' })
        .expect(409);
      expect(response.body.err).toBe('所选 TV 作品季集信息无法重新核验');
      expect(transaction).not.toHaveBeenCalled();
      expect(records.get(MediaGovernanceSeriesEntity) ?? []).toEqual([]);
    },
  );

  let liveTest = it.skip;
  if (process.env.KT_TMDB_LIVE === '1') liveTest = it;
  liveTest(
    'creates TV 222766 from current official TMDB responses over local HTTP',
    async () => {
      const evidenceDir = resolve(
        __dirname,
        '../../../../../.kt-workspace/test-artifacts/tmdb-season-facts-20260915',
      );
      mkdirSync(evidenceDir, { recursive: true });
      const upstream: object[] = [];
      jest.spyOn(global, 'fetch').mockImplementation(async (input, options) => {
        const response = await nativeFetch(input, options);
        const html = await response.clone().text();
        const filename = `live-${upstream.length}.html`;
        writeFileSync(join(evidenceDir, filename), html);
        upstream.push({
          requested: String(input),
          finalUrl: response.url,
          status: response.status,
          bytes: Buffer.byteLength(html),
          filename,
        });
        return response;
      });
      const response = await request(apiUrl)
        .post('/media-governance/series')
        .send({ identity, workType: 'tv' })
        .timeout(45000)
        .expect(201);
      const episodes = records.get(MediaGovernanceEpisodeEntity) ?? [];
      expect(response.body.data.series.canonicalProviderId).toBe('222766');
      expect(response.body.data.seasons).toEqual([
        expect.objectContaining({
          seasonNumber: 1,
          episodeCount: 10,
          releaseYear: 2024,
        }),
      ]);
      expect(episodes.map((row) => row.episodeNumber)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
      ]);
      writeFileSync(
        join(evidenceDir, 'live-http.json'),
        JSON.stringify(
          {
            checkedAt: new Date().toISOString(),
            apiUrl,
            status: response.status,
            upstream,
            data: response.body.data,
            episodeNumbers: episodes.map((row) => row.episodeNumber),
            persistence:
              'isolated in-memory repositories; no production writes',
          },
          null,
          2,
        ),
      );
    },
    50000,
  );
});

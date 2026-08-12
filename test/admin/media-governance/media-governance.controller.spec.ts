import type {
  CanActivate,
  ExecutionContext,
  INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AdminSuperGuard } from '../../../src/modules/admin/identity/auth/admin-super.guard';
import { JwtAuthGuard } from '../../../src/modules/admin/identity/auth/jwt-auth.guard';
import { MediaGovernanceController } from '../../../src/modules/admin/media-governance/media-governance.controller';
import { MediaGovernanceEventStreamService } from '../../../src/modules/admin/media-governance/media-governance-event-stream.service';
import { MediaGovernancePermissionGuard } from '../../../src/modules/admin/media-governance/media-governance-permission.guard';
import { MediaGovernanceService } from '../../../src/modules/admin/media-governance/media-governance.service';

describe('MediaGovernanceController', () => {
  let app: INestApplication;
  let apiUrl: string;
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
      controllers: [MediaGovernanceController],
      providers: [
        AdminSuperGuard,
        MediaGovernanceEventStreamService,
        MediaGovernancePermissionGuard,
        MediaGovernanceService,
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

  it('creates and lists a normalized draft over real HTTP', async () => {
    const created = await request(apiUrl)
      .post('/media-governance/tasks')
      .send({
        mediaType: 'tv',
        providerRef: { provider: 'bangumi', providerId: '425909' },
        releaseYear: 2024,
        seasonNumbers: ['S00', 'S02'],
        titleHint: '媒体治理演示作品',
      })
      .expect(201)
      .expect('Cache-Control', 'no-store');

    expect(created.body).toMatchObject({
      code: 200,
      data: {
        mediaType: 'tv',
        revision: 1,
        runState: 'draft',
        stage: 'intake',
      },
      msg: '操作成功',
    });
    expect(created.body).not.toHaveProperty('err');
    expect(created.body.data.units).toHaveLength(2);

    const page = await request(apiUrl)
      .get('/media-governance/tasks/page?pageNo=1&pageSize=20')
      .expect(200)
      .expect('Cache-Control', 'no-store');

    expect(page.body.data.total).toBe(1);
    expect(page.body.data.items[0].id).toBe(created.body.data.id);

    const summary = await request(apiUrl)
      .get('/media-governance/tasks/summary')
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(summary.body.data).toMatchObject({
      agentPending: 0,
      closed: 0,
      total: 1,
    });

    const detail = await request(apiUrl)
      .get(`/media-governance/tasks/${created.body.data.id}`)
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(detail.body.data).toMatchObject({
      id: created.body.data.id,
      semanticProjection: {
        currentActionLabel: '等待补充来源',
        stageLabel: '接收资料',
      },
    });
  });

  it.each([
    [
      'TV 缺少季号',
      { mediaType: 'tv', titleHint: '无季号作品' },
      'TV 正常剧集必须至少声明一个季号',
    ],
    [
      '电影错误使用 S00',
      {
        mediaType: 'movie',
        seasonNumbers: ['S00'],
        titleHint: '错误电影',
      },
      '电影或剧场版不能填写季号，也不能使用 S00 代替作品类型',
    ],
    [
      'providerRef 缺少 providerId',
      {
        mediaType: 'movie',
        providerRef: { provider: 'tmdb' },
        titleHint: '错误编号',
      },
      '请求参数不符合媒体治理合同',
    ],
    [
      '额外字段',
      {
        arbitraryPath: '/vol2/1000/Media',
        mediaType: 'movie',
        titleHint: '越界字段',
      },
      '请求参数不符合媒体治理合同',
    ],
  ])(
    'rejects %s with a bounded Vben error',
    async (_name, body, expectedError) => {
      const response = await request(apiUrl)
        .post('/media-governance/tasks')
        .send(body)
        .expect(400);

      expect(response.body.err).toBe(expectedError);
      expect(typeof response.body.msg).toBe('string');
      expect(JSON.stringify(response.body)).not.toContain('/vol2/1000/Media');
    },
  );

  it('accepts a magnet source and returns only a sanitized projection', async () => {
    const created = await request(apiUrl)
      .post('/media-governance/tasks')
      .send({
        mediaType: 'movie',
        titleHint: '来源接口测试',
      })
      .expect(201);

    const source = await request(apiUrl)
      .post(`/media-governance/tasks/${created.body.data.id}/sources/magnet`)
      .send({
        contentKind: 'embedded_subtitle_media',
        expectedRevision: 1,
        magnetUri:
          'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&tr=https%3A%2F%2Fprivate.invalid%2Fpasskey',
        seasonNumbers: [],
        sourceRole: 'primary_media',
      })
      .expect(201)
      .expect('Cache-Control', 'no-store');

    expect(source.body.data).toMatchObject({
      infoHash: '0123456789abcdef0123456789abcdef01234567',
      sourceHealthLabel: '尚未检查',
      transportKind: 'magnet',
    });
    expect(JSON.stringify(source.body)).not.toContain('private.invalid');
  });

  it('exposes metadata and acceptance gates over real HTTP and fails closed out of order', async () => {
    const created = await request(apiUrl)
      .post('/media-governance/tasks')
      .send({ mediaType: 'movie', titleHint: '分档与验收接口测试' })
      .expect(201);
    const taskId = created.body.data.id as string;

    await request(apiUrl)
      .post(`/media-governance/tasks/${taskId}/metadata/verify`)
      .send({ expectedRevision: 1 })
      .expect(409);
    await request(apiUrl)
      .post(`/media-governance/tasks/${taskId}/acceptance/verify`)
      .send({ expectedRevision: 1 })
      .expect(409);
  });

  it('accepts one multipart TV season and safely parses a torrent fixture', async () => {
    const created = await request(apiUrl)
      .post('/media-governance/tasks')
      .send({
        mediaType: 'tv',
        seasonNumbers: ['S01'],
        titleHint: '种子接口测试',
      })
      .expect(201);
    const torrent = Buffer.from('d4:infod6:lengthi4e4:name8:demo.mkvee');
    const source = await request(apiUrl)
      .post(`/media-governance/tasks/${created.body.data.id}/sources/torrent`)
      .field('contentKind', 'embedded_subtitle_media')
      .field('expectedRevision', '1')
      .field('seasonNumbers', 'S01')
      .field('sourceRole', 'primary_media')
      .attach('file', torrent, {
        contentType: 'application/x-bittorrent',
        filename: 'demo.torrent',
      })
      .expect(201);

    expect(source.body.data).toMatchObject({
      manifest: [{ relativePath: 'demo.mkv', sizeBytes: 4 }],
      manifestState: 'inspected',
      seasonNumbers: ['S01'],
      transportKind: 'torrent',
    });

    await request(apiUrl)
      .put(
        `/media-governance/tasks/${created.body.data.id}/sources/${source.body.data.id}/selection`,
      )
      .send({
        expectedRevision: 2,
        fileMappings: [
          {
            episodeNumber: 1,
            fileRole: 'video',
            index: 0,
            unitId: created.body.data.units[0].id,
          },
        ],
        selectedFileIndices: [0],
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          selectedBytes: 4,
          selectedFileCount: 1,
          selectedFileIndices: [0],
        });
      });
  });

  it('runs the bounded HTTP Demo through download, governance and Agent closure', async () => {
    const created = await request(apiUrl)
      .post('/media-governance/tasks')
      .send({
        mediaType: 'tv',
        seasonNumbers: ['S01'],
        titleHint: '完整 HTTP Demo',
      })
      .expect(201);
    const taskId = created.body.data.id as string;
    const source = await request(apiUrl)
      .post(`/media-governance/tasks/${taskId}/sources/magnet`)
      .send({
        contentKind: 'embedded_subtitle_media',
        expectedRevision: 1,
        magnetUri:
          'magnet:?xt=urn:btih:89abcdef0123456789abcdef0123456789abcdef',
        seasonNumbers: ['S01'],
        sourceRole: 'primary_media',
      })
      .expect(201);
    const sourceId = source.body.data.id as string;

    await request(apiUrl)
      .post(`/media-governance/tasks/${taskId}/sources/${sourceId}/inspect`)
      .send({ expectedRevision: 2 })
      .expect(201);
    await request(apiUrl)
      .put(`/media-governance/tasks/${taskId}/sources/${sourceId}/selection`)
      .send({
        expectedRevision: 3,
        fileMappings: [
          {
            episodeNumber: 1,
            fileRole: 'video',
            index: 0,
            unitId: created.body.data.units[0].id,
          },
        ],
        selectedFileIndices: [0],
      })
      .expect(200);
    await request(apiUrl)
      .post(
        `/media-governance/tasks/${taskId}/sources/${sourceId}/probe-runtime`,
      )
      .send({ expectedRevision: 4 })
      .expect(201);
    await request(apiUrl)
      .post(`/media-governance/tasks/${taskId}/downloads/start`)
      .send({ expectedRevision: 5 })
      .expect(201);
    await new Promise((resolve) => setTimeout(resolve, 650));

    await request(apiUrl)
      .post(`/media-governance/tasks/${taskId}/governance/start`)
      .send({ expectedRevision: 6 })
      .expect(201);
    await new Promise((resolve) => setTimeout(resolve, 650));

    const agent = await request(apiUrl)
      .post(`/media-governance/tasks/${taskId}/agent/start`)
      .send({ expectedRevision: 7 })
      .expect(201);
    expect(agent.body.data.policyBoundaryLabel).toContain('五层边界');
    await new Promise((resolve) => setTimeout(resolve, 650));

    const closed = await request(apiUrl)
      .post(`/media-governance/tasks/${taskId}/agent/operator-decision`)
      .send({
        expectedRevision: 8,
        reason: '已核对作品身份、季号与 provider 候选',
        selectedCandidateId: 'candidate-confirmed',
      })
      .expect(201);
    expect(closed.body.data).toMatchObject({
      metadataStatus: 'verified',
      revision: 9,
      runState: 'succeeded',
      stage: 'closed',
    });
    expect(closed.body.data.progress.progressLabel).toBe('本地闭环演示已完成');
  });
});

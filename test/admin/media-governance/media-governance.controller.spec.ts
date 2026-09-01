import { get as httpGet } from 'node:http';
import type {
  CanActivate,
  ExecutionContext,
  INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AdminSuperGuard } from '../../../src/modules/admin/identity/auth/presentation/admin-super.guard';
import { JwtAuthGuard } from '../../../src/modules/admin/identity/auth/presentation/jwt-auth.guard';
import {
  MediaGovernanceController,
  MediaGovernanceEventsController,
} from '../../../src/modules/admin/media-governance/presentation/media-governance.controller';
import { MediaGovernanceEventStreamService } from '../../../src/modules/admin/media-governance/application/media-governance-event-stream.service';
import { MediaGovernancePermissionGuard } from '../../../src/modules/admin/media-governance/presentation/media-governance-permission.guard';
import { MediaGovernanceService } from '../../../src/modules/admin/media-governance/application/media-governance.service';

describe('MediaGovernanceController', () => {
  let app: INestApplication;
  let apiUrl: string;
  let eventStream: MediaGovernanceEventStreamService;
  let service: MediaGovernanceService;
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
      controllers: [MediaGovernanceController, MediaGovernanceEventsController],
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
    eventStream = app.get(MediaGovernanceEventStreamService);
    service = app.get(MediaGovernanceService);
  });

  afterAll(async () => {
    await app?.close();
  });

  async function createLegacyTask(
    input: Parameters<MediaGovernanceService['create']>[0],
  ) {
    return { body: { data: await service.create(input) } };
  }

  it('streams through real HTTP with intermediary buffering disabled', async () => {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const requestHandle = httpGet(
        `${apiUrl}/media-governance/events/stream`,
        { headers: { Accept: 'text/event-stream' } },
        (response) => {
          try {
            expect(response.statusCode).toBe(200);
            expect(response.headers['content-type']).toContain(
              'text/event-stream',
            );
            expect(response.headers['cache-control']).toContain('no-store');
            expect(response.headers['x-accel-buffering']).toBe('no');
            settled = true;
            response.destroy();
            resolve();
          } catch (error) {
            settled = true;
            response.destroy();
            reject(error);
          }
        },
      );
      requestHandle.setTimeout(3_000, () => {
        requestHandle.destroy(new Error('媒体治理 SSE 响应头读取超时'));
      });
      requestHandle.once('error', (error) => {
        if (!settled) reject(error);
      });
    });
  });

  it('streams committed catalog-changed cards through real HTTP', async () => {
    await new Promise<void>((resolve, reject) => {
      let responseText = '';
      let settled = false;
      const requestHandle = httpGet(
        `${apiUrl}/media-governance/events/stream`,
        { headers: { Accept: 'text/event-stream' } },
        (response) => {
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => {
            responseText += chunk;
            if (!responseText.includes('event: catalog-changed')) return;
            try {
              expect(responseText).toContain('media-series-http-catalog-001');
              expect(responseText).toContain('media-task-http-catalog-001');
              settled = true;
              response.destroy();
              resolve();
            } catch (error) {
              settled = true;
              response.destroy();
              reject(error);
            }
          });
          eventStream.publishCatalogChanged({
            changeType: 'created',
            revision: 1,
            series: {
              bindingCount: 2,
              boundEpisodeCount: 2,
              canonicalProvider: 'tmdb',
              canonicalProviderId: '90001',
              coveragePercent: 100,
              createTime: '2026-08-24T00:00:00.000Z',
              episodeCount: 2,
              id: 'media-series-http-catalog-001',
              mediaType: 'tv',
              originalTitle: null,
              releaseYear: 2026,
              revision: 1,
              rssCount: 0,
              rssTotalCount: 0,
              seasonCount: 1,
              seasonSummaries: [],
              status: 'active',
              taskCount: 1,
              title: 'HTTP 自动归类作品',
              updateTime: '2026-08-24T00:00:00.000Z',
            },
            seriesId: 'media-series-http-catalog-001',
            taskId: 'media-task-http-catalog-001',
            taskIds: ['media-task-http-catalog-001'],
            updatedAt: '2026-08-24T00:00:00.000Z',
          });
        },
      );
      requestHandle.setTimeout(3_000, () => {
        requestHandle.destroy(new Error('系列目录 SSE 事件读取超时'));
      });
      requestHandle.once('error', (error) => {
        if (!settled) reject(error);
      });
    });
  });

  it('does not expose a second media-specific conversation message action', () => {
    expect(
      Reflect.get(MediaGovernanceController.prototype, 'agentMessage'),
    ).toBeUndefined();
  });

  it('does not expose root Task creation or Task identity mutation routes', async () => {
    await request(apiUrl)
      .post('/media-governance/tasks')
      .send({ mediaType: 'movie', titleHint: '禁止单独创建' })
      .expect(404);
    await request(apiUrl)
      .put('/media-governance/tasks/media-task-legacy/identity')
      .send({ expectedRevision: 1, mediaType: 'movie', titleHint: '禁止修改' })
      .expect(404);
    await request(apiUrl)
      .post(
        '/media-governance/tasks/media-task-legacy/catalog-identity/restore',
      )
      .send({ expectedRevision: 1, providerId: '123' })
      .expect(404);
  });

  it('routes canonical identity rebase through real HTTP revision validation', async () => {
    const taskId = 'media-task-http-identity-rebase';
    const rebaseSpy = jest
      .spyOn(service, 'startCanonicalIdentityRebase')
      .mockResolvedValueOnce({
        activeRunId: 'media-run-http-identity-rebase',
        id: taskId,
        revision: 22,
        runState: 'queued',
        stage: 'governance',
      } as never);

    const response = await request(apiUrl)
      .post(`/media-governance/tasks/${taskId}/governance/identity-rebase`)
      .send({ expectedRevision: 21 })
      .expect(201)
      .expect('Cache-Control', 'no-store');

    expect(response.body.data).toMatchObject({
      activeRunId: 'media-run-http-identity-rebase',
      id: taskId,
      revision: 22,
      runState: 'queued',
      stage: 'governance',
    });
    expect(rebaseSpy).toHaveBeenCalledWith(taskId, { expectedRevision: 21 });
    rebaseSpy.mockRestore();
  });

  it('creates and lists a normalized draft over real HTTP', async () => {
    const created = await createLegacyTask({
      mediaType: 'tv',
      providerRef: { provider: 'bangumi', providerId: '425909' },
      releaseYear: 2024,
      seasonNumbers: ['S00', 'S02'],
      titleHint: '媒体治理演示作品',
    });

    expect(created.body.data).toMatchObject({
      mediaType: 'tv',
      revision: 1,
      runState: 'draft',
      stage: 'intake',
    });
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
      attentionRequired: 0,
      blocked: 0,
      closed: 0,
      evidenceDriftCount: 0,
      healthLabel: '运行核对正常',
      mixedSubtitleSeasonCount: 0,
      stagingResidualCount: null,
      stuckRunCount: 0,
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

  it('supports keyword search and revision-gated discard over real HTTP', async () => {
    const created = await createLegacyTask({
      mediaType: 'tv',
      providerRef: { provider: 'bangumi', providerId: 'crud-fixture' },
      releaseYear: 2025,
      seasonNumbers: ['S00'],
      titleHint: 'CRUD 草稿唯一标题',
      workItemId: 'media-963',
    });
    const taskId = created.body.data.id as string;

    const page = await request(apiUrl)
      .get('/media-governance/tasks/page')
      .query({ keyword: 'crud 草稿', pageNo: 1, pageSize: 20 })
      .expect(200);
    expect(page.body.data).toMatchObject({
      items: [expect.objectContaining({ id: taskId })],
      total: 1,
    });

    await request(apiUrl)
      .post(`/media-governance/tasks/${taskId}/sources/magnet`)
      .send({
        contentKind: 'embedded_subtitle_media',
        expectedRevision: 1,
        magnetUri:
          'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
        sourceRole: 'primary_media',
      })
      .expect(201);

    await request(apiUrl)
      .delete(`/media-governance/tasks/${taskId}`)
      .query({ expectedRevision: 1 })
      .expect(409);
    const deleted = await request(apiUrl)
      .delete(`/media-governance/tasks/${taskId}`)
      .query({ expectedRevision: 2 })
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(deleted.body).toMatchObject({
      code: 200,
      data: { clearedWorkItemId: 'media-963', deletedTaskId: taskId },
      msg: '操作成功',
    });
    expect(deleted.body).not.toHaveProperty('err');

    await request(apiUrl).get(`/media-governance/tasks/${taskId}`).expect(404);
  });

  it('replaces and deletes a failed intake source over real HTTP', async () => {
    const created = await createLegacyTask({
      mediaType: 'tv',
      seasonNumbers: ['S01'],
      titleHint: '来源失败恢复接口测试',
    });
    const taskId = created.body.data.id as string;
    await request(apiUrl)
      .post(`/media-governance/tasks/${taskId}/sources/magnet`)
      .send({
        contentKind: 'embedded_subtitle_media',
        expectedRevision: 1,
        magnetUri:
          'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
        sourceRole: 'primary_media',
      })
      .expect(201);

    const service = app.get(MediaGovernanceService);
    const failedTask = service.detail(taskId);
    const failedSourceId = failedTask.sources[0]!.id;
    failedTask.runState = 'blocked';
    failedTask.gateReason = 'NAS 执行失败：magnet_metadata_unavailable';

    const removed = await request(apiUrl)
      .post(
        `/media-governance/tasks/${taskId}/sources/${failedSourceId}/remove`,
      )
      .send({ expectedRevision: 2 })
      .expect(201);
    expect(removed.body.data).toMatchObject({
      revision: 3,
      runState: 'draft',
      sources: [],
    });

    await request(apiUrl)
      .post(`/media-governance/tasks/${taskId}/sources/magnet`)
      .send({
        contentKind: 'embedded_subtitle_media',
        expectedRevision: 3,
        magnetUri:
          'magnet:?xt=urn:btih:fedcba9876543210fedcba9876543210fedcba98',
        sourceRole: 'primary_media',
      })
      .expect(201);
    await request(apiUrl)
      .delete(`/media-governance/tasks/${taskId}`)
      .query({ expectedRevision: 4 })
      .expect(200);
    await request(apiUrl).get(`/media-governance/tasks/${taskId}`).expect(404);
  });

  it('accepts a magnet source and returns only a sanitized projection', async () => {
    const created = await createLegacyTask({
      mediaType: 'movie',
      titleHint: '来源接口测试',
    });

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

  it('removes metadata actions and keeps mechanical acceptance revision-gated', async () => {
    const created = await createLegacyTask({
      mediaType: 'movie',
      titleHint: '分档与验收接口测试',
    });
    const taskId = created.body.data.id as string;

    await request(apiUrl)
      .post(`/media-governance/tasks/${taskId}/metadata/verify`)
      .send({ expectedRevision: 1 })
      .expect(404);
    await request(apiUrl)
      .post(`/media-governance/tasks/${taskId}/acceptance/verify`)
      .send({ expectedRevision: 1 })
      .expect(409);
  });

  it('accepts one multipart TV season and safely parses a torrent fixture', async () => {
    const created = await createLegacyTask({
      mediaType: 'tv',
      seasonNumbers: ['S01'],
      titleHint: '种子接口测试',
    });
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

  it('runs the HTTP Demo through download and mechanical governance closure', async () => {
    const created = await createLegacyTask({
      mediaType: 'tv',
      seasonNumbers: ['S01'],
      titleHint: '完整 HTTP Demo',
    });
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

    const closedTask = service.detail(taskId);
    expect(closedTask).toMatchObject({
      closedMode: 'mechanical',
      revision: 7,
      runState: 'succeeded',
      stage: 'closed',
    });
  });
});

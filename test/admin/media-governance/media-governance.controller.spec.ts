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
import {
  MEDIA_GOVERNANCE_PERMISSION,
  MediaGovernancePermissionGuard,
} from '../../../src/modules/admin/media-governance/presentation/media-governance-permission.guard';
import { MediaGovernanceService } from '../../../src/modules/admin/media-governance/application/media-governance.service';

describe('MediaGovernanceController', () => {
  let app: INestApplication;
  let apiUrl: string;
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
    service = app.get(MediaGovernanceService);
  });

  afterAll(async () => {
    await app?.close();
  });

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

  it('uses AgentOperate for continuing an existing Agent conversation', () => {
    expect(
      Reflect.getMetadata(
        MEDIA_GOVERNANCE_PERMISSION,
        MediaGovernanceController.prototype.agentMessage,
      ),
    ).toEqual(['Media:Governance:AgentOperate']);
  });

  it('passes Agent session pagination and follow-up messages through real HTTP DTO validation', async () => {
    const taskId = 'media-task-http-agent-001';
    const threadId = 'thread-media-http-agent-001';
    const session = {
      conversationRevision: 4,
      currentActionLabel: '等待操作员消息',
      currentUnitId: null,
      hasMoreMessages: false,
      historyComplete: true,
      lastHeartbeatLabel: '刚刚',
      messages: [],
      policyBoundaryLabel: '五层边界已启用',
      result: null,
      status: 'needs-operator',
      statusLabel: 'Agent 已回复，可继续对话',
      threadId,
    };
    const sessionSpy = jest
      .spyOn(service, 'agentSession')
      .mockResolvedValueOnce(session as never);
    const messageSpy = jest
      .spyOn(service, 'continueAgentConversation')
      .mockResolvedValueOnce(session as never);

    const history = await request(apiUrl)
      .get(
        `/media-governance/tasks/${taskId}/agent/session?afterSequence=2&limit=50`,
      )
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(history.body.data).toMatchObject({
      conversationRevision: 4,
      threadId,
    });
    expect(sessionSpy).toHaveBeenCalledWith(taskId, {
      afterSequence: 2,
      limit: 50,
    });

    const followUp = await request(apiUrl)
      .post(`/media-governance/tasks/${taskId}/agent/messages`)
      .send({
        clientMessageId: 'media-user-http-agent-001',
        content: '继续核对当前任务',
        expectedConversationRevision: 4,
        threadId,
      })
      .expect(201)
      .expect('Cache-Control', 'no-store');
    expect(followUp.body.data).toMatchObject({
      conversationRevision: 4,
      threadId,
    });
    expect(messageSpy).toHaveBeenCalledWith(taskId, {
      clientMessageId: 'media-user-http-agent-001',
      content: '继续核对当前任务',
      expectedConversationRevision: 4,
      threadId,
    });
    sessionSpy.mockRestore();
    messageSpy.mockRestore();
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

  it('starts a CodexAgent turn from an intake draft over real HTTP', async () => {
    const created = await request(apiUrl)
      .post('/media-governance/tasks')
      .send({
        mediaType: 'tv',
        seasonNumbers: ['S01'],
        titleHint: '草稿 Agent 入口接口测试',
      })
      .expect(201);

    const agent = await request(apiUrl)
      .post(`/media-governance/tasks/${created.body.data.id}/agent/start`)
      .send({ expectedRevision: 1 })
      .expect(201)
      .expect('Cache-Control', 'no-store');

    expect(agent.body).toMatchObject({
      code: 200,
      data: {
        currentActionLabel: '正在核对媒体身份与季级字幕合同',
        policyBoundaryLabel: '五层边界已启用；NAS、媒体和云端写适配器保持关闭',
        status: 'running',
        statusLabel: 'Agent 正在治理',
      },
      msg: '操作成功',
    });
    expect(agent.body.data.threadId).toMatch(/^media-agent-/u);
    expect(agent.body).not.toHaveProperty('err');
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

  it('corrects a draft identity over real HTTP and rejects stale or invalid input', async () => {
    const created = await request(apiUrl)
      .post('/media-governance/tasks')
      .send({
        mediaType: 'tv',
        releaseYear: 2015,
        seasonNumbers: ['S01'],
        titleHint: '下载前身份接口测试',
      })
      .expect(201);
    const taskId = created.body.data.id as string;

    const updated = await request(apiUrl)
      .put(`/media-governance/tasks/${taskId}/identity`)
      .send({
        expectedRevision: 1,
        mediaType: 'tv',
        providerRef: { provider: 'tmdb', providerId: '63145' },
        seasonNumbers: ['S00', 'S02'],
        titleHint: '下载前身份接口已修正',
      })
      .expect(200)
      .expect('Cache-Control', 'no-store');

    expect(updated.body.data).toMatchObject({
      providerRef: { provider: 'tmdb', providerId: '63145' },
      releaseYear: 2015,
      mediaType: 'tv',
      revision: 2,
      stage: 'intake',
      titleHint: '下载前身份接口已修正',
    });
    expect(updated.body.data.units).toEqual([
      expect.objectContaining({ seasonNumber: 'S00', unitKind: 'season' }),
      expect.objectContaining({ seasonNumber: 'S02', unitKind: 'season' }),
    ]);

    await request(apiUrl)
      .put(`/media-governance/tasks/${taskId}/identity`)
      .send({
        expectedRevision: 1,
        providerRef: { provider: 'tmdb', providerId: '63145' },
      })
      .expect(409);
    await request(apiUrl)
      .put(`/media-governance/tasks/${taskId}/identity`)
      .send({
        expectedRevision: 2,
        providerRef: { provider: 'unknown', providerId: '../wrong' },
      })
      .expect(400);
    await request(apiUrl)
      .put(`/media-governance/tasks/${taskId}/identity`)
      .send({ expectedRevision: 2 })
      .expect(400);
  });

  it('supports keyword search, editable draft identity and revision-gated discard over real HTTP', async () => {
    const created = await request(apiUrl)
      .post('/media-governance/tasks')
      .send({
        mediaType: 'tv',
        providerRef: { provider: 'bangumi', providerId: 'crud-fixture' },
        releaseYear: 2025,
        seasonNumbers: ['S00'],
        titleHint: 'CRUD 草稿唯一标题',
        workItemId: 'media-963',
      })
      .expect(201);
    const taskId = created.body.data.id as string;

    const page = await request(apiUrl)
      .get('/media-governance/tasks/page')
      .query({ keyword: 'crud 草稿', pageNo: 1, pageSize: 20 })
      .expect(200);
    expect(page.body.data).toMatchObject({
      items: [expect.objectContaining({ id: taskId })],
      total: 1,
    });

    const updated = await request(apiUrl)
      .put(`/media-governance/tasks/${taskId}/identity`)
      .send({
        expectedRevision: 1,
        providerRef: null,
        releaseYear: null,
        titleHint: 'CRUD 草稿已更名',
      })
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(updated.body.data).toMatchObject({
      providerRef: null,
      releaseYear: null,
      revision: 2,
      titleHint: 'CRUD 草稿已更名',
    });

    await request(apiUrl)
      .post(`/media-governance/tasks/${taskId}/sources/magnet`)
      .send({
        contentKind: 'embedded_subtitle_media',
        expectedRevision: 2,
        magnetUri:
          'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
        sourceRole: 'primary_media',
      })
      .expect(201);

    await request(apiUrl)
      .delete(`/media-governance/tasks/${taskId}`)
      .query({ expectedRevision: 2 })
      .expect(409);
    const deleted = await request(apiUrl)
      .delete(`/media-governance/tasks/${taskId}`)
      .query({ expectedRevision: 3 })
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

  it('replaces, edits, and deletes a failed intake source over real HTTP', async () => {
    const created = await request(apiUrl)
      .post('/media-governance/tasks')
      .send({
        mediaType: 'tv',
        seasonNumbers: ['S01'],
        titleHint: '来源失败恢复接口测试',
      })
      .expect(201);
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

    const edited = await request(apiUrl)
      .put(`/media-governance/tasks/${taskId}/identity`)
      .send({ expectedRevision: 2, titleHint: '来源失败后已编辑' })
      .expect(200);
    expect(edited.body.data).toMatchObject({
      revision: 3,
      runState: 'blocked',
      titleHint: '来源失败后已编辑',
    });

    const removed = await request(apiUrl)
      .post(
        `/media-governance/tasks/${taskId}/sources/${failedSourceId}/remove`,
      )
      .send({ expectedRevision: 3 })
      .expect(201);
    expect(removed.body.data).toMatchObject({
      revision: 4,
      runState: 'draft',
      sources: [],
    });

    await request(apiUrl)
      .post(`/media-governance/tasks/${taskId}/sources/magnet`)
      .send({
        contentKind: 'embedded_subtitle_media',
        expectedRevision: 4,
        magnetUri:
          'magnet:?xt=urn:btih:fedcba9876543210fedcba9876543210fedcba98',
        sourceRole: 'primary_media',
      })
      .expect(201);
    await request(apiUrl)
      .delete(`/media-governance/tasks/${taskId}`)
      .query({ expectedRevision: 5 })
      .expect(200);
    await request(apiUrl).get(`/media-governance/tasks/${taskId}`).expect(404);
  });

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

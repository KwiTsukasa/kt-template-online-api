import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { MediaGovernanceExecutorInternalController } from '../../../src/modules/admin/media-governance/media-governance-executor-internal.controller';
import { MediaGovernanceExecutorInternalGuard } from '../../../src/modules/admin/media-governance/media-governance-executor-internal.guard';
import { MediaGovernanceService } from '../../../src/modules/admin/media-governance/media-governance.service';

describe('MediaGovernanceExecutorInternalController', () => {
  let app: INestApplication;
  const descriptor = Buffer.from('sealed-private-descriptor');
  const redeemDescriptor = jest.fn(async () => descriptor);
  const redeemPlan = jest.fn(async () => ({ schemaVersion: '1.2.0' }));
  const applyExecutorEvent = jest.fn(async () => ({
    applied: true,
    revision: 8,
  }));
  const secret = 'e'.repeat(64);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MediaGovernanceExecutorInternalController],
      providers: [
        MediaGovernanceExecutorInternalGuard,
        {
          provide: ConfigService,
          useValue: new ConfigService({
            MEDIA_GOVERNANCE_EXECUTOR_INTERNAL_SECRET: secret,
          }),
        },
        {
          provide: MediaGovernanceService,
          useValue: {
            applyExecutorEvent,
            executionCallbackHealth: () => ({
              persistenceMode: 'database',
              status: 'ready',
            }),
            redeemDescriptor,
            redeemPlan,
          },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => app.close());

  it('keeps the descriptor endpoint private and returns exact bytes once authenticated', async () => {
    const path = '/internal/media-governance/executor/descriptors/redeem';
    const body = {
      descriptorGrantId: 'media-run-fixture-0001',
      descriptorSha256: 'a'.repeat(64),
      runId: 'media-run-fixture-0001',
      sourceId: 'media-source-fixture-0001',
      taskId: 'media-task-fixture-0001',
    };

    await request(app.getHttpServer()).post(path).send(body).expect(403);
    const response = await request(app.getHttpServer())
      .post(path)
      .set('x-kt-media-executor-secret', secret)
      .send(body)
      .buffer(true)
      .parse((value, callback) => {
        const chunks: Buffer[] = [];
        value.on('data', (chunk: Buffer) => chunks.push(chunk));
        value.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect('Content-Type', 'application/octet-stream');

    expect(response.body).toEqual(descriptor);
    expect(redeemDescriptor).toHaveBeenCalledWith(body);
  });

  it('accepts one authenticated typed executor event and rejects unknown fields', async () => {
    const path = '/internal/media-governance/executor/events';
    const body = {
      action: 'source.probe-runtime',
      eventType: 'run-started',
      observedAt: new Date().toISOString(),
      runId: 'media-run-fixture-0001',
      sequence: 1,
      summary: '正在运行来源探针',
      taskId: 'media-task-fixture-0001',
      taskRevision: 7,
    };

    await request(app.getHttpServer()).post(path).send(body).expect(403);
    await request(app.getHttpServer())
      .post(path)
      .set('x-kt-media-executor-secret', secret)
      .send({ ...body, rawUri: 'must-not-pass' })
      .expect(400);
    await request(app.getHttpServer())
      .post(path)
      .set('x-kt-media-executor-secret', secret)
      .send(body)
      .expect(201)
      .expect({ applied: true, revision: 8 });
    expect(applyExecutorEvent).toHaveBeenCalledWith(body);
  });

  it('accepts semantic magnet manifest progress over real HTTP', async () => {
    const body = {
      action: 'source.inspect',
      eventType: 'peer-progress',
      observedAt: new Date().toISOString(),
      progress: {
        completedBytes: 5,
        completedItems: 0,
        etaLabel: '最多还需 115 秒',
        speedBytesPerSecond: 0,
        totalBytes: 120,
        totalItems: 0,
      },
      runId: 'media-run-fixture-0001',
      sequence: 2,
      sourceId: 'media-source-fixture-0001',
      summary: '正在获取磁链文件清单：已等待 5 秒，连接 0 个节点',
      taskId: 'media-task-fixture-0001',
      taskRevision: 7,
    };

    await request(app.getHttpServer())
      .post('/internal/media-governance/executor/events')
      .set('x-kt-media-executor-secret', secret)
      .send(body)
      .expect(201)
      .expect({ applied: true, revision: 8 });
    expect(applyExecutorEvent).toHaveBeenCalledWith(body);
  });

  it('returns one authenticated sealed plan without caching', async () => {
    const body = {
      planGrantId: 'media-plan-grant-fixture-0001',
      planSha256: 'b'.repeat(64),
      runId: 'media-run-fixture-0001',
      taskId: 'media-task-fixture-0001',
    };
    const response = await request(app.getHttpServer())
      .post('/internal/media-governance/executor/plans/redeem')
      .set('x-kt-media-executor-secret', secret)
      .send(body)
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(response.body).toEqual({ schemaVersion: '1.2.0' });
    expect(redeemPlan).toHaveBeenCalledWith(body);
  });
});

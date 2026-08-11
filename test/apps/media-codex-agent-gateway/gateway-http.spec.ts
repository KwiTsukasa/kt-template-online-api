import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { MediaCodexAgentGatewayService } from '../../../src/apps/media-codex-agent-gateway/application/media-codex-agent-gateway.service';
import { MediaCodexAgentGatewayConfigService } from '../../../src/apps/media-codex-agent-gateway/config/media-codex-agent-gateway-config.service';
import { MediaGovernanceCodexAgentGatewayClient } from '../../../src/modules/admin/media-governance/media-governance-codex-agent.gateway';
import { MediaCodexAgentController } from '../../../src/apps/media-codex-agent-gateway/presentation/media-codex-agent.controller';
import { MediaCodexAgentInternalGuard } from '../../../src/apps/media-codex-agent-gateway/presentation/media-codex-agent-internal.guard';

describe('MediaCodexAgentController', () => {
  let app: INestApplication;
  let apiUrl: string;
  const internalSecret = 'gateway-test-secret-value-at-least-32-bytes';
  const service = {
    health: jest.fn(async () => ({
      apiCallbackReady: true,
      appServerReady: true,
    })),
    session: jest.fn<unknown, []>(() => ({
      capsuleSha256: 'c'.repeat(64),
      checkpointSha256: 'd'.repeat(64),
      currentUnitId: 'media-unit-001',
      lastEventSequence: 2,
      lastHeartbeatAt: '2026-08-11T00:00:02.000Z',
      policySha256: 'b'.repeat(64),
      policyVersion: 'media-codex-agent-policy-v1',
      replayed: false,
      status: 'active',
      taskId: 'media-task-001',
      taskRevision: 7,
      threadId: 'thread-media-001',
      turnId: 'turn-media-001',
    })),
    startTurn: jest.fn(async (body) => ({
      replayed: false,
      taskId: body.taskId,
      threadId: 'thread-media-001',
    })),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MediaCodexAgentController],
      providers: [
        MediaCodexAgentInternalGuard,
        { provide: MediaCodexAgentGatewayService, useValue: service },
        {
          provide: MediaCodexAgentGatewayConfigService,
          useValue: { internalSecret: () => internalSecret },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        forbidNonWhitelisted: true,
        transform: true,
        whitelist: true,
      }),
    );
    await app.listen(0, '127.0.0.1');
    apiUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects missing internal authentication without invoking the gateway', async () => {
    await request(app.getHttpServer())
      .get('/internal/media-codex-agent/health')
      .expect(403);
    expect(service.startTurn).not.toHaveBeenCalled();
  });

  it('returns a safe health projection without login or raw protocol data', async () => {
    const response = await request(app.getHttpServer())
      .get('/internal/media-codex-agent/health')
      .set('x-kt-media-agent-secret', internalSecret)
      .expect(200);
    expect(response.body).toMatchObject({
      apiCallbackReady: true,
      loginStateExposed: false,
      rawProtocolExposed: false,
      writeBoundaries: { cloud: 0, formalMedia: 0 },
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /token|cookie|websocket/i,
    );
  });

  it('starts only a task-bound validated turn', async () => {
    const body = {
      compactContext: { title: '测试作品' },
      currentStage: 'metadata',
      currentUnitId: 'media-unit-001',
      manifestSha256: 'a'.repeat(64),
      operatorCommand: '核对当前任务',
      replayKey: 'media-agent-replay-001',
      taskId: 'media-task-001',
      taskRevision: 7,
    };
    await request(app.getHttpServer())
      .post('/internal/media-codex-agent/tasks/media-task-other/turns')
      .set('x-kt-media-agent-secret', internalSecret)
      .send(body)
      .expect(409);

    const response = await request(app.getHttpServer())
      .post('/internal/media-codex-agent/tasks/media-task-001/turns')
      .set('x-kt-media-agent-secret', internalSecret)
      .send(body)
      .expect(201);
    expect(response.body).toEqual({
      replayed: false,
      taskId: 'media-task-001',
      threadId: 'thread-media-001',
    });
  });

  it('serves the persisted Task/thread projection to the real API gateway client', async () => {
    const client = new MediaGovernanceCodexAgentGatewayClient(
      new ConfigService({
        MEDIA_CODEX_AGENT_GATEWAY_BASE_URL: apiUrl,
        MEDIA_CODEX_AGENT_INTERNAL_SECRET: internalSecret,
        MEDIA_CODEX_AGENT_GATEWAY_TIMEOUT_MS: '2000',
      }),
    );

    await expect(client.session('media-task-001')).resolves.toMatchObject({
      lastEventSequence: 2,
      status: 'active',
      taskId: 'media-task-001',
      threadId: 'thread-media-001',
    });
  });

  it('normalizes a session written by the previous gateway release', async () => {
    const legacySession: Record<string, unknown> = {
      ...(service.session() as Record<string, unknown>),
    };
    delete legacySession.lastEventSequence;
    service.session.mockReturnValueOnce(legacySession);
    const client = new MediaGovernanceCodexAgentGatewayClient(
      new ConfigService({
        MEDIA_CODEX_AGENT_GATEWAY_BASE_URL: apiUrl,
        MEDIA_CODEX_AGENT_INTERNAL_SECRET: internalSecret,
        MEDIA_CODEX_AGENT_GATEWAY_TIMEOUT_MS: '2000',
      }),
    );

    await expect(client.session('media-task-001')).resolves.toMatchObject({
      lastEventSequence: 0,
      taskId: 'media-task-001',
    });
  });
});

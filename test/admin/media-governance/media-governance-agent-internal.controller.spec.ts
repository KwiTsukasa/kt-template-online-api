import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { MediaCodexAgentGatewayConfigService } from '../../../src/apps/media-codex-agent-gateway/config/media-codex-agent-gateway-config.service';
import { MediaCodexAgentApiClient } from '../../../src/apps/media-codex-agent-gateway/infrastructure/media-codex-agent-api.client';
import { MediaGovernanceAgentInternalController } from '../../../src/modules/admin/media-governance/presentation/media-governance-agent-internal.controller';
import { MediaGovernanceAgentInternalGuard } from '../../../src/modules/admin/media-governance/presentation/media-governance-agent-internal.guard';
import { MediaGovernanceService } from '../../../src/modules/admin/media-governance/application/media-governance.service';

describe('MediaGovernanceAgentInternalController', () => {
  let app: INestApplication;
  let apiUrl: string;
  const internalSecret = 'api-callback-secret-value-at-least-32-bytes';
  const callbackHealth = jest.fn(() => ({
    persistenceMode: 'database',
    status: 'ready',
  }));
  const llmConversationContext = jest.fn(async (body) => ({
    identity: {
      activeTurnId: body.conversationTurnId,
      conversationId: body.conversationId,
      providerThreadId: body.providerThreadId,
      scene: 'media-governance',
      sceneRefId: body.taskId,
    },
    request: {
      clientMessageId: body.clientMessageId,
      compactContext: { title: '测试作品' },
      currentStage: 'metadata',
      currentUnitId: 'media-unit-001',
      manifestSha256: 'a'.repeat(64),
      model: body.model,
      operatorCommand: body.content,
      replayKey: 'media-replay-001',
      taskId: body.taskId,
      taskRevision: 7,
    },
  }));
  const applyLlmConversationResult = jest.fn(async () => ({
    applied: true,
    revision: 7,
  }));
  const bindLlmConversationProviderThread = jest.fn(async (body) => ({
    conversationId: body.conversationId,
    providerThreadId: body.providerThreadId,
    scene: 'media-governance',
    sceneRefId: body.taskId,
  }));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MediaGovernanceAgentInternalController],
      providers: [
        MediaGovernanceAgentInternalGuard,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'LLM_CODEX_GATEWAY_INTERNAL_SECRET'
                ? internalSecret
                : undefined,
          },
        },
        {
          provide: MediaGovernanceService,
          useValue: {
            agentCallbackHealth: callbackHealth,
            applyLlmConversationResult,
            bindLlmConversationProviderThread,
            llmConversationContext,
          },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    apiUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  it('fails closed without the internal secret', async () => {
    await request(app.getHttpServer())
      .get('/internal/media-governance/agent/health')
      .expect(403);
  });

  it('returns only bounded callback readiness with internal authentication', async () => {
    const response = await request(app.getHttpServer())
      .get('/internal/media-governance/agent/health')
      .set('x-kt-llm-gateway-secret', internalSecret)
      .expect(200);

    expect(response.body).toEqual({
      persistenceMode: 'database',
      status: 'ready',
      writeBoundaries: {
        cloud: 0,
        database: 0,
        formalMedia: 0,
        ui: 0,
      },
    });
    expect(JSON.stringify(response.body)).not.toMatch(/secret|token|cookie/i);
  });

  it('is accepted by the real gateway callback client', async () => {
    const config = {
      apiBaseUrl: () => apiUrl,
      internalSecret: () => internalSecret,
      timeoutMs: () => 2_000,
    } as MediaCodexAgentGatewayConfigService;

    await expect(
      new MediaCodexAgentApiClient(config).health(),
    ).resolves.toEqual({
      persistenceMode: 'database',
      status: 'ready',
    });
  });

  it('serves media context and result callbacks for one bound LLM conversation', async () => {
    const contextBody = {
      clientMessageId: 'client-message-media-context',
      content: '分析当前任务',
      conversationId: '2041700000000190001',
      conversationTurnId: 'conversation-turn-media-context',
      model: 'gpt-test',
      providerThreadId: null,
      taskId: 'media-task-001',
    };
    const context = await request(app.getHttpServer())
      .post('/internal/media-governance/agent/llm-conversations/context')
      .set('x-kt-llm-gateway-secret', internalSecret)
      .send(contextBody)
      .expect(201);
    expect(context.body).toMatchObject({
      identity: {
        conversationId: '2041700000000190001',
        providerThreadId: null,
        sceneRefId: 'media-task-001',
      },
      request: { model: 'gpt-test', taskId: 'media-task-001' },
    });
    expect(llmConversationContext).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: '2041700000000190001',
      }),
    );

    await request(app.getHttpServer())
      .post(
        '/internal/media-governance/agent/llm-conversations/provider-thread',
      )
      .set('x-kt-llm-gateway-secret', internalSecret)
      .send({
        conversationId: '2041700000000190001',
        conversationTurnId: 'conversation-turn-media-context',
        expectedProviderThreadId: null,
        providerThreadId: 'thread-media-codex-001',
        taskId: 'media-task-001',
      })
      .expect(201);
    expect(bindLlmConversationProviderThread).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedProviderThreadId: null,
        providerThreadId: 'thread-media-codex-001',
      }),
    );

    await request(app.getHttpServer())
      .post('/internal/media-governance/agent/llm-conversations/result')
      .set('x-kt-llm-gateway-secret', internalSecret)
      .send({
        conversationId: '2041700000000190001',
        conversationTurnId: 'conversation-turn-media-context',
        providerThreadId: 'thread-media-codex-001',
        result: {
          candidateSummaries: [],
          nextActionLabel: '继续核对',
          planSha256: null,
          status: 'conversation-response',
          summary: '分析完成',
        },
        taskId: 'media-task-001',
      })
      .expect(201);
    expect(applyLlmConversationResult).toHaveBeenCalled();
  });

  it('is rejected by the gateway client while the API still uses process-only state', async () => {
    callbackHealth.mockReturnValueOnce({
      persistenceMode: 'process-simulator',
      status: 'not-ready',
    });
    const config = {
      apiBaseUrl: () => apiUrl,
      internalSecret: () => internalSecret,
      timeoutMs: () => 2_000,
    } as MediaCodexAgentGatewayConfigService;

    await expect(new MediaCodexAgentApiClient(config).health()).rejects.toThrow(
      'media-codex-agent-api-health-invalid',
    );
  });
});

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { LlmCodexChatService } from '../../../src/apps/llm-codex-gateway/application/llm-codex-chat.service';
import { LlmCodexGatewayConfigService } from '../../../src/apps/llm-codex-gateway/config/llm-codex-gateway-config.service';
import { LlmCodexChatController } from '../../../src/apps/llm-codex-gateway/presentation/llm-codex-chat.controller';
import { LlmCodexInternalGuard } from '../../../src/apps/llm-codex-gateway/presentation/llm-codex-internal.guard';

const codexModel = (id: string, label: string) => ({
  defaultReasoningEffort: null,
  defaultServiceTier: null,
  id,
  label,
  reasoningEfforts: [],
  serviceTiers: [],
});

describe('LlmCodexChatController', () => {
  let app: INestApplication;
  const internalSecret = 'llm-gateway-test-secret-value-32-bytes';
  const service = {
    health: jest.fn(async () => ({
      appServerReady: true,
      appServerTransport: 'unix',
      networkAccess: true,
      permissionProfile: 'llm-codex',
      status: 'ready',
    })),
    models: jest.fn(async () => ({
      items: [
        codexModel('gpt-test', 'GPT Test'),
        codexModel('gpt-fallback', 'GPT Fallback'),
      ],
    })),
    stream: jest.fn(() =>
      codexEvents([
        { model: 'gpt-test', threadId: 'thread-test-001', type: 'start' },
        { content: '本地 Codex', type: 'text-delta' },
        {
          finishReason: 'stop',
          model: 'gpt-test',
          threadId: 'thread-test-001',
          type: 'done',
        },
      ]),
    ),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [LlmCodexChatController],
      providers: [
        LlmCodexInternalGuard,
        { provide: LlmCodexChatService, useValue: service },
        {
          provide: LlmCodexGatewayConfigService,
          useValue: { llmInternalSecret: () => internalSecret },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a request when the LLM gateway secret is missing', async () => {
    await request(app.getHttpServer())
      .post('/internal/llm-codex/chat/stream')
      .send(streamRequest())
      .expect(403);
    expect(service.stream).not.toHaveBeenCalled();
  });

  it('exposes one unified networked gateway health contract', async () => {
    const response = await request(app.getHttpServer())
      .get('/internal/llm-codex/health')
      .set('x-kt-llm-gateway-secret', internalSecret)
      .expect(200);
    expect(response.body).toMatchObject({
      appServerReady: true,
      networkAccess: true,
      permissionProfile: 'llm-codex',
      status: 'ready',
    });
  });

  it('protects model discovery with the dedicated internal secret', async () => {
    await request(app.getHttpServer())
      .get('/internal/llm-codex/models')
      .expect(403);
    expect(service.models).not.toHaveBeenCalled();
  });

  it('returns the exact normalized model discovery contract', async () => {
    const response = await request(app.getHttpServer())
      .get('/internal/llm-codex/models')
      .set('x-kt-llm-gateway-secret', internalSecret)
      .expect(200);
    expect(response.body).toEqual({
      items: [
        codexModel('gpt-test', 'GPT Test'),
        codexModel('gpt-fallback', 'GPT Fallback'),
      ],
    });
    expect(service.models).toHaveBeenCalledTimes(1);
  });

  it('maps raw model protocol failures to one safe HTTP error', async () => {
    service.models.mockRejectedValueOnce(
      new Error('raw protocol body with local socket details'),
    );

    const response = await request(app.getHttpServer())
      .get('/internal/llm-codex/models')
      .set('x-kt-llm-gateway-secret', internalSecret)
      .expect(503);
    expect(response.body.message).toBe('llm-codex-models-unavailable');
    expect(JSON.stringify(response.body)).not.toContain('raw protocol body');
    expect(JSON.stringify(response.body)).not.toContain('socket details');
  });

  it('streams normalized Codex events through the dedicated internal secret', async () => {
    const response = await request(app.getHttpServer())
      .post('/internal/llm-codex/chat/stream')
      .set('x-kt-llm-gateway-secret', internalSecret)
      .send(streamRequest())
      .buffer(true)
      .parse((incoming, callback) => {
        let body = '';
        incoming.on('data', (chunk) => {
          body += chunk.toString();
        });
        incoming.on('end', () => callback(null, body));
      })
      .expect('content-type', /text\/event-stream/)
      .expect(200);
    expect(response.body).toContain('event: start');
    expect(response.body).toContain('event: text-delta');
    expect(response.body).toContain('event: done');
    const streamCall = service.stream.mock.calls.at(-1) as
      | undefined
      | unknown[];
    expect(streamCall?.[0]).toMatchObject({
      reasoningEffort: 'high',
      serviceTier: 'priority',
    });
  });
});

/**
 * 生成符合网关 DTO 约束的测试请求体。
 * @returns 模型、推理/速度档位、正文和客户端消息标识。
 */
function streamRequest() {
  return {
    clientMessageId: 'client-message-codex-http',
    model: 'gpt-test',
    prompt: '测试本地 Codex',
    reasoningEffort: 'high',
    serviceTier: 'priority',
  };
}

/**
 * 按传入顺序生成私有网关 SSE 事件。
 * @param events - 要发送的稳定事件数组。
 * @returns 可被控制器消费的异步事件流。
 */
async function* codexEvents(events: Array<Record<string, unknown>>) {
  for (const event of events) yield event;
}

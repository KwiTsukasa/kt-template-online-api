import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { TrustedCredentialTransportService } from '../../../src/common/security/trusted-credential-transport.service';
import { AdminSuperGuard } from '../../../src/modules/admin/identity/auth/presentation/admin-super.guard';
import { JwtAuthGuard } from '../../../src/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { LlmConfigService } from '../../../src/modules/admin/llm/application/llm-config.service';
import { LlmConversationService } from '../../../src/modules/admin/llm/application/llm-conversation.service';
import { LlmController } from '../../../src/modules/admin/llm/presentation/llm.controller';

describe('LlmController', () => {
  let app: INestApplication;
  let apiUrl: string;
  const liveModel = {
    defaultReasoningEffort: 'high',
    defaultServiceTier: null,
    id: 'gpt-live',
    label: 'GPT Live',
    reasoningEfforts: [{ id: 'high', label: 'High' }],
    serviceTiers: [{ id: 'priority', label: 'Fast' }],
  };
  const configs = {
    create: jest.fn(),
    detail: jest.fn(),
    list: jest.fn(),
    models: jest.fn(),
    providerCatalog: jest.fn(),
    remove: jest.fn(),
    setDefault: jest.fn(),
    setEnabled: jest.fn(),
    summary: jest.fn(),
    testConnection: jest.fn(),
    update: jest.fn(),
  };
  const conversations = {
    create: jest.fn(),
    detail: jest.fn(),
    list: jest.fn(),
    prepareStream: jest.fn(),
    remove: jest.fn(),
  };
  const trustedTransport = { assertTrusted: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [LlmController],
      providers: [
        { provide: LlmConfigService, useValue: configs },
        { provide: LlmConversationService, useValue: conversations },
        {
          provide: TrustedCredentialTransportService,
          useValue: trustedTransport,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminSuperGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    apiUrl = await app.getUrl();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    configs.providerCatalog.mockReturnValue([]);
    configs.list.mockResolvedValue({ items: [], total: 0 });
    configs.summary.mockResolvedValue({
      connected: 0,
      disabled: 0,
      error: 0,
      total: 0,
    });
    configs.create.mockResolvedValue({ id: '100' });
    configs.models.mockResolvedValue({
      fetchedAt: '2026-08-21T00:00:00.000Z',
      items: [liveModel],
      provider: 'openai',
    });
    conversations.list.mockResolvedValue([]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('exposes provider, summary and paged config routes with no-store', async () => {
    await request(apiUrl)
      .get('/llm/providers')
      .expect(200)
      .expect('Cache-Control', 'no-store');
    await request(apiUrl)
      .get('/llm/configs/summary')
      .expect(200)
      .expect('Cache-Control', 'no-store');
    await request(apiUrl)
      .get('/llm/configs?pageNo=1&pageSize=20')
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(configs.list).toHaveBeenCalledWith(
      expect.objectContaining({ pageNo: 1, pageSize: 20 }),
    );
    const models = await request(apiUrl)
      .get('/llm/configs/100/models')
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(models.body.data).toEqual({
      fetchedAt: '2026-08-21T00:00:00.000Z',
      items: [liveModel],
      provider: 'openai',
    });
    expect(configs.models).toHaveBeenCalledWith('100');
  });

  it('rejects unknown config fields and protects valid API Key writes', async () => {
    await request(apiUrl)
      .post('/llm/configs')
      .send({
        apiKey: 'secret',
        baseUrl: 'https://api.openai.com/v1',
        enabled: true,
        isDefault: true,
        name: '测试连接',
        provider: 'openai',
        rawToken: 'must-not-pass',
      })
      .expect(400);
    const response = await request(apiUrl)
      .post('/llm/configs')
      .send({
        apiKey: 'secret',
        baseUrl: 'https://api.openai.com/v1',
        enabled: true,
        isDefault: true,
        name: '测试连接',
        provider: 'openai',
      })
      .expect(201)
      .expect('Cache-Control', 'no-store');
    expect(response.body.data.id).toBe('100');
    expect(trustedTransport.assertTrusted).toHaveBeenCalledTimes(1);
    expect(configs.create).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'secret', provider: 'openai' }),
    );
  });

  it('streams two text deltas and completion through a real POST SSE route', async () => {
    conversations.prepareStream.mockResolvedValue(
      streamEvents([
        {
          assistantMessageId: 'assistant-1',
          model: 'gpt-test',
          turnId: 'turn-1',
          type: 'start',
          userMessageId: 'user-1',
        },
        {
          assistantMessageId: 'assistant-1',
          content: '第一段',
          turnId: 'turn-1',
          type: 'text-delta',
        },
        {
          assistantMessageId: 'assistant-1',
          content: '第二段',
          turnId: 'turn-1',
          type: 'text-delta',
        },
        {
          assistantMessageId: 'assistant-1',
          finishReason: 'stop',
          model: 'gpt-test',
          turnId: 'turn-1',
          type: 'done',
        },
      ]),
    );
    const response = await request(apiUrl)
      .post('/llm/conversations/2041700000000100001/messages/stream')
      .send({
        clientMessageId: 'client-message-001',
        content: '你好',
        model: 'gpt-test',
      })
      .buffer(true)
      .parse((incoming, callback) => {
        let body = '';
        incoming.on('data', (chunk) => {
          body += chunk.toString();
        });
        incoming.on('end', () => callback(null, body));
      })
      .expect('content-type', /text\/event-stream/)
      .expect('x-accel-buffering', 'no')
      .expect(200);
    expect(response.body).toContain('event: text-delta');
    expect(response.body).toContain('第一段');
    expect(response.body).toContain('第二段');
    expect(response.body).toContain('event: done');
    expect(conversations.prepareStream).toHaveBeenCalledWith(
      '2041700000000100001',
      expect.objectContaining({ model: 'gpt-test' }),
      expect.any(AbortSignal),
    );
  });
});

/**
 * 将固定事件数组转换为控制器测试可消费的异步 SSE 事件源。
 * @param events - 按发送顺序排列的统一事件对象。
 * @returns 逐项产出输入事件的异步生成器。
 */
async function* streamEvents(events: Array<Record<string, unknown>>) {
  for (const event of events) yield event;
}

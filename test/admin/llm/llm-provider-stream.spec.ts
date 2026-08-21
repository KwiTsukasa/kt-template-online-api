import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { ConfigService } from '@nestjs/config';
import { AnthropicAdapter } from '../../../src/modules/admin/llm/infrastructure/integration/anthropic.adapter';
import { CodexGatewayAdapter } from '../../../src/modules/admin/llm/infrastructure/integration/codex-gateway.adapter';
import { OpenAiCompatibleAdapter } from '../../../src/modules/admin/llm/infrastructure/integration/openai-compatible.adapter';
import type { LlmNormalizedStreamEvent } from '../../../src/modules/admin/llm/contract/llm.types';

const plainModel = (id: string, label: string) => ({
  defaultReasoningEffort: null,
  defaultServiceTier: null,
  id,
  label,
  reasoningEfforts: [],
  serviceTiers: [],
});

describe('LLM provider adapters', () => {
  it('discovers OpenAI and DeepSeek models with Bearer auth, provider paths and ID deduplication', async () => {
    const observed: Array<{
      authorization: string;
      method: string;
      url: string;
    }> = [];
    const server = await startServer(async (request, response) => {
      observed.push({
        authorization: String(request.headers.authorization || ''),
        method: String(request.method || ''),
        url: String(request.url || ''),
      });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          data: [
            { id: ' model-live-1 ' },
            { id: '' },
            { id: 'model-live-1' },
            { id: 'model-live-2' },
          ],
        }),
      );
    });
    try {
      const adapter = new OpenAiCompatibleAdapter();
      await expect(
        adapter.fetchModels({
          apiKey: 'openai-key',
          baseUrl: `${server.url}/v1`,
          provider: 'openai',
        }),
      ).resolves.toEqual([
        plainModel('model-live-1', 'model-live-1'),
        plainModel('model-live-2', 'model-live-2'),
      ]);
      await expect(
        adapter.fetchModels({
          apiKey: 'deepseek-key',
          baseUrl: server.url,
          provider: 'deepseek',
        }),
      ).resolves.toHaveLength(2);
      expect(observed).toEqual([
        {
          authorization: 'Bearer openai-key',
          method: 'GET',
          url: '/v1/models',
        },
        {
          authorization: 'Bearer deepseek-key',
          method: 'GET',
          url: '/models',
        },
      ]);
    } finally {
      await server.close();
    }
  });

  it('discovers and deduplicates Anthropic models across bounded after_id pages', async () => {
    const observed: Array<{
      anthropicVersion: string;
      apiKey: string;
      url: string;
    }> = [];
    const server = await startServer(async (request, response) => {
      const url = String(request.url || '');
      observed.push({
        anthropicVersion: String(request.headers['anthropic-version'] || ''),
        apiKey: String(request.headers['x-api-key'] || ''),
        url,
      });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      if (url.includes('after_id=cursor-a')) {
        response.end(
          JSON.stringify({
            data: [
              {
                capabilities: {
                  effort: {
                    high: { supported: true },
                    max: { supported: true },
                    supported: true,
                  },
                },
                display_name: '重复展示名',
                id: 'claude-live-a',
              },
              {
                capabilities: {
                  effort: {
                    high: { supported: true },
                    supported: true,
                  },
                },
                display_name: '',
                id: ' claude-live-b ',
              },
            ],
            has_more: false,
            last_id: 'cursor-b',
          }),
        );
        return;
      }
      response.end(
        JSON.stringify({
          data: [
            {
              capabilities: {
                effort: {
                  high: { supported: true },
                  low: { supported: true },
                  supported: true,
                  xhigh: { supported: false },
                },
              },
              display_name: ' Claude Live A ',
              id: ' claude-live-a ',
            },
            { display_name: '空模型', id: '' },
          ],
          has_more: true,
          last_id: 'cursor-a',
        }),
      );
    });
    try {
      await expect(
        new AnthropicAdapter().fetchModels({
          apiKey: 'anthropic-key',
          baseUrl: `${server.url}/v1`,
          provider: 'anthropic',
        }),
      ).resolves.toEqual([
        {
          defaultReasoningEffort: 'high',
          defaultServiceTier: null,
          id: 'claude-live-a',
          label: 'Claude Live A',
          reasoningEfforts: [
            { id: 'high', label: 'high' },
            { id: 'low', label: 'low' },
          ],
          serviceTiers: [],
        },
        {
          defaultReasoningEffort: 'high',
          defaultServiceTier: null,
          id: 'claude-live-b',
          label: 'claude-live-b',
          reasoningEfforts: [{ id: 'high', label: 'high' }],
          serviceTiers: [],
        },
      ]);
      expect(observed).toEqual([
        {
          anthropicVersion: '2023-06-01',
          apiKey: 'anthropic-key',
          url: '/v1/models?limit=1000',
        },
        {
          anthropicVersion: '2023-06-01',
          apiKey: 'anthropic-key',
          url: '/v1/models?limit=1000&after_id=cursor-a',
        },
      ]);
    } finally {
      await server.close();
    }
  });

  it('fails closed on an Anthropic pagination cursor loop', async () => {
    const server = await startServer(async (_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          data: [{ display_name: 'Claude Loop', id: 'claude-loop' }],
          has_more: true,
          last_id: 'loop-cursor',
        }),
      );
    });
    try {
      await expect(
        new AnthropicAdapter().fetchModels({
          apiKey: 'anthropic-key',
          baseUrl: `${server.url}/v1`,
          provider: 'anthropic',
        }),
      ).rejects.toThrow('分页游标不合法');
    } finally {
      await server.close();
    }
  });

  it('does not echo model API credentials or response bodies on failure', async () => {
    const server = await startServer(async (_request, response) => {
      response.writeHead(401, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          error: { message: 'raw-response-marker openai-secret-key' },
        }),
      );
    });
    let message = '';
    try {
      await new OpenAiCompatibleAdapter().fetchModels({
        apiKey: 'openai-secret-key',
        baseUrl: `${server.url}/v1`,
        provider: 'openai',
      });
    } catch (error) {
      if (error instanceof Error) message = error.message;
    } finally {
      await server.close();
    }
    expect(message).toContain('HTTP 401');
    expect(message).not.toContain('openai-secret-key');
    expect(message).not.toContain('raw-response-marker');
  });

  it('discovers Codex models with the existing internal header', async () => {
    const observed: { secret?: string; url?: string } = {};
    const server = await startServer(async (request, response) => {
      observed.secret = String(
        request.headers['x-kt-llm-gateway-secret'] || '',
      );
      observed.url = String(request.url || '');
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          items: [
            {
              defaultReasoningEffort: 'high',
              defaultServiceTier: null,
              id: ' gpt-codex-live ',
              label: ' GPT Codex Live ',
              reasoningEfforts: [{ id: 'high', label: 'High' }],
              serviceTiers: [{ id: 'priority', label: 'Fast' }],
            },
            { id: 'gpt-codex-live', label: '重复项' },
          ],
        }),
      );
    });
    try {
      const adapter = new CodexGatewayAdapter(
        new ConfigService({
          LLM_CODEX_GATEWAY_INTERNAL_SECRET: 'x'.repeat(32),
        }),
      );
      await expect(
        adapter.fetchModels({
          apiKey: '',
          baseUrl: `${server.url}/internal/llm-codex`,
          provider: 'codex',
        }),
      ).resolves.toEqual([
        {
          defaultReasoningEffort: 'high',
          defaultServiceTier: null,
          id: 'gpt-codex-live',
          label: 'GPT Codex Live',
          reasoningEfforts: [{ id: 'high', label: 'High' }],
          serviceTiers: [{ id: 'priority', label: 'Fast' }],
        },
      ]);
      expect(observed).toEqual({
        secret: 'x'.repeat(32),
        url: '/internal/llm-codex/models',
      });
    } finally {
      await server.close();
    }
  });

  it('parses OpenAI-compatible reasoning, multiple text deltas, usage and DONE from real HTTP SSE', async () => {
    const observed: { authorization?: string; body?: Record<string, unknown> } =
      {};
    const server = await startServer(async (request, response) => {
      observed.authorization = String(request.headers.authorization || '');
      observed.body = JSON.parse(await readBody(request));
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write(
        'data: {"model":"glm-test","choices":[{"delta":{"reasoning_content":"思考"},"finish_reason":null}]}\n\n',
      );
      response.write(
        'data: {"model":"glm-test","choices":[{"delta":{"content":"连接"},"finish_reason":null}]}\n\n',
      );
      response.write(
        'data: {"model":"glm-test","choices":[{"delta":{"content":"成功"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n',
      );
      response.end('data: [DONE]\n\n');
    });
    try {
      const events = await collect(
        new OpenAiCompatibleAdapter().stream({
          clientMessageId: 'client-message-openai',
          config: {
            apiKey: 'test-key',
            baseUrl: `${server.url}/v1`,
            provider: 'zhipu',
          },
          messages: [{ content: '测试', role: 'user' }],
          model: 'glm-test',
          reasoningEffort: 'high',
          serviceTier: 'priority',
          signal: new AbortController().signal,
        }),
      );
      expect(observed.authorization).toBe('Bearer test-key');
      expect(observed.body).toMatchObject({
        model: 'glm-test',
        reasoning_effort: 'high',
        service_tier: 'priority',
        stream: true,
      });
      expect(events.map((event) => event.type)).toEqual([
        'start',
        'reasoning-delta',
        'text-delta',
        'text-delta',
        'done',
      ]);
      expect(events[4]).toMatchObject({
        finishReason: 'stop',
        model: 'glm-test',
        usage: { completionTokens: 2, promptTokens: 3, totalTokens: 5 },
      });
    } finally {
      await server.close();
    }
  });

  it('parses Anthropic named SSE text and cumulative usage', async () => {
    let observedBody: Record<string, unknown> = {};
    const server = await startServer(async (request, response) => {
      observedBody = JSON.parse(await readBody(request));
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write(
        'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-test","usage":{"input_tokens":4,"output_tokens":1}}}\n\n',
      );
      response.write(
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"第一段"}}\n\n',
      );
      response.write(
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"第二段"}}\n\n',
      );
      response.write(
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}\n\n',
      );
      response.end('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    });
    try {
      const events = await collect(
        new AnthropicAdapter().stream({
          clientMessageId: 'client-message-anthropic',
          config: {
            apiKey: 'anthropic-key',
            baseUrl: `${server.url}/v1`,
            provider: 'anthropic',
          },
          messages: [{ content: '测试', role: 'user' }],
          model: 'claude-test',
          reasoningEffort: 'medium',
          serviceTier: 'auto',
          signal: new AbortController().signal,
        }),
      );
      expect(events.map((event) => event.type)).toEqual([
        'start',
        'text-delta',
        'text-delta',
        'done',
      ]);
      expect(observedBody).toMatchObject({
        output_config: { effort: 'medium' },
        service_tier: 'auto',
      });
      expect(events[3]).toMatchObject({
        finishReason: 'end_turn',
        usage: { inputTokens: 4, outputTokens: 3 },
      });
    } finally {
      await server.close();
    }
  });

  it('forwards normalized private Codex gateway events with internal auth', async () => {
    const observed: { body?: Record<string, unknown>; secret?: string } = {};
    const server = await startServer(async (request, response) => {
      observed.secret = String(
        request.headers['x-kt-llm-gateway-secret'] || '',
      );
      observed.body = JSON.parse(await readBody(request));
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write(
        'event: start\ndata: {"model":"gpt-test","threadId":"thread-test-001"}\n\n',
      );
      response.write('event: text-delta\ndata: {"content":"本地"}\n\n');
      response.write('event: text-delta\ndata: {"content":" Codex"}\n\n');
      response.end(
        'event: done\ndata: {"model":"gpt-test","threadId":"thread-test-001","finishReason":"stop"}\n\n',
      );
    });
    try {
      const adapter = new CodexGatewayAdapter(
        new ConfigService({
          LLM_CODEX_GATEWAY_INTERNAL_SECRET: 'x'.repeat(32),
        }),
      );
      const events = await collect(
        adapter.stream({
          clientMessageId: 'client-message-codex',
          config: {
            apiKey: '',
            baseUrl: `${server.url}/internal/llm-codex`,
            provider: 'codex',
          },
          messages: [{ content: '测试本地 Codex', role: 'user' }],
          model: 'gpt-test',
          reasoningEffort: 'xhigh',
          serviceTier: 'priority',
          signal: new AbortController().signal,
        }),
      );
      expect(observed.secret).toBe('x'.repeat(32));
      expect(observed.body).toMatchObject({
        reasoningEffort: 'xhigh',
        serviceTier: 'priority',
      });
      expect(events.map((event) => event.type)).toEqual([
        'start',
        'text-delta',
        'text-delta',
        'done',
      ]);
      expect(events[0]).toMatchObject({ providerThreadId: 'thread-test-001' });
    } finally {
      await server.close();
    }
  });

  it('rejects a private Codex gateway stream that closes before done', async () => {
    const server = await startServer(async (request, response) => {
      await readBody(request);
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.end(
        'event: start\ndata: {"model":"gpt-test","threadId":"thread-test-001"}\n\n',
      );
    });
    try {
      const adapter = new CodexGatewayAdapter(
        new ConfigService({
          LLM_CODEX_GATEWAY_INTERNAL_SECRET: 'x'.repeat(32),
        }),
      );
      await expect(
        collect(
          adapter.stream({
            clientMessageId: 'client-message-codex-incomplete',
            config: {
              apiKey: '',
              baseUrl: `${server.url}/internal/llm-codex`,
              provider: 'codex',
            },
            messages: [{ content: '测试本地 Codex', role: 'user' }],
            model: 'gpt-test',
            signal: new AbortController().signal,
          }),
        ),
      ).rejects.toThrow('缺少 done 事件');
    } finally {
      await server.close();
    }
  });
});

/**
 * 完整消费统一供应商流以便断言事件顺序和终态。
 * @param stream - 待消费的统一异步事件流。
 * @returns 按产出顺序收集的全部流事件。
 */
async function collect(stream: AsyncGenerator<LlmNormalizedStreamEvent>) {
  const events: LlmNormalizedStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

/**
 * 读取测试 HTTP 请求的完整 UTF-8 正文。
 * @param request - Node 测试服务器收到的请求流。
 * @returns 请求结束后拼接的正文文本。
 */
async function readBody(request: IncomingMessage) {
  let body = '';
  for await (const chunk of request) body += chunk.toString();
  return body;
}

/**
 * 启动仅绑定 IPv4 回环地址的临时 HTTP 服务器。
 * @param handler - 处理单次测试请求并写入响应的异步函数。
 * @returns 可关闭的临时服务器地址与清理函数。
 * @throws 监听成功后仍无法取得 TCP 地址时抛出错误。
 */
async function startServer(
  handler: (
    request: IncomingMessage,
    response: ServerResponse,
  ) => Promise<void>,
) {
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('test-server-address-invalid');
  }
  return {
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    url: `http://127.0.0.1:${address.port}`,
  };
}

import { LlmCodexChatService } from '../../../src/apps/media-codex-agent-gateway/application/llm-codex-chat.service';
import { UnixWebSocketRpcTransport } from '../../../src/apps/media-codex-agent-gateway/infrastructure/codex-app-server.client';

describe('LlmCodexChatService unified runtime boundary', () => {
  const config = {
    appServerSocketPath: () => '/tmp/kt-codex-app-server.sock',
    chatCwd: () => '/tmp/kt-llm-codex',
    timeoutMs: () => 1_000,
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('discovers, filters and deduplicates paginated App Server models', async () => {
    const connect = jest
      .spyOn(UnixWebSocketRpcTransport.prototype, 'connect')
      .mockResolvedValue(undefined);
    const notify = jest
      .spyOn(UnixWebSocketRpcTransport.prototype, 'notify')
      .mockResolvedValue(undefined);
    const close = jest
      .spyOn(UnixWebSocketRpcTransport.prototype, 'close')
      .mockImplementation(() => undefined);
    let modelPage = 0;
    const rpcRequest = jest
      .spyOn(UnixWebSocketRpcTransport.prototype, 'request')
      .mockImplementation(async (method) => {
        if (method === 'initialize') return {};
        modelPage += 1;
        if (modelPage === 1) {
          return {
            data: [
              {
                defaultReasoningEffort: 'high',
                defaultServiceTier: null,
                displayName: 'Model A',
                hidden: false,
                id: 'upstream-model-a',
                model: 'model-a',
                serviceTiers: [
                  { description: 'faster', id: 'priority', name: 'Fast' },
                ],
                supportedReasoningEfforts: [
                  { description: 'lighter', reasoningEffort: 'low' },
                  { description: 'deeper', reasoningEffort: 'high' },
                ],
              },
              {
                defaultReasoningEffort: null,
                defaultServiceTier: null,
                displayName: '',
                hidden: false,
                id: 'fallback-model',
                model: '   ',
                serviceTiers: [],
                supportedReasoningEfforts: [],
              },
              {
                defaultReasoningEffort: null,
                defaultServiceTier: null,
                displayName: 'Hidden Model',
                hidden: true,
                id: 'hidden-model',
                model: 'hidden-model',
                serviceTiers: [],
                supportedReasoningEfforts: [],
              },
              {
                defaultReasoningEffort: null,
                defaultServiceTier: null,
                displayName: 'Duplicate Model A',
                hidden: false,
                id: 'duplicate-source',
                model: 'model-a',
                serviceTiers: [],
                supportedReasoningEfforts: [],
              },
              {
                defaultReasoningEffort: null,
                defaultServiceTier: null,
                displayName: 'Blank Model',
                hidden: false,
                id: '   ',
                model: '',
                serviceTiers: [],
                supportedReasoningEfforts: [],
              },
            ],
            nextCursor: 'models-page-2',
          };
        }
        return {
          data: [
            {
              defaultReasoningEffort: 'medium',
              defaultServiceTier: null,
              displayName: ' Model B ',
              hidden: false,
              id: 'model-b-source',
              model: ' model-b ',
              serviceTiers: [],
              supportedReasoningEfforts: [
                { description: 'balanced', reasoningEffort: 'medium' },
              ],
            },
          ],
          nextCursor: null,
        };
      });
    const service = new LlmCodexChatService(config as never, {} as never);

    await expect(service.models()).resolves.toEqual({
      items: [
        {
          defaultReasoningEffort: 'high',
          defaultServiceTier: null,
          id: 'model-a',
          label: 'Model A',
          reasoningEfforts: [
            { id: 'low', label: 'low' },
            { id: 'high', label: 'high' },
          ],
          serviceTiers: [{ id: 'priority', label: 'Fast' }],
        },
        {
          defaultReasoningEffort: null,
          defaultServiceTier: null,
          id: 'fallback-model',
          label: 'fallback-model',
          reasoningEfforts: [],
          serviceTiers: [],
        },
        {
          defaultReasoningEffort: 'medium',
          defaultServiceTier: null,
          id: 'model-b',
          label: 'Model B',
          reasoningEfforts: [{ id: 'medium', label: 'medium' }],
          serviceTiers: [],
        },
      ],
    });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(rpcRequest).toHaveBeenNthCalledWith(
      1,
      'initialize',
      expect.objectContaining({
        capabilities: expect.objectContaining({ experimentalApi: true }),
      }),
    );
    expect(notify).toHaveBeenCalledWith('initialized');
    expect(rpcRequest).toHaveBeenNthCalledWith(2, 'model/list', {
      cursor: undefined,
      includeHidden: false,
      limit: 100,
    });
    expect(rpcRequest).toHaveBeenNthCalledWith(3, 'model/list', {
      cursor: 'models-page-2',
      includeHidden: false,
      limit: 100,
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('creates a distinct Unix-WebSocket transport for every model request', async () => {
    const transports = new Set<UnixWebSocketRpcTransport>();
    jest
      .spyOn(UnixWebSocketRpcTransport.prototype, 'connect')
      .mockImplementation(async function () {
        transports.add(this);
      });
    jest
      .spyOn(UnixWebSocketRpcTransport.prototype, 'notify')
      .mockResolvedValue(undefined);
    jest
      .spyOn(UnixWebSocketRpcTransport.prototype, 'close')
      .mockImplementation(() => undefined);
    jest
      .spyOn(UnixWebSocketRpcTransport.prototype, 'request')
      .mockImplementation(async (method) => {
        if (method === 'initialize') return {};
        return {
          data: [
            {
              defaultReasoningEffort: null,
              defaultServiceTier: null,
              displayName: 'Model A',
              hidden: false,
              id: 'model-a',
              model: 'model-a',
              serviceTiers: [],
              supportedReasoningEfforts: [],
            },
          ],
          nextCursor: null,
        };
      });
    const service = new LlmCodexChatService(config as never, {} as never);

    await service.models();
    await service.models();

    expect(transports.size).toBe(2);
  });

  it('rejects repeated model cursors and closes the transport', async () => {
    jest
      .spyOn(UnixWebSocketRpcTransport.prototype, 'connect')
      .mockResolvedValue(undefined);
    jest
      .spyOn(UnixWebSocketRpcTransport.prototype, 'notify')
      .mockResolvedValue(undefined);
    const close = jest
      .spyOn(UnixWebSocketRpcTransport.prototype, 'close')
      .mockImplementation(() => undefined);
    const rpcRequest = jest
      .spyOn(UnixWebSocketRpcTransport.prototype, 'request')
      .mockImplementation(async (method) => {
        if (method === 'initialize') return {};
        return {
          data: [
            {
              defaultReasoningEffort: null,
              defaultServiceTier: null,
              displayName: 'Model A',
              hidden: false,
              id: 'model-a',
              model: 'model-a',
              serviceTiers: [],
              supportedReasoningEfforts: [],
            },
          ],
          nextCursor: 'repeated-model-cursor',
        };
      });
    const service = new LlmCodexChatService(config as never, {} as never);

    await expect(service.models()).rejects.toThrow(
      'codex-model-list-unavailable',
    );
    expect(rpcRequest).toHaveBeenCalledTimes(3);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each([
    { data: {}, nextCursor: null },
    {
      data: [
        {
          displayName: 'Missing Hidden',
          id: 'missing-hidden',
          model: 'missing-hidden',
        },
      ],
      nextCursor: null,
    },
    {
      data: [
        {
          displayName: 'Hidden Model',
          hidden: true,
          id: 'hidden-model',
          model: 'hidden-model',
        },
        {
          displayName: 'Blank Model',
          hidden: false,
          id: ' ',
          model: '',
        },
      ],
      nextCursor: null,
    },
  ])(
    'rejects an invalid or empty model result without leaking it',
    async (page) => {
      jest
        .spyOn(UnixWebSocketRpcTransport.prototype, 'connect')
        .mockResolvedValue(undefined);
      jest
        .spyOn(UnixWebSocketRpcTransport.prototype, 'notify')
        .mockResolvedValue(undefined);
      jest
        .spyOn(UnixWebSocketRpcTransport.prototype, 'close')
        .mockImplementation(() => undefined);
      jest
        .spyOn(UnixWebSocketRpcTransport.prototype, 'request')
        .mockImplementation(async (method) => {
          if (method === 'initialize') return {};
          return page;
        });
      const service = new LlmCodexChatService(config as never, {} as never);

      await expect(service.models()).rejects.toThrow(
        'codex-model-list-unavailable',
      );
    },
  );

  it('rejects model pagination beyond the hard page limit', async () => {
    jest
      .spyOn(UnixWebSocketRpcTransport.prototype, 'connect')
      .mockResolvedValue(undefined);
    jest
      .spyOn(UnixWebSocketRpcTransport.prototype, 'notify')
      .mockResolvedValue(undefined);
    jest
      .spyOn(UnixWebSocketRpcTransport.prototype, 'close')
      .mockImplementation(() => undefined);
    let modelPage = 0;
    const rpcRequest = jest
      .spyOn(UnixWebSocketRpcTransport.prototype, 'request')
      .mockImplementation(async (method) => {
        if (method === 'initialize') return {};
        modelPage += 1;
        return {
          data: [
            {
              defaultReasoningEffort: null,
              defaultServiceTier: null,
              displayName: 'Model A',
              hidden: false,
              id: 'model-a',
              model: 'model-a',
              serviceTiers: [],
              supportedReasoningEfforts: [],
            },
          ],
          nextCursor: `model-cursor-${modelPage}`,
        };
      });
    const service = new LlmCodexChatService(config as never, {} as never);

    await expect(service.models()).rejects.toThrow(
      'codex-model-list-unavailable',
    );
    expect(rpcRequest).toHaveBeenCalledTimes(101);
  });

  it('starts generic chat with the shared networked permission profile', async () => {
    const transport = {
      request: jest.fn(async (...args: unknown[]) => {
        void args;
        return {
          activePermissionProfile: { id: 'llm-codex' },
          approvalPolicy: 'never',
          cwd: '/tmp/kt-llm-codex',
          sandbox: { networkAccess: true, type: 'readOnly' },
          thread: { id: 'thread-llm-codex-001' },
        };
      }),
    };
    const service = new LlmCodexChatService(config as never, {} as never);
    const openThread = Reflect.get(service, 'openThread').bind(service) as (
      transport: unknown,
      body: {
        clientMessageId: string;
        model: string;
        prompt: string;
        serviceTier?: string;
      },
    ) => Promise<string>;

    await expect(
      openThread(transport, {
        clientMessageId: 'client-message-llm-codex',
        model: 'gpt-test',
        prompt: '测试联网权限档',
        serviceTier: 'priority',
      }),
    ).resolves.toBe('thread-llm-codex-001');
    expect(transport.request).toHaveBeenCalledWith(
      'thread/start',
      expect.objectContaining({
        model: 'gpt-test',
        permissions: 'llm-codex',
        serviceTier: 'priority',
      }),
    );
    expect(transport.request.mock.calls[0][1]).not.toHaveProperty('sandbox');
  });

  it('resumes the canonical provider thread after a Gateway restart', async () => {
    const transport = {
      request: jest.fn(async () => ({
        activePermissionProfile: { id: 'llm-codex' },
        approvalPolicy: 'never',
        cwd: '/tmp/kt-llm-codex',
        sandbox: { networkAccess: true, type: 'readOnly' },
        thread: { id: 'thread-media-codex-001' },
      })),
    };
    const service = new LlmCodexChatService(config as never, {} as never);
    const openThread = Reflect.get(service, 'openThread').bind(service) as (
      transport: unknown,
      body: Record<string, unknown>,
      mediaRuntime: Record<string, unknown>,
    ) => Promise<string>;

    await expect(
      openThread(
        transport,
        {
          clientMessageId: 'client-message-media-resume',
          conversationId: '2041700000000190001',
          model: 'gpt-test',
          prompt: '恢复媒体对话',
          scene: 'media-governance',
          sceneRefId: 'media-task-001',
          threadId: 'thread-media-codex-001',
        },
        {
          identity: {
            conversationId: '2041700000000190001',
            providerThreadId: 'thread-media-codex-001',
            scene: 'media-governance',
            sceneRefId: 'media-task-001',
          },
          policy: { staticPrompt: 'bounded media prompt' },
        },
      ),
    ).resolves.toBe('thread-media-codex-001');
    expect(transport.request).toHaveBeenCalledWith(
      'thread/resume',
      expect.objectContaining({ threadId: 'thread-media-codex-001' }),
    );
  });

  it('fails closed when App Server resumes a different provider thread', async () => {
    const transport = {
      request: jest.fn(async () => ({
        activePermissionProfile: { id: 'llm-codex' },
        approvalPolicy: 'never',
        cwd: '/tmp/kt-llm-codex',
        sandbox: { networkAccess: true, type: 'readOnly' },
        thread: { id: 'thread-media-codex-wrong' },
      })),
    };
    const service = new LlmCodexChatService(config as never, {} as never);
    const openThread = Reflect.get(service, 'openThread').bind(service) as (
      transport: unknown,
      body: Record<string, unknown>,
      mediaRuntime: Record<string, unknown>,
    ) => Promise<string>;
    const mediaRuntime = {
      identity: {
        conversationId: '2041700000000190001',
        providerThreadId: 'thread-media-codex-001',
        scene: 'media-governance',
        sceneRefId: 'media-task-001',
      },
      policy: { staticPrompt: 'bounded media prompt' },
    };

    await expect(
      openThread(
        transport,
        {
          clientMessageId: 'client-message-media-resume',
          model: 'gpt-test',
          prompt: '恢复媒体对话',
        },
        mediaRuntime,
      ),
    ).rejects.toThrow('codex-thread-identity-mismatch');
  });

  it('passes realtime reasoning effort and speed tier to turn/start', async () => {
    const transport = {
      request: jest.fn(async () => ({ turn: { id: 'turn-llm-codex-001' } })),
    };
    const service = new LlmCodexChatService(config as never, {} as never);
    const startTurn = Reflect.get(service, 'startTurn').bind(service) as (
      transport: unknown,
      body: Record<string, unknown>,
      threadId: string,
      mediaRuntime: null,
    ) => Promise<string>;

    await expect(
      startTurn(
        transport,
        {
          clientMessageId: 'client-message-effort-001',
          model: 'gpt-test',
          prompt: '验证推理与速度档位',
          reasoningEffort: 'high',
          serviceTier: 'priority',
        },
        'thread-llm-codex-001',
        null,
      ),
    ).resolves.toBe('turn-llm-codex-001');
    expect(transport.request).toHaveBeenCalledWith(
      'turn/start',
      expect.objectContaining({
        effort: 'high',
        serviceTier: 'priority',
      }),
    );
  });

  it('rejects an App Server response that silently disables network access', () => {
    const service = new LlmCodexChatService(config as never, {} as never);
    const assertBoundary = Reflect.get(service, 'assertThreadBoundary').bind(
      service,
    ) as (response: Record<string, unknown>, cwd: string) => void;

    expect(() =>
      assertBoundary(
        {
          activePermissionProfile: { id: 'llm-codex' },
          approvalPolicy: 'never',
          cwd: '/tmp/kt-llm-codex',
          sandbox: { networkAccess: false, type: 'readOnly' },
        },
        '/tmp/kt-llm-codex',
      ),
    ).toThrow('codex-thread-boundary-mismatch');
  });

  it('builds media dynamic-tool context from the bound LLM conversation', async () => {
    const mediaApiClient = {
      conversationContext: jest.fn(async () => ({
        identity: {
          activeTurnId: 'conversation-turn-media-001',
          conversationId: '2041700000000190001',
          providerThreadId: null,
          scene: 'media-governance',
          sceneRefId: 'media-task-001',
        },
        request: {
          clientMessageId: 'client-message-media-001',
          compactContext: { title: '测试作品' },
          currentStage: 'metadata',
          currentUnitId: 'media-unit-001',
          manifestSha256: 'a'.repeat(64),
          model: 'gpt-test',
          operatorCommand: '分析当前任务',
          replayKey: 'media-replay-001',
          taskId: 'media-task-001',
          taskRevision: 7,
        },
      })),
    };
    const service = new LlmCodexChatService(
      config as never,
      mediaApiClient as never,
    );
    const prepare = Reflect.get(service, 'prepareMediaRuntime').bind(
      service,
    ) as (body: Record<string, unknown>) => Promise<{
      policy: { networkAccess: boolean; permissionProfile: string };
      prompt: string;
      request: { taskId: string };
    }>;

    const runtime = await prepare({
      clientMessageId: 'client-message-media-001',
      conversationId: '2041700000000190001',
      conversationTurnId: 'conversation-turn-media-001',
      model: 'gpt-test',
      prompt: '分析当前任务',
      scene: 'media-governance',
      sceneRefId: 'media-task-001',
    });

    expect(mediaApiClient.conversationContext).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: '2041700000000190001',
        conversationTurnId: 'conversation-turn-media-001',
        providerThreadId: null,
        taskId: 'media-task-001',
      }),
    );
    expect(runtime).toMatchObject({
      policy: { networkAccess: true, permissionProfile: 'llm-codex' },
      request: { taskId: 'media-task-001' },
    });
    expect(runtime.prompt).toContain('【本回合可信任务边界胶囊】');
  });

  it('extracts the final media result for LLM message metadata', () => {
    const service = new LlmCodexChatService(config as never, {} as never);
    const extract = Reflect.get(service, 'mediaResult').bind(service) as (
      notification: Record<string, unknown>,
      enabled: boolean,
    ) => { status: string; summary: string } | null;

    expect(
      extract(
        {
          method: 'item/completed',
          params: {
            item: {
              phase: 'final_answer',
              text: JSON.stringify({
                candidateSummaries: [],
                nextActionLabel: '继续核对',
                planSha256: null,
                status: 'conversation-response',
                summary: '当前任务已分析',
              }),
              type: 'agentMessage',
            },
          },
        },
        true,
      ),
    ).toMatchObject({
      status: 'conversation-response',
      summary: '当前任务已分析',
    });
  });

  it('removes derived candidates from the media API and metadata payload', () => {
    const service = new LlmCodexChatService(config as never, {} as never);
    const project = Reflect.get(service, 'mediaResultPayload').bind(service) as (
      result: Record<string, unknown>,
    ) => Record<string, unknown>;

    expect(
      project({
        candidateSummaries: ['tmdb:123｜候选 A', 'tmdb:456｜候选 B'],
        candidates: [
          { id: 'tmdb:123', summary: 'tmdb:123｜候选 A' },
          { id: 'tmdb:456', summary: 'tmdb:456｜候选 B' },
        ],
        nextActionLabel: '等待操作员选择',
        planSha256: null,
        status: 'requires-operator',
        summary: '存在两个以上真实候选',
      }),
    ).toEqual({
      candidateSummaries: ['tmdb:123｜候选 A', 'tmdb:456｜候选 B'],
      nextActionLabel: '等待操作员选择',
      planSha256: null,
      status: 'requires-operator',
      summary: '存在两个以上真实候选',
    });
  });

  it('does not parse a generic final answer as a media result', () => {
    const service = new LlmCodexChatService(config as never, {} as never);
    const extract = Reflect.get(service, 'mediaResult').bind(service) as (
      notification: Record<string, unknown>,
      enabled: boolean,
    ) => unknown;

    expect(
      extract(
        {
          method: 'item/completed',
          params: {
            item: {
              phase: 'final_answer',
              text: '普通对话的可见正文不是媒体治理 JSON',
              type: 'agentMessage',
            },
          },
        },
        false,
      ),
    ).toBeNull();
  });
});

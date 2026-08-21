import type { LlmNormalizedStreamEvent } from '../../../src/modules/admin/llm/contract/llm.types';
import { LlmConversationService } from '../../../src/modules/admin/llm/application/llm-conversation.service';

type ConsumeStream = (
  prepared: Record<string, unknown>,
  body: { clientMessageId: string; content: string; model: string },
  signal: AbortSignal,
) => AsyncGenerator<Record<string, unknown>>;

describe('LlmConversationService provider stream completion', () => {
  it('validates the selected model against live discovery before opening a turn', async () => {
    const runtime = {
      adapterConfig: {
        apiKey: 'test-key',
        baseUrl: 'https://api.example/v1',
        provider: 'openai',
      },
      entity: { id: 'config-1', provider: 'openai' },
    };
    const configs = {
      resolveModelSelection: jest
        .fn()
        .mockRejectedValue(new Error('实时目录中不存在该模型')),
      runtime: jest.fn().mockResolvedValue(runtime),
    };
    const transaction = jest.fn();
    const service = new LlmConversationService(
      {
        findOne: jest.fn().mockResolvedValue({
          configId: 'config-1',
          id: 'conversation-1',
          isDeleted: false,
        }),
        manager: { transaction },
      } as never,
      {} as never,
      configs as never,
      {} as never,
    );

    await expect(
      service.prepareStream(
        'conversation-1',
        streamBody(),
        new AbortController().signal,
      ),
    ).rejects.toThrow('实时目录中不存在该模型');
    expect(configs.resolveModelSelection).toHaveBeenCalledWith(
      runtime,
      'requested-model',
      undefined,
      undefined,
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('persists failure and rejects a provider stream that ends without done', async () => {
    const adapter = {
      stream: async function* (): AsyncGenerator<LlmNormalizedStreamEvent> {
        yield { model: 'gpt-test', type: 'start' };
        yield { content: '不完整', type: 'text-delta' };
      },
    };
    const adapters = { resolve: jest.fn(() => adapter) };
    const service = new LlmConversationService(
      {} as never,
      {} as never,
      {} as never,
      adapters as never,
    );
    const finalizeTurn = jest.fn().mockResolvedValue(undefined);
    Reflect.set(service, 'finalizeTurn', finalizeTurn);
    const consume = Reflect.get(service, 'consumeProviderStream').bind(
      service,
    ) as ConsumeStream;
    const read = async () => {
      for await (const event of consume(
        preparedTurn(),
        streamBody(),
        new AbortController().signal,
      )) {
        // 读取到流结束以触发终态校验。
        void event;
      }
    };

    await expect(read()).rejects.toThrow('供应商流缺少 done 事件');
    expect(finalizeTurn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        content: '不完整',
        errorMessage: '供应商流缺少 done 事件',
        status: 'failed',
      }),
    );
  });

  it('persists the provider-reported actual model only after done', async () => {
    const adapter = {
      stream: async function* (): AsyncGenerator<LlmNormalizedStreamEvent> {
        yield { model: 'requested-model', type: 'start' };
        yield { content: '完成', type: 'text-delta' };
        yield {
          finishReason: 'stop',
          model: 'actual-model',
          type: 'done',
        };
      },
    };
    const service = new LlmConversationService(
      {} as never,
      {} as never,
      {} as never,
      { resolve: jest.fn(() => adapter) } as never,
    );
    const finalizeTurn = jest.fn().mockResolvedValue(undefined);
    Reflect.set(service, 'finalizeTurn', finalizeTurn);
    const consume = Reflect.get(service, 'consumeProviderStream').bind(
      service,
    ) as ConsumeStream;
    const events: Record<string, unknown>[] = [];

    for await (const event of consume(
      preparedTurn(),
      streamBody(),
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      'start',
      'text-delta',
      'done',
    ]);
    expect(finalizeTurn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actualModel: 'actual-model',
        content: '完成',
        status: 'completed',
      }),
    );
  });

  it('passes media scene context and persists structured result metadata', async () => {
    let observedContext: unknown;
    const adapter = {
      stream: async function* (request: {
        context?: unknown;
      }): AsyncGenerator<LlmNormalizedStreamEvent> {
        observedContext = request.context;
        yield { model: 'gpt-test', type: 'start' };
        yield {
          metadata: {
            mediaGovernanceResult: {
              status: 'conversation-response',
              summary: '分析完成',
            },
          },
          model: 'gpt-test',
          type: 'done',
        };
      },
    };
    const service = new LlmConversationService(
      {} as never,
      {} as never,
      {} as never,
      { resolve: jest.fn(() => adapter) } as never,
    );
    const finalizeTurn = jest.fn().mockResolvedValue(undefined);
    Reflect.set(service, 'finalizeTurn', finalizeTurn);
    const consume = Reflect.get(service, 'consumeProviderStream').bind(
      service,
    ) as ConsumeStream;

    for await (const _event of consume(
      preparedTurn(true),
      streamBody(),
      new AbortController().signal,
    )) {
      void _event;
    }

    expect(observedContext).toEqual({
      conversationId: '2041700000000190001',
      conversationTurnId: 'turn-1',
      scene: 'media-governance',
      sceneRefId: 'media-task-001',
    });
    expect(finalizeTurn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({
          mediaGovernanceResult: expect.objectContaining({
            status: 'conversation-response',
          }),
        }),
      }),
    );
  });

  it('resolves the canonical scene identity and rejects a wrong Task or provider thread', async () => {
    const conversation = {
      activeTurnId: null,
      id: '2041700000000190001',
      isDeleted: false,
      providerThreadId: 'thread-media-codex-001',
      scene: 'media-governance',
      sceneRefId: 'media-task-001',
    };
    const service = new LlmConversationService(
      { findOne: jest.fn(async () => conversation) } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.resolveIdentity({
        conversationId: conversation.id,
        providerThreadId: conversation.providerThreadId,
        scene: 'media-governance',
        sceneRefId: conversation.sceneRefId,
      }),
    ).resolves.toEqual({
      activeTurnId: null,
      conversationId: conversation.id,
      providerThreadId: conversation.providerThreadId,
      scene: 'media-governance',
      sceneRefId: conversation.sceneRefId,
    });
    await expect(
      service.resolveIdentity({
        conversationId: conversation.id,
        scene: 'media-governance',
        sceneRefId: 'media-task-wrong',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ msg: '大模型对话身份不匹配' }),
      status: 409,
    });
    await expect(
      service.resolveIdentity({
        conversationId: conversation.id,
        providerThreadId: 'thread-media-codex-wrong',
        scene: 'media-governance',
        sceneRefId: conversation.sceneRefId,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        msg: '大模型 provider thread 身份不匹配',
      }),
      status: 409,
    });
  });

  it('keeps a media scene title bound to the Task instead of the first user prompt', async () => {
    const conversation = {
      id: '2041700000000190001',
      isDeleted: false,
      scene: 'media-governance',
      sceneRefId: 'media-task-001',
      title: '首条临时提示',
    };
    const save = jest.fn(async () => conversation);
    const service = new LlmConversationService(
      {
        findOne: jest.fn(async () => conversation),
        save,
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.updateSceneTitle({
        conversationId: conversation.id,
        scene: 'media-governance',
        sceneRefId: conversation.sceneRefId,
        title: '死神BLEACH · 媒体治理',
      }),
    ).resolves.toMatchObject({ title: '死神BLEACH · 媒体治理' });
    expect(save).toHaveBeenCalledTimes(1);
    expect(conversation.title).toBe('死神BLEACH · 媒体治理');
  });

  it('hydrates the persisted provider thread into the first stream request after API restart', async () => {
    let observedProviderThreadId: null | string = null;
    const adapter = {
      stream: async function* (request: {
        providerThreadId?: null | string;
      }): AsyncGenerator<LlmNormalizedStreamEvent> {
        observedProviderThreadId = request.providerThreadId || null;
        yield {
          model: 'gpt-test',
          providerThreadId: 'thread-media-codex-001',
          type: 'start',
        };
        yield {
          model: 'gpt-test',
          providerThreadId: 'thread-media-codex-001',
          type: 'done',
        };
      },
    };
    const service = new LlmConversationService(
      {} as never,
      {} as never,
      {} as never,
      { resolve: jest.fn(() => adapter) } as never,
    );
    const persistProviderThread = jest.fn().mockResolvedValue(undefined);
    const finalizeTurn = jest.fn().mockResolvedValue(undefined);
    Reflect.set(service, 'persistProviderThread', persistProviderThread);
    Reflect.set(service, 'finalizeTurn', finalizeTurn);
    const consume = Reflect.get(service, 'consumeProviderStream').bind(
      service,
    ) as ConsumeStream;
    const prepared = preparedTurn(true);
    prepared.conversation.providerThreadId = 'thread-media-codex-001';

    for await (const _event of consume(
      prepared,
      streamBody(),
      new AbortController().signal,
    )) {
      void _event;
    }

    expect(observedProviderThreadId).toBe('thread-media-codex-001');
    expect(persistProviderThread).toHaveBeenCalledWith(
      '2041700000000190001',
      'turn-1',
      'thread-media-codex-001',
    );
  });

  it('never overwrites an existing provider thread with a different App Server identity', async () => {
    const conversation = {
      activeTurnId: 'turn-1',
      id: '2041700000000190001',
      isDeleted: false,
      providerThreadId: 'thread-media-codex-001',
    };
    const save = jest.fn();
    const repository = {
      manager: {
        transaction: async (work: (manager: unknown) => Promise<void>) =>
          work({
            getRepository: () => ({
              findOne: jest.fn(async () => conversation),
              save,
            }),
          }),
      },
    };
    const service = new LlmConversationService(
      repository as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const persist = Reflect.get(service, 'persistProviderThread').bind(
      service,
    ) as (
      conversationId: string,
      turnId: string,
      providerThreadId: string,
    ) => Promise<void>;

    await expect(
      persist(
        conversation.id,
        conversation.activeTurnId,
        'thread-media-codex-wrong',
      ),
    ).rejects.toThrow('llm-provider-thread-identity-mismatch');
    expect(save).not.toHaveBeenCalled();
  });

  it('rotates a provider thread only through the explicit policy-upgrade CAS path', async () => {
    const conversation = {
      activeTurnId: 'turn-policy-upgrade',
      id: '2041700000000190001',
      isDeleted: false,
      providerThreadId: 'thread-policy-v2',
      scene: 'media-governance',
      sceneRefId: 'media-task-001',
    };
    const save = jest.fn(async () => conversation);
    const service = new LlmConversationService(
      {
        manager: {
          transaction: async (work: (manager: unknown) => Promise<unknown>) =>
            work({
              getRepository: () => ({
                findOne: jest.fn(async () => conversation),
                save,
              }),
            }),
        },
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.bindProviderThread({
        allowReplace: true,
        conversationId: conversation.id,
        conversationTurnId: conversation.activeTurnId,
        expectedProviderThreadId: 'thread-policy-v2',
        providerThreadId: 'thread-policy-v3',
        scene: 'media-governance',
        sceneRefId: conversation.sceneRefId,
      }),
    ).resolves.toMatchObject({ providerThreadId: 'thread-policy-v3' });
    expect(conversation.providerThreadId).toBe('thread-policy-v3');
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('CAS-binds the first provider thread before any SSE start consumer or result callback', async () => {
    const conversation = {
      activeTurnId: 'turn-1',
      id: '2041700000000190001',
      isDeleted: false,
      providerThreadId: null,
      scene: 'media-governance',
      sceneRefId: 'media-task-001',
    };
    const repository = {
      findOne: jest.fn(async () => conversation),
      manager: {
        transaction: async (work: (manager: unknown) => Promise<unknown>) =>
          work({
            getRepository: () => ({
              findOne: jest.fn(async () => conversation),
              save: jest.fn(async () => conversation),
            }),
          }),
      },
    };
    const service = new LlmConversationService(
      repository as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.bindProviderThread({
        conversationId: conversation.id,
        conversationTurnId: 'turn-stale-previous',
        expectedProviderThreadId: null,
        providerThreadId: 'thread-media-codex-stale',
        scene: 'media-governance',
        sceneRefId: conversation.sceneRefId,
      }),
    ).rejects.toMatchObject({
      response: { msg: '大模型对话身份不匹配' },
      status: 409,
    });
    await expect(
      service.bindProviderThread({
        conversationId: conversation.id,
        conversationTurnId: 'turn-stale-previous',
        expectedProviderThreadId: null,
        providerThreadId: 'thread-media-codex-stale',
        scene: 'media-governance',
        sceneRefId: conversation.sceneRefId,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ msg: '大模型对话身份不匹配' }),
      status: 409,
    });
    expect(conversation.providerThreadId).toBeNull();

    await expect(
      service.bindProviderThread({
        conversationId: conversation.id,
        conversationTurnId: conversation.activeTurnId,
        expectedProviderThreadId: null,
        providerThreadId: 'thread-media-codex-001',
        scene: 'media-governance',
        sceneRefId: conversation.sceneRefId,
      }),
    ).resolves.toMatchObject({
      providerThreadId: 'thread-media-codex-001',
    });
    await expect(
      service.resolveIdentity({
        conversationId: conversation.id,
        providerThreadId: 'thread-media-codex-001',
        scene: 'media-governance',
        sceneRefId: conversation.sceneRefId,
      }),
    ).resolves.toMatchObject({
      providerThreadId: 'thread-media-codex-001',
    });
  });
});

/**
 * 创建不依赖数据库的已准备回合夹具。
 * @param mediaScene - 是否投影媒体治理场景上下文。
 * @returns 可直接交给私有流消费边界的最小回合对象。
 */
function preparedTurn(mediaScene = false) {
  const conversation: Record<string, unknown> = {
    id: 'conversation-1',
    providerThreadId: null,
  };
  if (mediaScene) {
    conversation.id = '2041700000000190001';
    conversation.scene = 'media-governance';
    conversation.sceneRefId = 'media-task-001';
  }
  return {
    assistantMessage: { id: 'assistant-message-1' },
    conversation,
    history: [{ content: '测试', role: 'user' }],
    model: 'requested-model',
    runtime: {
      adapterConfig: {
        apiKey: 'test-key',
        baseUrl: 'https://api.example/v1',
        provider: 'openai',
      },
      entity: { provider: 'openai' },
    },
    turnId: 'turn-1',
    userMessage: { id: 'user-message-1' },
  };
}

/**
 * 创建稳定的用户消息流输入夹具。
 * @returns 含幂等标识、正文和模型的输入对象。
 */
function streamBody() {
  return {
    clientMessageId: 'client-message-001',
    content: '测试',
    model: 'requested-model',
  };
}

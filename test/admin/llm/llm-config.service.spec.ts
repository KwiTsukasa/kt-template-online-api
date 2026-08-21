import { ConfigService } from '@nestjs/config';
import { LlmConfigService } from '../../../src/modules/admin/llm/application/llm-config.service';
import type { AdminLlmConfigEntity } from '../../../src/modules/admin/llm/infrastructure/persistence/llm.entities';

describe('LlmConfigService', () => {
  const tools = {
    pickFirstText: (...values: unknown[]) => {
      const value = values.find(
        (item) => typeof item === 'string' && item.trim(),
      );
      if (typeof value === 'string') return value.trim();
      return '';
    },
    toTrimmedString: (value: unknown) => {
      if (typeof value === 'string') return value.trim();
      return '';
    },
  };

  it('publishes the deployment-pinned Codex gateway and rejects secret exfiltration endpoints', () => {
    const service = new LlmConfigService(
      {} as never,
      new ConfigService({
        LLM_CODEX_GATEWAY_BASE_URL: 'http://127.0.0.1:48087/internal/llm-codex',
      }),
      tools as never,
      {} as never,
    );
    const validate = Reflect.get(service, 'assertProviderEndpoint').bind(
      service,
    ) as (provider: string, baseUrl: string) => void;

    expect(
      service.providerCatalog().find((item) => item.provider === 'codex')
        ?.defaultBaseUrl,
    ).toBe('http://127.0.0.1:48087/internal/llm-codex');
    expect(() =>
      validate('codex', 'https://untrusted.example/internal/llm-codex'),
    ).toThrow();
    expect(() => validate('openai', 'http://api.openai.example/v1')).toThrow();
    expect(() => validate('openai', 'http://127.0.0.1:40123/v1')).not.toThrow();
  });

  it('rejects a disabled connection marked as the default', async () => {
    const builder = {
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
      where: jest.fn().mockReturnThis(),
    };
    const entityRepository = {
      create: jest.fn((value) => value),
      createQueryBuilder: jest.fn(() => builder),
      save: jest.fn(async (value) => value),
    };
    const manager = {
      getRepository: jest.fn(() => entityRepository),
    };
    const repository = {
      manager: {
        transaction: jest.fn(async (callback) => callback(manager)),
      },
    };
    const service = new LlmConfigService(
      repository as never,
      new ConfigService(),
      tools as never,
      {} as never,
    );

    await expect(
      service.create({
        baseUrl: 'https://api.openai.com/v1',
        enabled: false,
        isDefault: true,
        name: '禁用默认项',
        provider: 'openai',
      }),
    ).rejects.toThrow();
  });

  it('resets a previously connected status when an endpoint changes', async () => {
    const entity = {
      apiKeySecret: 'encrypted',
      baseUrl: 'https://api.openai.com/v1',
      connectionStatus: 'connected',
      enabled: true,
      firstTokenLatencyMs: 88,
      id: '2041700000000100001',
      isDefault: false,
      isDeleted: false,
      lastErrorMessage: null,
      lastTestedAt: new Date(),
      name: '生产 OpenAI',
      provider: 'openai',
    } as unknown as AdminLlmConfigEntity;
    const builder = {
      addSelect: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(entity),
      where: jest.fn().mockReturnThis(),
    };
    const entityRepository = {
      createQueryBuilder: jest.fn(() => builder),
      save: jest.fn(async (value) => value),
    };
    const manager = {
      getRepository: jest.fn(() => entityRepository),
    };
    const repository = {
      manager: {
        transaction: jest.fn(async (callback) => callback(manager)),
      },
    };
    const service = new LlmConfigService(
      repository as never,
      new ConfigService(),
      tools as never,
      {} as never,
    );

    const result = await service.update(entity.id, {
      baseUrl: 'https://proxy.example/v1',
    });

    expect(result).toMatchObject({
      connectionStatus: 'untested',
      firstTokenLatencyMs: null,
      lastErrorMessage: null,
      lastTestedAt: null,
    });
  });

  it('resolves the enabled Codex connection for internal media-governance use', async () => {
    const entity = {
      apiKeySecret: null,
      baseUrl: 'http://127.0.0.1:48087/internal/llm-codex',
      enabled: true,
      id: '2041700000000100002',
      isDeleted: false,
      provider: 'codex',
    } as unknown as AdminLlmConfigEntity;
    const builder = {
      addOrderBy: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(entity),
      orderBy: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const service = new LlmConfigService(
      { createQueryBuilder: jest.fn(() => builder) } as never,
      new ConfigService(),
      tools as never,
      {} as never,
    );

    await expect(service.runtimeForProvider('codex')).resolves.toMatchObject({
      adapterConfig: {
        apiKey: '',
        baseUrl: 'http://127.0.0.1:48087/internal/llm-codex',
        provider: 'codex',
      },
      entity: { id: '2041700000000100002', provider: 'codex' },
    });
  });

  it('returns normalized live models and validates every requested model against a fresh list', async () => {
    const fetchModels = jest.fn().mockResolvedValue([
      {
        defaultReasoningEffort: 'medium',
        defaultServiceTier: null,
        id: 'gpt-live-1',
        label: 'GPT Live 1',
        reasoningEfforts: [
          { id: 'low', label: 'Low' },
          { id: 'medium', label: 'Medium' },
        ],
        serviceTiers: [{ id: 'priority', label: 'Fast' }],
      },
      { id: 'gpt-live-1', label: '重复项' },
      { id: 'gpt-live-2', label: 'GPT Live 2' },
    ]);
    const service = new LlmConfigService(
      {} as never,
      new ConfigService(),
      tools as never,
      { resolve: jest.fn(() => ({ fetchModels })) } as never,
    );
    const runtime = {
      adapterConfig: {
        apiKey: 'test-key',
        baseUrl: 'https://api.openai.com/v1',
        provider: 'openai' as const,
      },
      entity: {
        id: '2041700000000100003',
        provider: 'openai' as const,
      } as AdminLlmConfigEntity,
    };
    jest.spyOn(service, 'runtime').mockResolvedValue(runtime);

    const result = await service.models(runtime.entity.id);

    expect(Number.isNaN(Date.parse(result.fetchedAt))).toBe(false);
    expect(result).toMatchObject({
      items: [
        {
          defaultReasoningEffort: 'medium',
          id: 'gpt-live-1',
          reasoningEfforts: [
            { id: 'low', label: 'Low' },
            { id: 'medium', label: 'Medium' },
          ],
          serviceTiers: [{ id: 'priority', label: 'Fast' }],
        },
        { id: 'gpt-live-2', label: 'GPT Live 2' },
      ],
      provider: 'openai',
    });
    await expect(service.resolveModel(runtime)).resolves.toBe('gpt-live-1');
    await expect(service.resolveModel(runtime, 'gpt-live-2')).resolves.toBe(
      'gpt-live-2',
    );
    await expect(
      service.resolveModel(runtime, 'removed-model'),
    ).rejects.toThrow();
    await expect(
      service.resolveModelSelection(runtime, 'gpt-live-1', 'low', 'priority'),
    ).resolves.toEqual({
      model: 'gpt-live-1',
      reasoningEffort: 'low',
      serviceTier: 'priority',
    });
    await expect(
      service.resolveModelSelection(runtime, 'gpt-live-1', 'max'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        msg: '所选推理强度不受当前模型支持',
      }),
    });
    await expect(
      service.resolveModelSelection(runtime, 'gpt-live-1', 'medium', 'flex'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        msg: '所选速度档位不受当前模型支持',
      }),
    });
    expect(fetchModels).toHaveBeenCalledTimes(7);
  });

  it('uses the first live model when connection test omits a model', async () => {
    const callOrder: string[] = [];
    const repository = { update: jest.fn().mockResolvedValue(undefined) };
    const adapter = {
      fetchModels: jest.fn(async () => {
        callOrder.push('models');
        return [
          {
            defaultReasoningEffort: 'high',
            defaultServiceTier: 'priority',
            id: 'gpt-live-first',
            label: 'GPT Live First',
            reasoningEfforts: [{ id: 'high', label: 'High' }],
            serviceTiers: [{ id: 'priority', label: 'Fast' }],
          },
        ];
      }),
      stream: async function* (request: {
        model: string;
        reasoningEffort?: string;
        serviceTier?: string;
      }) {
        callOrder.push(
          `stream:${request.model}:${request.reasoningEffort}:${request.serviceTier}`,
        );
        yield { model: request.model, type: 'start' as const };
        yield { content: '连接成功', type: 'text-delta' as const };
        yield { model: request.model, type: 'done' as const };
      },
    };
    const service = new LlmConfigService(
      repository as never,
      new ConfigService(),
      tools as never,
      { resolve: jest.fn(() => adapter) } as never,
    );
    const runtime = {
      adapterConfig: {
        apiKey: 'test-key',
        baseUrl: 'https://api.openai.com/v1',
        provider: 'openai' as const,
      },
      entity: {
        id: '2041700000000100004',
        provider: 'openai' as const,
      } as AdminLlmConfigEntity,
    };
    jest.spyOn(service, 'runtime').mockResolvedValue(runtime);

    await expect(
      service.testConnection(runtime.entity.id),
    ).resolves.toMatchObject({
      model: 'gpt-live-first',
      preview: '连接成功',
    });
    expect(callOrder).toEqual([
      'models',
      'stream:gpt-live-first:high:priority',
    ]);
    expect(repository.update).toHaveBeenCalledWith(
      { id: runtime.entity.id },
      expect.objectContaining({ connectionStatus: 'connected' }),
    );
  });
});

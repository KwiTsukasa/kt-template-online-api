import type { EntityManager, FindOptionsWhere, Repository } from 'typeorm';
import { KtDateTime } from '../../../../src/common';
import { SystemMessageTemplateRendererService } from '../../../../src/modules/qqbot/core/application/message-push/system-message-template-renderer.service';
import { QqbotMessageTemplateService } from '../../../../src/modules/qqbot/core/application/message-push/qqbot-message-template.service';
import { SystemMessageSourceRegistry } from '../../../../src/modules/qqbot/core/application/message-push/system-message-source.registry';
import { QqbotMessagePublishBinding } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-publish-binding.entity';
import { QqbotMessageTemplate } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-template.entity';

const SOURCE_KEY = 'network.stun.mapping-port-changed';
const NOW = new Date('2026-07-24T00:00:00.000Z');

function template(
  overrides: Partial<QqbotMessageTemplate> = {},
): QqbotMessageTemplate {
  return {
    content: '端口 ${{port}}，就绪：${{ready}}',
    createId: jest.fn(),
    createTime: NOW as never,
    enabled: true,
    id: '100',
    isDeleted: false,
    name: '端口提醒',
    remark: null,
    sourceKey: SOURCE_KEY,
    updateTime: NOW as never,
    ...overrides,
  };
}

function binding(
  overrides: Partial<QqbotMessagePublishBinding> = {},
): QqbotMessagePublishBinding {
  return {
    accountId: '200',
    activeKey: '200:300',
    createId: jest.fn(),
    createTime: NOW as never,
    enabled: true,
    id: '400',
    isDeleted: false,
    selfId: '123456',
    subscriptionId: '300',
    templateId: '100',
    updateTime: NOW as never,
    ...overrides,
  };
}

function likeValue(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as { _value?: unknown };
  return typeof candidate._value === 'string' ? candidate._value : undefined;
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function registry(): SystemMessageSourceRegistry {
  const value = new SystemMessageSourceRegistry();
  value.register({
    definition: {
      description: 'STUN 映射端口变化',
      displayName: 'STUN 端口变化',
      sourceKey: SOURCE_KEY,
      subscriptionFields: [],
      variables: [
        {
          description: '端口',
          example: '38213',
          key: 'port',
          label: '端口',
          type: 'number',
        },
        {
          description: '就绪',
          example: 'true',
          key: 'ready',
          label: '就绪',
          type: 'boolean',
        },
        {
          description: '地址',
          example: 'pal.example.com',
          key: 'endpoint',
          label: '地址',
          type: 'string',
        },
      ],
      version: 1,
    },
    inspectSubscription: jest.fn(),
    listSubscriptionOptions: jest.fn(),
    normalizeSubscriptionConfig: jest.fn(),
    resolveDelivery: jest.fn(),
    validateEventPayload: jest.fn(),
  });
  return value;
}

function setup(
  items: QqbotMessageTemplate[] = [template()],
  bindings: QqbotMessagePublishBinding[] = [],
) {
  const templateRepository = {
    create: jest.fn((input) => template(input)),
    findAndCount: jest.fn(
      async ({
        skip = 0,
        take = items.length,
        where,
      }: {
        skip?: number;
        take?: number;
        where: FindOptionsWhere<QqbotMessageTemplate>;
      }) => {
        const namePattern = likeValue(where.name);
        const name = namePattern?.slice(1, -1);
        const filtered = items.filter((item) => {
          if (item.isDeleted !== where.isDeleted) return false;
          if (where.enabled !== undefined && item.enabled !== where.enabled) {
            return false;
          }
          if (where.sourceKey && item.sourceKey !== where.sourceKey) {
            return false;
          }
          return !name || item.name.includes(name);
        });
        return [filtered.slice(skip, skip + take), filtered.length];
      },
    ),
    findOne: jest.fn(
      async ({ where: { id } }) =>
        items.find((item) => item.id === id && !item.isDeleted) ?? null,
    ),
    save: jest.fn(async (item) => item),
  } as unknown as jest.Mocked<Repository<QqbotMessageTemplate>>;
  const bindingRepository = {
    count: jest.fn(
      async ({ where: { isDeleted, templateId } }) =>
        bindings.filter(
          (item) =>
            item.isDeleted === isDeleted && item.templateId === templateId,
        ).length,
    ),
  } as unknown as jest.Mocked<Repository<QqbotMessagePublishBinding>>;
  const manager = {
    getRepository: jest.fn((entity) => {
      if (entity === QqbotMessageTemplate) return templateRepository;
      if (entity === QqbotMessagePublishBinding) return bindingRepository;
      throw new Error('unexpected repository');
    }),
  } as unknown as jest.Mocked<EntityManager>;
  Object.assign(templateRepository, {
    manager: {
      transaction: jest.fn((callback) => callback(manager)),
    },
  });
  const sourceRegistry = registry();
  const service = new QqbotMessageTemplateService(
    templateRepository,
    bindingRepository,
    sourceRegistry,
    new SystemMessageTemplateRendererService(),
  );
  return {
    bindingRepository,
    manager,
    service,
    sourceRegistry,
    templateRepository,
  };
}

describe('QqbotMessageTemplateService', () => {
  it('pages undeleted templates with filters, source names, and every live binding reference', async () => {
    const { bindingRepository, service, templateRepository } = setup(
      [
        template({ id: '100' }),
        template({ id: '101', isDeleted: true }),
        template({ id: '102', enabled: false }),
        template({ id: '103', sourceKey: 'other.source' }),
        template({ id: '104', name: '名称不匹配' }),
      ],
      [binding({ enabled: false }), binding({ id: '401', isDeleted: true })],
    );

    await expect(
      service.page({
        enabled: true,
        name: '端口',
        pageNo: 1,
        pageSize: 10,
        sourceKey: SOURCE_KEY,
      }),
    ).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: '100',
          referenceCount: 1,
          sourceName: 'STUN 端口变化',
        }),
      ],
      total: 1,
    });
    expect(templateRepository.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 10,
        where: {
          enabled: true,
          isDeleted: false,
          name: expect.objectContaining({ _type: 'like', _value: '%端口%' }),
          sourceKey: SOURCE_KEY,
        },
      }),
    );
    expect(bindingRepository.count).toHaveBeenNthCalledWith(1, {
      where: { isDeleted: false, templateId: '100' },
    });
  });

  it('serializes KtDateTime through the project formatter rather than UTC ISO text', async () => {
    const dateTime = new KtDateTime('2026-07-24 08:09:10');
    const { service } = setup([
      template({ createTime: dateTime, updateTime: dateTime }),
    ]);

    await expect(service.page({})).resolves.toEqual({
      items: [
        expect.objectContaining({
          createTime: String(dateTime),
          updateTime: String(dateTime),
        }),
      ],
      total: 1,
    });
  });

  it('creates and updates only templates valid for the current source variable definition', async () => {
    const { service, templateRepository } = setup();
    const input = {
      content: '地址 ${{endpoint}}',
      enabled: true,
      name: '新模板',
      remark: '  说明  ',
      sourceKey: SOURCE_KEY,
    };

    await expect(service.create(input)).resolves.toEqual(
      expect.objectContaining({ name: '新模板', remark: '说明' }),
    );
    await expect(
      service.update('100', { ...input, content: '端口 ${{port}}' }),
    ).resolves.toEqual(expect.objectContaining({ content: '端口 ${{port}}' }));
    await expect(
      service.create({ ...input, content: '${{unknown}}' }),
    ).rejects.toMatchObject({ code: 'template_invalid' });
    await expect(
      service.create({ ...input, sourceKey: 'missing' }),
    ).rejects.toMatchObject({ code: 'unknown_message_source' });
    expect(templateRepository.save).toHaveBeenCalledTimes(2);
  });

  it('previews source-specific typed examples through the same renderer', () => {
    const { service } = setup();

    expect(
      service.preview({
        content: '${{port}}/${{ready}}/${{endpoint}}',
        sourceKey: SOURCE_KEY,
      }),
    ).toEqual({
      renderedMessage: '38213/true/pal.example.com',
      variables: { endpoint: 'pal.example.com', port: 38213, ready: true },
    });
  });

  it('revalidates current source contents before enabling a historical template', async () => {
    const historical = template({
      content: '${{oldVariable}}',
      enabled: false,
    });
    const { service } = setup([historical]);

    await expect(service.setEnabled('100', true)).rejects.toMatchObject({
      code: 'template_invalid',
    });
    await expect(service.setEnabled('100', false)).resolves.toEqual(
      expect.objectContaining({ enabled: false }),
    );
  });

  it('locks template source changes through reference counting but permits same-source edits', async () => {
    const { bindingRepository, service, sourceRegistry, templateRepository } =
      setup([template()], [binding({ enabled: false })]);
    sourceRegistry.register({
      ...registry().get(SOURCE_KEY),
      definition: {
        ...registry().get(SOURCE_KEY).definition,
        sourceKey: 'other.source',
      },
    });
    const input = {
      content: '端口 ${{port}}，就绪：${{ready}}',
      enabled: false,
      name: '改源',
      sourceKey: 'other.source',
    };

    await expect(service.update('100', input)).rejects.toMatchObject({
      code: 'template_invalid',
    });
    await expect(
      service.update('100', {
        ...input,
        name: '同源编辑',
        sourceKey: SOURCE_KEY,
      }),
    ).resolves.toEqual(expect.objectContaining({ name: '同源编辑' }));
    expect(templateRepository.findOne).toHaveBeenCalledWith({
      lock: { mode: 'pessimistic_write' },
      where: { id: '100', isDeleted: false },
    });
    expect(bindingRepository.count).toHaveBeenCalledWith({
      where: { isDeleted: false, templateId: '100' },
    });
  });

  it('blocks soft deletion when any non-deleted binding references the template, including disabled bindings', async () => {
    const { bindingRepository, manager, service, templateRepository } = setup();
    bindingRepository.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    await expect(service.remove('100')).rejects.toMatchObject({
      code: 'template_invalid',
    });
    await expect(service.remove('100')).resolves.toBe(true);
    expect(templateRepository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false, isDeleted: true }),
    );
    expect(templateRepository.manager.transaction).toHaveBeenCalledTimes(2);
    expect(manager.getRepository).toHaveBeenCalledWith(QqbotMessageTemplate);
    expect(templateRepository.findOne).toHaveBeenLastCalledWith({
      lock: { mode: 'pessimistic_write' },
      where: { id: '100', isDeleted: false },
    });
  });

  it('gates publish bindings by source, deletion, enabled state, and current template validity', async () => {
    const current = template();
    const { manager, service, templateRepository } = setup([current]);

    await expect(
      service.requireAvailableForBinding(manager, '100', SOURCE_KEY, true),
    ).resolves.toBe(current);
    current.enabled = false;
    await expect(
      service.requireAvailableForBinding(manager, '100', SOURCE_KEY, true),
    ).rejects.toMatchObject({ code: 'template_invalid' });
    await expect(
      service.requireAvailableForBinding(manager, '100', SOURCE_KEY, false),
    ).resolves.toBe(current);
    await expect(
      service.requireAvailableForBinding(manager, '100', 'other.source', false),
    ).rejects.toMatchObject({ code: 'template_invalid' });
    current.isDeleted = true;
    await expect(
      service.requireAvailableForBinding(manager, '100', SOURCE_KEY, false),
    ).rejects.toMatchObject({ code: 'template_invalid' });
    expect(templateRepository.findOne).toHaveBeenCalledWith({
      lock: { mode: 'pessimistic_write' },
      where: { id: '100', isDeleted: false },
    });
  });

  it('holds the binding template lock through commit so deletion re-counts the committed live binding', async () => {
    const current = template();
    const bindings: QqbotMessagePublishBinding[] = [];
    const bindingHasLock = deferred();
    const allowBindingCommit = deferred();
    let lockTail = Promise.resolve();
    let deleteCountStarted = false;

    const createTransactionManager = (): EntityManager => {
      let releaseTemplateLock: (() => void) | undefined;
      const acquireTemplateLock = async (): Promise<void> => {
        const previous = lockTail;
        const lockReleased = deferred();
        lockTail = lockReleased.promise;
        await previous;
        releaseTemplateLock = lockReleased.resolve;
      };
      const manager = {
        getRepository: jest.fn((entity) => {
          if (entity === QqbotMessageTemplate) {
            return {
              findOne: jest.fn(async (options) => {
                if (options.lock?.mode === 'pessimistic_write') {
                  await acquireTemplateLock();
                }
                return current.isDeleted ? null : current;
              }),
              save: jest.fn(async (item) => item),
            };
          }
          if (entity === QqbotMessagePublishBinding) {
            return {
              count: jest.fn(async () => {
                deleteCountStarted = true;
                return bindings.filter(
                  (item) => !item.isDeleted && item.templateId === current.id,
                ).length;
              }),
            };
          }
          throw new Error('unexpected repository');
        }),
      } as unknown as EntityManager;
      Object.assign(manager, {
        transaction: async <T>(
          callback: (currentManager: EntityManager) => Promise<T>,
        ) => {
          try {
            return await callback(manager);
          } finally {
            releaseTemplateLock?.();
          }
        },
      });
      return manager;
    };
    const transactionManager = createTransactionManager();
    const templateRepository = {
      manager: transactionManager,
    } as unknown as Repository<QqbotMessageTemplate>;
    const service = new QqbotMessageTemplateService(
      templateRepository,
      {} as Repository<QqbotMessagePublishBinding>,
      registry(),
      new SystemMessageTemplateRendererService(),
    );

    const bindingTransaction = transactionManager.transaction(
      async (manager) => {
        await service.requireAvailableForBinding(
          manager,
          '100',
          SOURCE_KEY,
          true,
        );
        bindingHasLock.resolve();
        await allowBindingCommit.promise;
        bindings.push(binding());
      },
    );
    await bindingHasLock.promise;

    const deletion = service.remove('100');
    await Promise.resolve();
    expect(deleteCountStarted).toBe(false);

    allowBindingCommit.resolve();
    await bindingTransaction;
    await expect(deletion).rejects.toMatchObject({ code: 'template_invalid' });
    expect(current.isDeleted).toBe(false);
    expect(bindings).toHaveLength(1);
  });
});

import { KtDateTime } from '../../../../src/common';
import { MessageTemplateService } from '../../../../src/modules/message-management/application/message-template.service';
import { SystemMessageSourceRegistry } from '../../../../src/modules/message-management/application/system-message-source.registry';
import { SystemMessageTemplateRendererService } from '../../../../src/modules/message-management/application/system-message-template-renderer.service';
import { SystemMessageContractError } from '../../../../src/modules/message-management/contract/message-management.types';
import { MessageSubscription } from '../../../../src/modules/message-management/infrastructure/persistence/message-subscription.entity';
import { MessageSubscriptionTemplate } from '../../../../src/modules/message-management/infrastructure/persistence/message-subscription-template.entity';
import { MessageTemplate } from '../../../../src/modules/message-management/infrastructure/persistence/message-template.entity';

const SOURCE_KEY = 'network.stun.mapping-port-changed';
const SECOND_SOURCE_KEY = 'network.tcp.natmap-endpoint-changed';
const NOW = new KtDateTime('2026-08-18 08:00:00');

const templateRow = (id: string, overrides: Partial<MessageTemplate> = {}) =>
  Object.assign(new MessageTemplate(), {
    content: 'endpoint=${{endpoint}} port=${{port}}',
    createTime: NOW,
    enabled: true,
    id,
    isDeleted: false,
    name: `模板 ${id}`,
    remark: null,
    sourceKey: SOURCE_KEY,
    updateTime: NOW,
    ...overrides,
  });

const createSourceAdapter = (sourceKey: string, displayName: string) => ({
  definition: {
    description: `${displayName}测试来源`,
    displayName,
    sourceKey,
    subscriptionFields: [],
    variables: [
      {
        description: '公网访问地址',
        example: 'demo.example.com:38213',
        key: 'endpoint',
        label: '访问地址',
        type: 'string' as const,
      },
      {
        description: '公网端口',
        example: '38213',
        key: 'port',
        label: '端口',
        type: 'number' as const,
      },
    ],
    version: 1 as const,
  },
  eventResourceKey: jest.fn(),
  inspectSubscription: jest.fn(async () => ({
    invalidReasonCode: null,
    sourceSummary: displayName,
    valid: true,
  })),
  listSubscriptionOptions: jest.fn(),
  normalizeSubscriptionConfig: jest.fn(),
  resolveDelivery: jest.fn(),
  subscriptionResourceKey: jest.fn(),
  validateEventPayload: jest.fn(),
});

const createFixture = (input?: {
  bindings?: MessageSubscriptionTemplate[];
  subscriptions?: MessageSubscription[];
  templates?: MessageTemplate[];
}) => {
  const templates = input?.templates ?? [];
  const bindings = input?.bindings ?? [];
  const subscriptions = input?.subscriptions ?? [];
  let sequence = templates.length + 1;

  const templateStore = {
    create: jest.fn((fields: Partial<MessageTemplate>) =>
      templateRow(String(sequence++), fields),
    ),
    findAndCount: jest.fn(async () => [templates, templates.length]),
    findOne: jest.fn(
      async ({ where }: { where: Partial<MessageTemplate> }) =>
        templates.find((item) => {
          if (where.id !== undefined && item.id !== where.id) return false;
          if (
            where.isDeleted !== undefined &&
            item.isDeleted !== where.isDeleted
          ) {
            return false;
          }
          return true;
        }) ?? null,
    ),
    save: jest.fn(async (item: MessageTemplate) => {
      const index = templates.findIndex((value) => value.id === item.id);
      if (index >= 0) templates[index] = item;
      if (index < 0) templates.push(item);
      return item;
    }),
  };
  const bindingStore = {
    find: jest.fn(async ({ where }: { where: { templateId: string } }) =>
      bindings.filter((item) => item.templateId === where.templateId),
    ),
  };
  const subscriptionStore = {
    count: jest.fn(async () => {
      const referencedIds = new Set(
        bindings.map((binding) => binding.subscriptionId),
      );
      return subscriptions.filter(
        (subscription) =>
          referencedIds.has(subscription.id) && !subscription.isDeleted,
      ).length;
    }),
  };
  const manager = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === MessageTemplate) return templateStore;
      if (entity === MessageSubscriptionTemplate) return bindingStore;
      if (entity === MessageSubscription) return subscriptionStore;
      throw new Error('unexpected repository');
    }),
  };
  Object.assign(templateStore, {
    manager: {
      getRepository: manager.getRepository,
      transaction: jest.fn(
        async (work: (entityManager: typeof manager) => Promise<unknown>) =>
          work(manager),
      ),
    },
  });

  const sourceRegistry = new SystemMessageSourceRegistry();
  sourceRegistry.register(createSourceAdapter(SOURCE_KEY, 'STUN 映射端口变化'));
  sourceRegistry.register(
    createSourceAdapter(SECOND_SOURCE_KEY, 'TCP NATMap 端点变化'),
  );
  const renderer = new SystemMessageTemplateRendererService();
  const service = new MessageTemplateService(
    templateStore as never,
    sourceRegistry,
    renderer,
  );

  return { service, templates };
};

describe('MessageTemplateService', () => {
  it('creates a source-bound template and reports no subscription references', async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.create({
        content: 'endpoint=${{endpoint}} port=${{port}}',
        enabled: true,
        name: '  STUN 变更通知  ',
        remark: '  测试  ',
        sourceKey: SOURCE_KEY,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        name: 'STUN 变更通知',
        referenceCount: 0,
        remark: '测试',
        sourceKey: SOURCE_KEY,
        sourceName: 'STUN 映射端口变化',
      }),
    );
  });

  it('counts references only through active unified subscriptions', async () => {
    const activeSubscription = Object.assign(new MessageSubscription(), {
      id: 'subscription-active',
      isDeleted: false,
    });
    const deletedSubscription = Object.assign(new MessageSubscription(), {
      id: 'subscription-deleted',
      isDeleted: true,
    });
    const fixture = createFixture({
      bindings: [
        Object.assign(new MessageSubscriptionTemplate(), {
          sortOrder: 0,
          subscriptionId: activeSubscription.id,
          templateId: 'template-1',
        }),
        Object.assign(new MessageSubscriptionTemplate(), {
          sortOrder: 0,
          subscriptionId: deletedSubscription.id,
          templateId: 'template-1',
        }),
      ],
      subscriptions: [activeSubscription, deletedSubscription],
      templates: [templateRow('template-1')],
    });

    await expect(fixture.service.page({})).resolves.toEqual({
      items: [expect.objectContaining({ referenceCount: 1 })],
      total: 1,
    });
  });

  it('blocks source changes and deletion while any unified subscription binds the template', async () => {
    const subscription = Object.assign(new MessageSubscription(), {
      id: 'subscription-1',
      isDeleted: false,
    });
    const fixture = createFixture({
      bindings: [
        Object.assign(new MessageSubscriptionTemplate(), {
          sortOrder: 0,
          subscriptionId: subscription.id,
          templateId: 'template-1',
        }),
      ],
      subscriptions: [subscription],
      templates: [templateRow('template-1')],
    });

    await expect(
      fixture.service.update('template-1', {
        content: 'endpoint=${{endpoint}}',
        enabled: true,
        name: '更换来源',
        sourceKey: SECOND_SOURCE_KEY,
      }),
    ).rejects.toMatchObject({ code: 'template_invalid' });
    await expect(fixture.service.remove('template-1')).rejects.toMatchObject({
      code: 'template_invalid',
    });
  });

  it('allows a source change after every referencing subscription is deleted', async () => {
    const subscription = Object.assign(new MessageSubscription(), {
      id: 'subscription-1',
      isDeleted: true,
    });
    const fixture = createFixture({
      bindings: [
        Object.assign(new MessageSubscriptionTemplate(), {
          sortOrder: 0,
          subscriptionId: subscription.id,
          templateId: 'template-1',
        }),
      ],
      subscriptions: [subscription],
      templates: [templateRow('template-1')],
    });

    await expect(
      fixture.service.update('template-1', {
        content: 'endpoint=${{endpoint}}',
        enabled: true,
        name: 'TCP 模板',
        sourceKey: SECOND_SOURCE_KEY,
      }),
    ).resolves.toEqual(
      expect.objectContaining({ sourceKey: SECOND_SOURCE_KEY }),
    );
  });

  it('previews template output with typed source examples', () => {
    const fixture = createFixture();

    expect(
      fixture.service.preview({
        content: '${{endpoint}}:${{port}}',
        sourceKey: SOURCE_KEY,
      }),
    ).toEqual({
      renderedMessage: 'demo.example.com:38213:38213',
      variables: {
        endpoint: 'demo.example.com:38213',
        port: 38213,
      },
    });
  });

  it('rejects a variable that is not declared by the selected source', async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.create({
        content: '${{unknown}}',
        enabled: true,
        name: '非法模板',
        sourceKey: SOURCE_KEY,
      }),
    ).rejects.toBeInstanceOf(SystemMessageContractError);
  });
});

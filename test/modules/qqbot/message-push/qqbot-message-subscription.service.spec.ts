import { HttpException } from '@nestjs/common';
import { KtDateTime } from '../../../../src/common';
import { MessageSubscriberRegistry } from '../../../../src/modules/message-management/application/subscriber/message-subscriber.registry';
import { MessageSubscriptionService } from '../../../../src/modules/message-management/application/message-subscription.service';
import { SystemMessageSourceRegistry } from '../../../../src/modules/message-management/application/system-message-source.registry';
import { SystemMessageContractError } from '../../../../src/modules/message-management/contract/message-management.types';
import { MessageSubscription } from '../../../../src/modules/message-management/infrastructure/persistence/message-subscription.entity';
import { MessageSubscriptionTemplate } from '../../../../src/modules/message-management/infrastructure/persistence/message-subscription-template.entity';
import { MessageTemplate } from '../../../../src/modules/message-management/infrastructure/persistence/message-template.entity';

const SOURCE_KEY = 'network.stun.mapping-port-changed';
const NOW = new KtDateTime('2026-08-18 08:00:00');

const operatorValues = (value: unknown): unknown[] => {
  if (value && typeof value === 'object' && '_value' in value) {
    return (value as { _value: unknown[] })._value;
  }
  return [value];
};

const template = (
  id: string,
  overrides: Partial<MessageTemplate> = {},
): MessageTemplate =>
  Object.assign(new MessageTemplate(), {
    content: `template-${id}=${'${{endpoint}}'}`,
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

const createFixture = (
  initialTemplates: MessageTemplate[] = [template('101'), template('102')],
) => {
  const subscriptions: MessageSubscription[] = [];
  const templateBindings: MessageSubscriptionTemplate[] = [];
  let referenceCount = 0;
  const cancelSubscriptionDeliveries = jest.fn().mockResolvedValue(undefined);

  const sourceRegistry = new SystemMessageSourceRegistry();
  sourceRegistry.register({
    definition: {
      description: '测试消息源',
      displayName: '测试消息源',
      sourceKey: SOURCE_KEY,
      subscriptionFields: [
        {
          key: 'resourceId',
          label: '资源',
          optionCollection: 'resources',
          required: true,
          type: 'select',
        },
      ],
      variables: [],
      version: 1,
    },
    eventResourceKey: jest.fn(),
    inspectSubscription: jest.fn(async (config) => ({
      invalidReasonCode: null,
      sourceSummary: `资源 ${String(config.resourceId)}`,
      valid: true,
    })),
    listSubscriptionOptions: jest.fn(),
    normalizeSubscriptionConfig: jest.fn(async (input) => ({
      canonicalConfig: { ...(input as Record<string, string>) },
      resourceKey: String((input as Record<string, string>).resourceId),
      sourceSummary: 'normalized',
    })),
    resolveDelivery: jest.fn(),
    subscriptionResourceKey: jest.fn(),
    validateEventPayload: jest.fn(),
  });

  const subscriberRegistry = new MessageSubscriberRegistry();
  subscriberRegistry.register({
    cancelSubscriptionDeliveries,
    definition: {
      description: 'QQBot 测试订阅者',
      displayName: 'QQBot',
      subscriberKey: 'qqbot',
      version: 1,
    },
    hasSubscriptionReferences: jest.fn(async () => referenceCount > 0),
    receive: jest.fn(),
    runOnce: jest.fn(),
  });

  const subscriptionRepository = {
    create: jest.fn((input) =>
      Object.assign(new MessageSubscription(), {
        createTime: NOW,
        id: String(201 + subscriptions.length),
        updateTime: NOW,
        ...input,
      }),
    ),
    findAndCount: jest.fn(async () => [subscriptions, subscriptions.length]),
    findOne: jest.fn(async ({ where }) => {
      return (
        subscriptions.find((item) => {
          for (const [key, expected] of Object.entries(where)) {
            if (
              (item as unknown as Record<string, unknown>)[key] !== expected
            ) {
              return false;
            }
          }
          return true;
        }) || null
      );
    }),
    save: jest.fn(async (item) => {
      const existing = subscriptions.find((value) => value.id === item.id);
      if (!existing) subscriptions.push(item);
      return item;
    }),
  };

  const templateRepository = {
    find: jest.fn(async ({ where }) => {
      const ids = operatorValues(where.id).map(String);
      return initialTemplates.filter((item) => {
        if (!ids.includes(String(item.id))) return false;
        if (
          where.isDeleted !== undefined &&
          item.isDeleted !== where.isDeleted
        ) {
          return false;
        }
        return true;
      });
    }),
    findOne: jest.fn(async ({ where }) => {
      return (
        initialTemplates.find(
          (item) =>
            String(item.id) === String(where.id) &&
            (where.isDeleted === undefined ||
              item.isDeleted === where.isDeleted),
        ) || null
      );
    }),
  };

  const bindingRepository = {
    create: jest.fn((input) =>
      Object.assign(new MessageSubscriptionTemplate(), input),
    ),
    delete: jest.fn(async ({ subscriptionId }) => {
      const retained = templateBindings.filter(
        (item) => item.subscriptionId !== subscriptionId,
      );
      templateBindings.splice(0, templateBindings.length, ...retained);
      return { affected: 1 };
    }),
    find: jest.fn(async ({ where }) => {
      return templateBindings
        .filter((item) => item.subscriptionId === where.subscriptionId)
        .sort((left, right) => left.sortOrder - right.sortOrder);
    }),
    save: jest.fn(async (items: MessageSubscriptionTemplate[]) => {
      templateBindings.push(...items);
      return items;
    }),
  };

  const manager = {
    getRepository: jest.fn((entity) => {
      if (entity === MessageSubscription) return subscriptionRepository;
      if (entity === MessageTemplate) return templateRepository;
      if (entity === MessageSubscriptionTemplate) return bindingRepository;
      throw new Error('unexpected repository');
    }),
  };
  Object.assign(subscriptionRepository, {
    manager: {
      getRepository: manager.getRepository,
      transaction: jest.fn(async (callback) => callback(manager)),
    },
  });
  Object.assign(templateRepository, { manager });

  const service = new MessageSubscriptionService(
    subscriptionRepository as never,
    templateRepository as never,
    sourceRegistry,
    subscriberRegistry,
  );
  return {
    cancelSubscriptionDeliveries,
    manager,
    service,
    setReferenceCount: (value: number) => {
      referenceCount = value;
    },
    subscriptions,
    templateBindings,
  };
};

describe('MessageSubscriptionService', () => {
  it('creates one subscriber subscription with every same-source template in order', async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.create({
        enabled: true,
        name: '双模板订阅',
        sourceConfig: { resourceId: 'resource-1' },
        subscriberKey: 'qqbot',
        templateIds: ['102', '101'],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        sourceKey: SOURCE_KEY,
        subscriberKey: 'qqbot',
        subscriberName: 'QQBot',
        templates: [
          { id: '102', name: '模板 102', sortOrder: 0 },
          { id: '101', name: '模板 101', sortOrder: 1 },
        ],
      }),
    );
    expect(fixture.templateBindings).toEqual([
      expect.objectContaining({
        sortOrder: 0,
        subscriptionId: '201',
        templateId: '102',
      }),
      expect.objectContaining({
        sortOrder: 1,
        subscriptionId: '201',
        templateId: '101',
      }),
    ]);
  });

  it('rejects mixed-source template collections before persisting a subscription', async () => {
    const fixture = createFixture([
      template('101'),
      template('102', { sourceKey: 'another.source' }),
    ]);

    await expect(
      fixture.service.create({
        enabled: true,
        name: '非法混源订阅',
        sourceConfig: { resourceId: 'resource-1' },
        subscriberKey: 'qqbot',
        templateIds: ['101', '102'],
      }),
    ).rejects.toMatchObject({ code: 'template_source_mismatch' });
    expect(fixture.subscriptions).toHaveLength(0);
  });

  it('rejects an unknown subscriber instead of broadcasting the subscription', async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.create({
        enabled: true,
        name: '未知订阅者',
        sourceConfig: { resourceId: 'resource-1' },
        subscriberKey: 'missing',
        templateIds: ['101'],
      }),
    ).rejects.toMatchObject({ code: 'unknown_message_subscriber' });
  });

  it('replaces the complete template collection and cancels only the declared subscriber', async () => {
    const fixture = createFixture();
    const created = await fixture.service.create({
      enabled: true,
      name: '更新订阅',
      sourceConfig: { resourceId: 'resource-1' },
      subscriberKey: 'qqbot',
      templateIds: ['101'],
    });

    const updated = await fixture.service.update(created.id, {
      enabled: true,
      name: '更新订阅',
      sourceConfig: { resourceId: 'resource-2' },
      subscriberKey: 'qqbot',
      templateIds: ['102', '101'],
    });

    expect(updated.templates.map((item) => item.id)).toEqual(['102', '101']);
    expect(fixture.cancelSubscriptionDeliveries).toHaveBeenCalledWith(
      expect.anything(),
      {
        includeProcessing: true,
        subscriptionId: created.id,
      },
    );
  });

  it('rejects a private binding that tries to attach through another subscriber', async () => {
    const fixture = createFixture();
    const created = await fixture.service.create({
      enabled: true,
      name: '归属校验',
      sourceConfig: { resourceId: 'resource-1' },
      subscriberKey: 'qqbot',
      templateIds: ['101'],
    });

    await expect(
      fixture.service.requireAvailableForBinding(
        fixture.manager as never,
        created.id,
        'station-notice',
        true,
      ),
    ).rejects.toMatchObject({ code: 'subscriber_mismatch' });
  });

  it('blocks deletion while the declared subscriber still owns private configuration', async () => {
    const fixture = createFixture();
    const created = await fixture.service.create({
      enabled: true,
      name: '删除校验',
      sourceConfig: { resourceId: 'resource-1' },
      subscriberKey: 'qqbot',
      templateIds: ['101'],
    });
    fixture.setReferenceCount(1);

    await expect(fixture.service.remove(created.id)).rejects.toBeInstanceOf(
      SystemMessageContractError,
    );
    expect(fixture.subscriptions[0].isDeleted).toBe(false);
  });

  it('maps duplicate active subscriptions to a conflict response', async () => {
    const fixture = createFixture();
    const input = {
      enabled: true,
      name: '重复订阅',
      sourceConfig: { resourceId: 'resource-1' },
      subscriberKey: 'qqbot',
      templateIds: ['101'],
    };
    await fixture.service.create(input);

    await expect(fixture.service.create(input)).rejects.toBeInstanceOf(
      HttpException,
    );
  });
});

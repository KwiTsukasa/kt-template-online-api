import { QqbotAccountMessagePushService } from '../../../../src/modules/qqbot/core/application/message-push/qqbot-account-message-push.service';
import { SystemMessageContractError } from '../../../../src/modules/qqbot/core/contract/message-push/qqbot-message-push.types';
import { QqbotMessagePublishBinding } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-publish-binding.entity';
import { QqbotMessagePublishTarget } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-publish-target.entity';

describe('QqbotAccountMessagePushService', () => {
  it('normalizes targets without number coercion and rejects invalid manual values', () => {
    const service = new QqbotAccountMessagePushService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    expect(
      (service as any).normalizeTargets([
        {
          targetId: ' 20000000000000001 ',
          targetName: '  群  ',
          targetType: 'group',
        },
        { targetId: '20000000000000001', targetType: 'private' },
        {
          targetId: '20000000000000001',
          targetName: '覆盖',
          targetType: 'group',
        },
      ]),
    ).toEqual([
      {
        targetId: '20000000000000001',
        targetName: '覆盖',
        targetType: 'group',
      },
      {
        targetId: '20000000000000001',
        targetName: null,
        targetType: 'private',
      },
    ]);
    expect(() =>
      (service as any).normalizeTargets([
        { targetId: '00001', targetType: 'group' },
      ]),
    ).toThrow(new SystemMessageContractError('invalid_target_id'));
    expect(() =>
      (service as any).normalizeTargets([
        { targetId: '10001', targetType: 'channel' },
      ]),
    ).toThrow(new SystemMessageContractError('invalid_target_type'));
  });

  it('holds subscription then template gates through multi-target persistence without coercing IDs', async () => {
    const events: string[] = [];
    const targetRows: any[] = [];
    const subscription = {
      enabled: true,
      id: '2041700000000000001',
      isDeleted: false,
      name: '订阅',
      sourceConfig: {},
      sourceKey: 'network.stun.mapping-port-changed',
    };
    const template = {
      content: '正文',
      enabled: true,
      id: '2041700000000000002',
      isDeleted: false,
      name: '模板',
      sourceKey: subscription.sourceKey,
    };
    const bindingStore = {
      create: (value: any) => ({
        ...value,
        createTime: '2026-07-24',
        id: '2041700000000000003',
        updateTime: '2026-07-24',
      }),
      findOne: jest.fn().mockResolvedValue(null),
      save: async (value: any) => {
        events.push('binding');
        return value;
      },
    };
    const targetStore = {
      create: (value: any) => ({
        ...value,
        createTime: '2026-07-24',
        id: `target-${targetRows.length + 1}`,
        updateTime: '2026-07-24',
      }),
      find: jest.fn().mockResolvedValue([]),
      save: async (values: any[]) => {
        events.push('targets');
        targetRows.splice(0, targetRows.length, ...values);
        return values;
      },
    };
    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === QqbotMessagePublishBinding) return bindingStore;
        if (entity === QqbotMessagePublishTarget) return targetStore;
        throw new Error('unexpected repository');
      },
    };
    const service = new QqbotAccountMessagePushService(
      {
        manager: { transaction: async (callback: any) => callback(manager) },
      } as never,
      { find: async () => targetRows } as never,
      { findOne: async () => subscription } as never,
      { findOne: async () => template } as never,
      {
        findBySelfId: async () => ({
          id: '2041700000000000000',
          selfId: '10000000000000001',
        }),
      } as never,
      {
        requireAvailableForBinding: async () => {
          events.push('subscription');
          return subscription;
        },
      } as never,
      {
        requireAvailableForBinding: async () => {
          events.push('template');
          return template;
        },
      } as never,
      {
        get: () => ({
          definition: { displayName: 'STUN 映射', variables: [] },
          inspectSubscription: async () => ({ valid: true }),
        }),
      } as never,
      { validate: jest.fn() } as never,
    );

    await expect(
      service.createBinding('10000000000000001', {
        enabled: true,
        subscriptionId: '2041700000000000001',
        templateId: '2041700000000000002',
        targets: [
          { targetId: '20000000000000001', targetType: 'group' },
          { targetId: '30000000000000001', targetType: 'private' },
        ],
      }),
    ).resolves.toMatchObject({
      id: '2041700000000000003',
      targets: [
        { targetId: '20000000000000001', targetType: 'group' },
        { targetId: '30000000000000001', targetType: 'private' },
      ],
    });
    expect(events).toEqual(['subscription', 'template', 'binding', 'targets']);
  });

  it('falls back to a new binding when the selected historical row changes before its write lock', async () => {
    const historical = {
      accountId: 'account-1',
      activeKey: null,
      id: 'historical-1',
      isDeleted: true,
      selfId: '10001',
      subscriptionId: 'subscription-1',
      templateId: 'template-1',
      updateTime: '2026-07-24',
    };
    const saved: any[] = [];
    const subscription = {
      enabled: true,
      id: 'subscription-1',
      isDeleted: false,
      name: '订阅',
      sourceConfig: {},
      sourceKey: 'network.stun.mapping-port-changed',
    };
    const template = {
      content: '正文',
      enabled: true,
      id: 'template-1',
      isDeleted: false,
      name: '模板',
      sourceKey: subscription.sourceKey,
    };
    const targets: any[] = [];
    const bindingStore = {
      create: jest.fn((value) => ({
        ...value,
        createTime: '2026-07-24',
        id: 'new-binding-1',
        updateTime: '2026-07-24',
      })),
      findOne: jest.fn(async (options) => {
        const where = options.where as Record<string, unknown>;
        if ('activeKey' in where) return null;
        if ('subscriptionId' in where && !options.lock) return historical;
        if (options.lock?.mode === 'pessimistic_write') {
          Object.assign(historical, {
            accountId: 'account-2',
            selfId: '10002',
            subscriptionId: 'subscription-2',
          });
          return null;
        }
        throw new Error('unexpected binding lookup');
      }),
      save: jest.fn(async (value) => {
        saved.push(value);
        return value;
      }),
    };
    const targetStore = {
      create: jest.fn((value) => ({ ...value, id: 'target-1' })),
      find: jest.fn(async () => []),
      save: jest.fn(async (values) => {
        targets.splice(0, targets.length, ...values);
        return values;
      }),
    };
    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === QqbotMessagePublishBinding) return bindingStore;
        if (entity === QqbotMessagePublishTarget) return targetStore;
        throw new Error('unexpected repository');
      },
    };
    const service = new QqbotAccountMessagePushService(
      {
        manager: { transaction: async (callback: any) => callback(manager) },
      } as never,
      { find: async () => targets } as never,
      { findOne: async () => subscription } as never,
      { findOne: async () => template } as never,
      {
        findBySelfId: async () => ({ id: 'account-1', selfId: '10001' }),
      } as never,
      { requireAvailableForBinding: async () => subscription } as never,
      { requireAvailableForBinding: async () => template } as never,
      {
        get: () => ({
          definition: { displayName: 'STUN 映射', variables: [] },
          inspectSubscription: async () => ({ valid: true }),
        }),
      } as never,
      { validate: jest.fn() } as never,
    );

    await expect(
      service.createBinding('10001', {
        enabled: true,
        subscriptionId: 'subscription-1',
        templateId: 'template-1',
        targets: [{ targetId: '20001', targetType: 'group' }],
      }),
    ).resolves.toEqual(expect.objectContaining({ id: 'new-binding-1' }));
    expect(bindingStore.findOne).toHaveBeenLastCalledWith({
      lock: { mode: 'pessimistic_write' },
      where: {
        accountId: 'account-1',
        id: 'historical-1',
        isDeleted: true,
        selfId: '10001',
        subscriptionId: 'subscription-1',
      },
    });
    expect(saved).toEqual([
      expect.objectContaining({ id: 'new-binding-1', isDeleted: false }),
    ]);
    expect(saved[0].id).not.toBe(historical.id);
  });

  it('uses binding_disabled for missing and stale binding mutation snapshots', async () => {
    const unavailable = () =>
      new QqbotAccountMessagePushService(
        {
          manager: {
            transaction: async (callback: any) =>
              callback({
                getRepository: () => ({ findOne: async () => null }),
              }),
          },
        } as never,
        {} as never,
        {} as never,
        {} as never,
        {
          findBySelfId: async () => ({ id: 'account-1', selfId: '10001' }),
        } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );
    const input = {
      enabled: false,
      subscriptionId: 'subscription-1',
      targets: [],
      templateId: 'template-1',
    };

    await expect(
      unavailable().updateBinding('10001', 'missing', input),
    ).rejects.toMatchObject({ code: 'binding_disabled' });
    await expect(
      unavailable().setBindingEnabled('10001', 'missing', true),
    ).rejects.toMatchObject({ code: 'binding_disabled' });
    await expect(
      unavailable().removeBinding('10001', 'missing'),
    ).rejects.toMatchObject({ code: 'binding_disabled' });
  });

  it('redacts deleted legacy dependency metadata from unavailable binding views', async () => {
    const binding = {
      accountId: 'account-1',
      createTime: '2026-07-24',
      enabled: false,
      id: 'binding-1',
      isDeleted: false,
      selfId: '10001',
      subscriptionId: 'subscription-1',
      templateId: 'template-1',
      updateTime: '2026-07-24',
    };
    const service = new QqbotAccountMessagePushService(
      { find: async () => [binding] } as never,
      { find: async () => [] } as never,
      { findOne: jest.fn(async () => null) } as never,
      { findOne: jest.fn(async () => null) } as never,
      {
        findBySelfId: async () => ({ id: 'account-1', selfId: '10001' }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.listBindings('10001')).resolves.toEqual([
      expect.objectContaining({
        available: false,
        invalidReasonCode: 'invalid_source_config',
        sourceKey: '',
        sourceName: '',
        subscriptionName: '',
        templateName: '',
      }),
    ]);
  });
});

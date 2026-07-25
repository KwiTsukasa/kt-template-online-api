import { HttpStatus } from '@nestjs/common';
import { QqbotAccountMessagePushService } from '../../../../src/modules/qqbot/core/application/message-push/qqbot-account-message-push.service';
import { SystemMessageContractError } from '../../../../src/modules/qqbot/core/contract/message-push/qqbot-message-push.types';
import { QqbotMessagePublishBinding } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-publish-binding.entity';
import { QqbotMessagePublishTarget } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-publish-target.entity';
import { QqbotMessageDelivery } from '../../../../src/modules/qqbot/core/infrastructure/persistence/message-push/qqbot-message-delivery.entity';

const ACCOUNT = {
  id: '2041700000000000000',
  selfId: '10000000000000001',
};
const SOURCE_KEY = 'network.stun.mapping-port-changed';

type BindingFixtureOptions = {
  bindingSaveError?: unknown;
  bindings?: any[];
  subscriptionGateError?: Error;
  targetSaveError?: unknown;
  targets?: any[];
  templateGateError?: Error;
};

function bindingRow(overrides: Record<string, unknown> = {}): any {
  return {
    accountId: ACCOUNT.id,
    activeKey: `${ACCOUNT.id}:2041700000000000001`,
    createTime: '2026-07-24 00:00:00',
    enabled: true,
    id: '2041700000000000003',
    isDeleted: false,
    selfId: ACCOUNT.selfId,
    subscriptionId: '2041700000000000001',
    templateId: '2041700000000000002',
    updateTime: '2026-07-24 00:00:00',
    ...overrides,
  };
}

function targetRow(overrides: Record<string, unknown> = {}): any {
  const bindingId = String(overrides.bindingId ?? '2041700000000000003');
  const targetId = String(overrides.targetId ?? '20000000000000001');
  const targetType = String(overrides.targetType ?? 'group');
  return {
    activeKey: `${bindingId}:${targetType}:${targetId}`,
    bindingId,
    createTime: '2026-07-24 00:00:00',
    enabled: true,
    id: 'target-1',
    isDeleted: false,
    targetId,
    targetName: null,
    targetType,
    updateTime: '2026-07-24 00:00:00',
    ...overrides,
  };
}

function setupBindingFixture(options: BindingFixtureOptions = {}) {
  const bindings = options.bindings ?? [];
  const targets = options.targets ?? [];
  const events: string[] = [];
  let nextBindingId = 4;
  let nextTargetId = 1;
  const subscription = {
    enabled: true,
    id: '2041700000000000001',
    isDeleted: false,
    name: '订阅',
    sourceConfig: {},
    sourceKey: SOURCE_KEY,
  };
  const template = {
    content: '正文',
    enabled: true,
    id: '2041700000000000002',
    isDeleted: false,
    name: '模板',
    sourceKey: SOURCE_KEY,
  };
  const bindingStore = {
    create: jest.fn((value: any) =>
      bindingRow({ id: `204170000000000000${nextBindingId++}`, ...value }),
    ),
    find: jest.fn(async () => bindings),
    findOne: jest.fn(async (query: any) => {
      const where = query.where as Record<string, unknown>;
      const matching = bindings.filter((row) =>
        Object.entries(where).every(([key, value]) => row[key] === value),
      );
      if (query.order?.updateTime === 'DESC') {
        return (
          matching.sort((left, right) => {
            const time = String(right.updateTime).localeCompare(
              String(left.updateTime),
            );
            return time || String(right.id).localeCompare(String(left.id));
          })[0] ?? null
        );
      }
      return matching[0] ?? null;
    }),
    save: jest.fn(async (row: any) => {
      if (options.bindingSaveError) throw options.bindingSaveError;
      const existing = bindings.find((candidate) => candidate.id === row.id);
      if (existing) Object.assign(existing, row);
      else bindings.push(row);
      events.push('binding:save');
      return row;
    }),
  };
  const targetStore = {
    create: jest.fn((value: any) =>
      targetRow({
        createTime: `2026-07-25 00:00:0${nextTargetId}`,
        id: `target-new-${nextTargetId++}`,
        ...value,
      }),
    ),
    find: jest.fn(async (query: any) => {
      const where = query.where as Record<string, unknown>;
      return targets
        .filter((row) =>
          Object.entries(where).every(([key, value]) => row[key] === value),
        )
        .sort((left, right) => {
          const time = String(left.createTime).localeCompare(
            String(right.createTime),
          );
          return time || String(left.id).localeCompare(String(right.id));
        });
    }),
    save: jest.fn(async (rows: any[]) => {
      if (options.targetSaveError) throw options.targetSaveError;
      rows.forEach((row) => {
        const existing = targets.find((candidate) => candidate.id === row.id);
        if (existing) Object.assign(existing, row);
        else targets.push(row);
      });
      events.push('targets:save');
      return rows;
    }),
  };
  const manager = {
    getRepository: jest.fn((entity) => {
      if (entity === QqbotMessagePublishBinding) return bindingStore;
      if (entity === QqbotMessagePublishTarget) return targetStore;
      if (entity === QqbotMessageDelivery) {
        return { update: jest.fn(async () => ({ affected: 0 })) };
      }
      throw new Error('unexpected repository');
    }),
  };
  const transaction = jest.fn(async (callback: any) => {
    events.push('transaction:start');
    const result = await callback(manager);
    events.push('transaction:commit');
    return result;
  });
  Object.assign(bindingStore, { manager: { transaction } });
  const subscriptionGate = jest.fn(async (...args: any[]) => {
    events.push(`subscription:${args[2]}`);
    if (options.subscriptionGateError) throw options.subscriptionGateError;
    return subscription;
  });
  const templateGate = jest.fn(async (...args: any[]) => {
    events.push(`template:${args[3]}`);
    if (options.templateGateError) throw options.templateGateError;
    return template;
  });
  return {
    bindings,
    bindingStore,
    events,
    manager,
    service: new QqbotAccountMessagePushService(
      bindingStore as never,
      targetStore as never,
      { findOne: async () => subscription } as never,
      { findOne: async () => template } as never,
      { findBySelfId: async () => ACCOUNT } as never,
      { requireAvailableForBinding: subscriptionGate } as never,
      { requireAvailableForBinding: templateGate } as never,
      {
        get: () => ({
          definition: { displayName: 'STUN 映射', variables: [] },
          inspectSubscription: async () => ({ valid: true }),
        }),
      } as never,
      { validate: jest.fn() } as never,
    ),
    subscriptionGate,
    targetStore,
    targets,
    templateGate,
    transaction,
  };
}

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

  describe('binding and target delivery cancellation transaction', () => {
    function cancellationHarness() {
      const subscription = {
        enabled: true,
        id: '2041700000000000001',
        isDeleted: false,
        name: '订阅',
        sourceConfig: {},
        sourceKey: SOURCE_KEY,
      };
      const template = {
        content: '正文',
        enabled: true,
        id: '2041700000000000002',
        isDeleted: false,
        name: '模板',
        sourceKey: SOURCE_KEY,
      };
      const bindings = [bindingRow()];
      const targets = [
        targetRow({ id: 'target-retained' }),
        targetRow({
          id: 'target-removed',
          targetId: '30000000000000001',
          targetType: 'private',
        }),
      ];
      const deliveries = [
        ...['waiting_ddns', 'pending', 'retry', 'processing', 'success'].map(
          (status) => ({
            bindingId: bindings[0].id,
            frozen: `binding-${status}`,
            id: `binding-${status}`,
            nextAttemptAt: `schedule-${status}`,
            processingLeaseUntil: `lease-${status}`,
            publishTargetId: 'target-retained',
            status,
          }),
        ),
        {
          bindingId: bindings[0].id,
          frozen: 'removed',
          id: 'removed-target-delivery',
          nextAttemptAt: 'schedule-removed',
          processingLeaseUntil: 'lease-removed',
          publishTargetId: 'target-removed',
          status: 'pending',
        },
        {
          bindingId: 'other-binding',
          frozen: 'other-binding',
          id: 'other-binding-delivery',
          nextAttemptAt: 'schedule-other',
          processingLeaseUntil: 'lease-other',
          publishTargetId: 'other-target',
          status: 'pending',
        },
      ];
      const deliveryUpdates: Array<Record<string, unknown>> = [];
      let failCancellation = false;
      let nextTargetId = 1;
      const transaction = jest.fn(
        async (work: (manager: any) => Promise<unknown>) => {
          const draftBindings = structuredClone(bindings);
          const draftTargets = structuredClone(targets);
          const draftDeliveries = structuredClone(deliveries);
          const bindingStore = {
            create: (value: Record<string, unknown>) => bindingRow(value),
            findOne: jest.fn(
              async ({ where }: { where: Record<string, unknown> }) =>
                structuredClone(
                  draftBindings.find((row) =>
                    Object.entries(where).every(
                      ([key, value]) => row[key] === value,
                    ),
                  ) ?? null,
                ),
            ),
            save: jest.fn(async (row: Record<string, unknown>) => {
              const index = draftBindings.findIndex(
                (candidate) => candidate.id === row.id,
              );
              if (index >= 0) draftBindings[index] = structuredClone(row);
              else draftBindings.push(structuredClone(row));
              return row;
            }),
          };
          const targetStore = {
            create: (value: Record<string, unknown>) =>
              targetRow({ id: `target-new-${nextTargetId++}`, ...value }),
            find: jest.fn(
              async ({ where }: { where: Record<string, unknown> }) =>
                structuredClone(
                  draftTargets.filter((row) =>
                    Object.entries(where).every(
                      ([key, value]) => row[key] === value,
                    ),
                  ),
                ),
            ),
            save: jest.fn(async (rows: Array<Record<string, unknown>>) => {
              rows.forEach((row) => {
                const index = draftTargets.findIndex(
                  (candidate) => candidate.id === row.id,
                );
                if (index >= 0) draftTargets[index] = structuredClone(row);
                else draftTargets.push(structuredClone(row));
              });
              return rows;
            }),
          };
          const manager = {
            getRepository: (entity: unknown) => {
              if (entity === QqbotMessagePublishBinding) return bindingStore;
              if (entity === QqbotMessagePublishTarget) return targetStore;
              if (entity === QqbotMessageDelivery) {
                return {
                  update: async (
                    where: Record<string, any>,
                    patch: Record<string, unknown>,
                  ) => {
                    deliveryUpdates.push(where);
                    const statuses = where.status._value as string[];
                    const targetIds = where.publishTargetId?._value as
                      | string[]
                      | undefined;
                    let affected = 0;
                    draftDeliveries.forEach((row) => {
                      const identityMatches =
                        (where.bindingId &&
                          row.bindingId === where.bindingId) ||
                        (targetIds &&
                          targetIds.includes(String(row.publishTargetId)));
                      if (identityMatches && statuses.includes(row.status)) {
                        Object.assign(row, patch);
                        affected += 1;
                      }
                    });
                    if (failCancellation) {
                      throw new Error('delivery cancellation failed');
                    }
                    return { affected };
                  },
                };
              }
              throw new Error('unexpected cancellation repository');
            },
          };
          const result = await work(manager);
          bindings.splice(0, bindings.length, ...draftBindings);
          targets.splice(0, targets.length, ...draftTargets);
          deliveries.splice(0, deliveries.length, ...draftDeliveries);
          return result;
        },
      );
      const outerBindingRepository = {
        find: async () => bindings,
        manager: { transaction },
      };
      const service = new QqbotAccountMessagePushService(
        outerBindingRepository as never,
        {
          find: async ({ where }: { where: Record<string, unknown> }) =>
            targets.filter((row) =>
              Object.entries(where).every(([key, value]) => row[key] === value),
            ),
        } as never,
        { findOne: async () => subscription } as never,
        { findOne: async () => template } as never,
        { findBySelfId: async () => ACCOUNT } as never,
        {
          requireAvailableForBinding: async (
            _manager: unknown,
            subscriptionId: string,
          ) => ({ ...subscription, id: subscriptionId }),
        } as never,
        {
          requireAvailableForBinding: async (
            _manager: unknown,
            templateId: string,
          ) => ({ ...template, id: templateId }),
        } as never,
        {
          get: () => ({
            definition: { displayName: 'STUN 映射', variables: [] },
            inspectSubscription: async () => ({ valid: true }),
          }),
        } as never,
        { validate: jest.fn() } as never,
      );
      return {
        bindings,
        deliveries,
        deliveryUpdates,
        failCancellation: () => {
          failCancellation = true;
        },
        service,
        targets,
      };
    }

    it.each([
      [
        'disable',
        async (service: QqbotAccountMessagePushService) =>
          service.setBindingEnabled(ACCOUNT.selfId, bindingRow().id, false),
      ],
      [
        'remove',
        async (service: QqbotAccountMessagePushService) =>
          service.removeBinding(ACCOUNT.selfId, bindingRow().id),
      ],
      [
        'subscription change',
        async (service: QqbotAccountMessagePushService) =>
          service.updateBinding(ACCOUNT.selfId, bindingRow().id, {
            enabled: true,
            subscriptionId: '2041700000000000099',
            targets: [
              { targetId: '20000000000000001', targetType: 'group' },
              { targetId: '30000000000000001', targetType: 'private' },
            ],
            templateId: bindingRow().templateId,
          }),
      ],
    ])(
      '%s cancels only exact binding unfinished rows',
      async (_name, mutate) => {
        const harness = cancellationHarness();
        const before = structuredClone(harness.deliveries);

        await mutate(harness.service);

        expect(harness.deliveries).toEqual(
          before.map((delivery) =>
            delivery.bindingId === bindingRow().id &&
            ['waiting_ddns', 'pending', 'retry'].includes(delivery.status)
              ? {
                  ...delivery,
                  nextAttemptAt: null,
                  processingLeaseUntil: null,
                  status: 'cancelled',
                }
              : delivery,
          ),
        );
      },
    );

    it('keeps frozen deliveries on template-only switch', async () => {
      const harness = cancellationHarness();
      const before = structuredClone(harness.deliveries);

      await harness.service.updateBinding(ACCOUNT.selfId, bindingRow().id, {
        enabled: true,
        subscriptionId: bindingRow().subscriptionId,
        targets: [
          { targetId: '20000000000000001', targetType: 'group' },
          { targetId: '30000000000000001', targetType: 'private' },
        ],
        templateId: '2041700000000000098',
      });

      expect(harness.deliveries).toEqual(before);
      expect(harness.deliveryUpdates).toHaveLength(0);
    });

    it('target synchronization cancels only removed target IDs and retains new/sibling scopes', async () => {
      const harness = cancellationHarness();
      const before = structuredClone(harness.deliveries);

      await harness.service.updateBinding(ACCOUNT.selfId, bindingRow().id, {
        enabled: true,
        subscriptionId: bindingRow().subscriptionId,
        targets: [
          { targetId: '20000000000000001', targetType: 'group' },
          { targetId: '40000000000000001', targetType: 'private' },
        ],
        templateId: bindingRow().templateId,
      });

      expect(harness.deliveries).toEqual(
        before.map((delivery) =>
          delivery.id === 'removed-target-delivery'
            ? {
                ...delivery,
                nextAttemptAt: null,
                processingLeaseUntil: null,
                status: 'cancelled',
              }
            : delivery,
        ),
      );
      expect(
        harness.targets.find((target) => target.id === 'target-retained'),
      ).toMatchObject({ enabled: true, isDeleted: false });
      expect(
        harness.targets.find((target) => target.id === 'target-new-1'),
      ).toMatchObject({ enabled: true, isDeleted: false });
    });

    it('rolls back binding, target, and cancellation drafts on a cancellation write failure', async () => {
      const harness = cancellationHarness();
      const before = {
        bindings: structuredClone(harness.bindings),
        deliveries: structuredClone(harness.deliveries),
        targets: structuredClone(harness.targets),
      };
      harness.failCancellation();

      await expect(
        harness.service.updateBinding(ACCOUNT.selfId, bindingRow().id, {
          enabled: false,
          subscriptionId: bindingRow().subscriptionId,
          targets: [{ targetId: '20000000000000001', targetType: 'group' }],
          templateId: bindingRow().templateId,
        }),
      ).rejects.toThrow('delivery cancellation failed');

      expect(harness.bindings).toEqual(before.bindings);
      expect(harness.targets).toEqual(before.targets);
      expect(harness.deliveries).toEqual(before.deliveries);
    });
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

  it('revives the newest matching deleted binding under its revalidated write lock', async () => {
    const older = bindingRow({
      activeKey: null,
      id: '2041700000000000004',
      isDeleted: true,
      templateId: 'old-template',
      updateTime: '2026-07-23 00:00:00',
    });
    const newest = bindingRow({
      activeKey: null,
      enabled: false,
      id: '2041700000000000005',
      isDeleted: true,
      templateId: 'old-template',
      updateTime: '2026-07-24 00:00:00',
    });
    const fixture = setupBindingFixture({ bindings: [older, newest] });

    await expect(
      fixture.service.createBinding(ACCOUNT.selfId, {
        enabled: true,
        subscriptionId: '2041700000000000001',
        templateId: '2041700000000000002',
        targets: [
          {
            targetId: '20000000000000001',
            targetName: '新群名',
            targetType: 'group',
          },
        ],
      }),
    ).resolves.toMatchObject({
      id: '2041700000000000005',
      targets: [
        {
          id: 'target-new-1',
          targetId: '20000000000000001',
          targetName: '新群名',
          targetType: 'group',
        },
      ],
    });

    expect(fixture.bindingStore.findOne).toHaveBeenNthCalledWith(1, {
      where: {
        activeKey: `${ACCOUNT.id}:2041700000000000001`,
        isDeleted: false,
      },
    });
    expect(fixture.bindingStore.findOne).toHaveBeenCalledWith({
      lock: { mode: 'pessimistic_write' },
      where: {
        accountId: ACCOUNT.id,
        id: '2041700000000000005',
        isDeleted: true,
        selfId: ACCOUNT.selfId,
        subscriptionId: '2041700000000000001',
      },
    });
    expect(newest).toMatchObject({
      activeKey: `${ACCOUNT.id}:2041700000000000001`,
      enabled: true,
      id: '2041700000000000005',
      isDeleted: false,
      templateId: '2041700000000000002',
    });
    expect(fixture.bindingStore.create).not.toHaveBeenCalled();
    expect(fixture.events).toEqual([
      'transaction:start',
      'subscription:true',
      'template:true',
      'binding:save',
      'targets:save',
      'transaction:commit',
    ]);
  });

  it('synchronizes retained, revived, inserted, and removed targets before commit', async () => {
    const binding = bindingRow();
    const retained = targetRow({
      createTime: '2026-07-24 00:00:01',
      id: 'target-retained',
      targetId: '20000000000000001',
      targetName: '旧名称',
    });
    const revived = targetRow({
      activeKey: null,
      createTime: '2026-07-24 00:00:02',
      enabled: false,
      id: 'target-revived',
      isDeleted: true,
      targetId: '30000000000000001',
      targetName: '历史名称',
      targetType: 'private',
    });
    const removed = targetRow({
      createTime: '2026-07-24 00:00:03',
      id: 'target-removed',
      targetId: '40000000000000001',
      targetName: '待移除',
    });
    const fixture = setupBindingFixture({
      bindings: [binding],
      targets: [retained, revived, removed],
    });

    await expect(
      fixture.service.updateBinding(ACCOUNT.selfId, binding.id, {
        enabled: true,
        subscriptionId: binding.subscriptionId,
        templateId: binding.templateId,
        targets: [
          {
            targetId: retained.targetId,
            targetName: '保留后的名称',
            targetType: 'group',
          },
          {
            targetId: revived.targetId,
            targetName: '复活后的名称',
            targetType: 'private',
          },
          {
            targetId: '50000000000000001',
            targetName: '新增私聊',
            targetType: 'private',
          },
        ],
      }),
    ).resolves.toMatchObject({
      id: binding.id,
      targets: [
        {
          id: 'target-retained',
          targetId: '20000000000000001',
          targetName: '保留后的名称',
          targetType: 'group',
        },
        {
          id: 'target-revived',
          targetId: '30000000000000001',
          targetName: '复活后的名称',
          targetType: 'private',
        },
        {
          id: 'target-new-1',
          targetId: '50000000000000001',
          targetName: '新增私聊',
          targetType: 'private',
        },
      ],
    });

    expect(retained).toMatchObject({
      activeKey: `${binding.id}:group:20000000000000001`,
      enabled: true,
      isDeleted: false,
      targetName: '保留后的名称',
    });
    expect(revived).toMatchObject({
      activeKey: `${binding.id}:private:30000000000000001`,
      enabled: true,
      id: 'target-revived',
      isDeleted: false,
      targetName: '复活后的名称',
    });
    expect(removed).toMatchObject({
      activeKey: null,
      enabled: false,
      isDeleted: true,
      targetId: '40000000000000001',
    });
    expect(fixture.targetStore.find).toHaveBeenCalledWith({
      lock: { mode: 'pessimistic_write' },
      order: { createTime: 'ASC', id: 'ASC' },
      where: { bindingId: binding.id },
    });
    expect(fixture.events).toEqual([
      'transaction:start',
      'subscription:true',
      'template:true',
      'binding:save',
      'targets:save',
      'transaction:commit',
    ]);
  });

  it('retires only the requested account binding and all of its active targets atomically', async () => {
    const binding = bindingRow();
    const ownTarget = targetRow({ id: 'target-own' });
    const historicalTarget = targetRow({
      activeKey: null,
      enabled: false,
      id: 'target-historical',
      isDeleted: true,
      targetId: '30000000000000001',
    });
    const foreignTarget = targetRow({
      bindingId: 'foreign-binding',
      id: 'target-foreign',
      targetId: '40000000000000001',
    });
    const fixture = setupBindingFixture({
      bindings: [binding],
      targets: [ownTarget, historicalTarget, foreignTarget],
    });

    await expect(
      fixture.service.removeBinding(ACCOUNT.selfId, binding.id),
    ).resolves.toBe(true);

    expect(fixture.bindingStore.findOne).toHaveBeenCalledTimes(1);
    expect(fixture.bindingStore.findOne).toHaveBeenCalledWith({
      lock: { mode: 'pessimistic_write' },
      where: { accountId: ACCOUNT.id, id: binding.id, isDeleted: false },
    });
    expect(fixture.targetStore.find).toHaveBeenCalledWith({
      lock: { mode: 'pessimistic_write' },
      where: { bindingId: binding.id, isDeleted: false },
    });
    expect(fixture.targetStore.save).toHaveBeenCalledWith([ownTarget]);
    expect(binding).toMatchObject({
      activeKey: null,
      enabled: false,
      isDeleted: true,
    });
    expect(ownTarget).toMatchObject({
      activeKey: null,
      enabled: false,
      isDeleted: true,
    });
    expect(historicalTarget).toMatchObject({
      activeKey: null,
      enabled: false,
      isDeleted: true,
    });
    expect(foreignTarget).toMatchObject({
      activeKey: 'foreign-binding:group:40000000000000001',
      enabled: true,
      isDeleted: false,
    });
    expect(fixture.events).toEqual([
      'transaction:start',
      'targets:save',
      'binding:save',
      'transaction:commit',
    ]);
  });

  it('rejects deleted and cross-account removals with the approved binding_disabled code', async () => {
    const deleted = setupBindingFixture({
      bindings: [bindingRow({ isDeleted: true })],
    });
    const crossAccount = setupBindingFixture({
      bindings: [bindingRow({ accountId: 'other-account' })],
    });

    await expect(
      deleted.service.removeBinding(ACCOUNT.selfId, '2041700000000000003'),
    ).rejects.toMatchObject({ code: 'binding_disabled' });
    await expect(
      crossAccount.service.removeBinding(ACCOUNT.selfId, '2041700000000000003'),
    ).rejects.toMatchObject({ code: 'binding_disabled' });
  });

  it('uses subscription then template gates for enabled create, update, and toggle persistence', async () => {
    const create = setupBindingFixture();
    const updateBinding = bindingRow({ enabled: false });
    const update = setupBindingFixture({ bindings: [updateBinding] });
    const toggleBinding = bindingRow({ enabled: false });
    const toggle = setupBindingFixture({ bindings: [toggleBinding] });
    const input = {
      enabled: true,
      subscriptionId: '2041700000000000001',
      templateId: '2041700000000000002',
      targets: [
        { targetId: '20000000000000001', targetType: 'group' as const },
      ],
    };

    await expect(
      create.service.createBinding(ACCOUNT.selfId, input),
    ).resolves.toMatchObject({ enabled: true });
    await expect(
      update.service.updateBinding(ACCOUNT.selfId, updateBinding.id, input),
    ).resolves.toMatchObject({ enabled: true });
    await expect(
      toggle.service.setBindingEnabled(ACCOUNT.selfId, toggleBinding.id, true),
    ).resolves.toMatchObject({ enabled: true });

    for (const fixture of [create, update, toggle]) {
      expect(fixture.subscriptionGate).toHaveBeenCalledWith(
        fixture.manager,
        '2041700000000000001',
        true,
      );
      expect(fixture.templateGate).toHaveBeenCalledWith(
        fixture.manager,
        '2041700000000000002',
        SOURCE_KEY,
        true,
      );
      expect(fixture.events.indexOf('subscription:true')).toBeLessThan(
        fixture.events.indexOf('template:true'),
      );
    }
    expect(updateBinding.enabled).toBe(true);
    expect(toggleBinding.enabled).toBe(true);
  });

  it('keeps source-compatible gates for disabled writes and persists nothing after gate rejection', async () => {
    const disabledCreate = setupBindingFixture();
    const disabledUpdateBinding = bindingRow();
    const disabledUpdate = setupBindingFixture({
      bindings: [disabledUpdateBinding],
    });
    const disabledToggleBinding = bindingRow();
    const disabledToggle = setupBindingFixture({
      bindings: [disabledToggleBinding],
    });
    const sourceMismatch = setupBindingFixture({
      templateGateError: new SystemMessageContractError('template_invalid'),
    });
    const disabledSubscription = setupBindingFixture({
      subscriptionGateError: new SystemMessageContractError(
        'subscription_disabled',
      ),
    });
    const disabledInput = {
      enabled: false,
      subscriptionId: '2041700000000000001',
      templateId: '2041700000000000002',
      targets: [
        { targetId: '20000000000000001', targetType: 'group' as const },
      ],
    };

    await expect(
      disabledCreate.service.createBinding(ACCOUNT.selfId, disabledInput),
    ).resolves.toMatchObject({ enabled: false });
    await expect(
      disabledUpdate.service.updateBinding(
        ACCOUNT.selfId,
        disabledUpdateBinding.id,
        disabledInput,
      ),
    ).resolves.toMatchObject({ enabled: false });
    await expect(
      disabledToggle.service.setBindingEnabled(
        ACCOUNT.selfId,
        disabledToggleBinding.id,
        false,
      ),
    ).resolves.toMatchObject({ enabled: false });
    for (const fixture of [disabledCreate, disabledUpdate, disabledToggle]) {
      expect(fixture.subscriptionGate).toHaveBeenCalledWith(
        fixture.manager,
        disabledInput.subscriptionId,
        false,
      );
      expect(fixture.templateGate).toHaveBeenCalledWith(
        fixture.manager,
        disabledInput.templateId,
        SOURCE_KEY,
        false,
      );
    }
    await expect(
      sourceMismatch.service.createBinding(ACCOUNT.selfId, disabledInput),
    ).rejects.toMatchObject({ code: 'template_invalid' });
    await expect(
      disabledSubscription.service.createBinding(ACCOUNT.selfId, {
        ...disabledInput,
        enabled: true,
      }),
    ).rejects.toMatchObject({ code: 'subscription_disabled' });
    for (const fixture of [sourceMismatch, disabledSubscription]) {
      expect(fixture.bindingStore.save).not.toHaveBeenCalled();
      expect(fixture.targetStore.save).not.toHaveBeenCalled();
    }
  });

  it('maps active-key conflicts and duplicate persistence races to Vben HTTP 409', async () => {
    const input = {
      enabled: true,
      subscriptionId: '2041700000000000001',
      templateId: '2041700000000000002',
      targets: [
        { targetId: '20000000000000001', targetType: 'group' as const },
      ],
    };
    const active = setupBindingFixture({ bindings: [bindingRow()] });
    const bindingRace = setupBindingFixture({
      bindingSaveError: { code: 'ER_DUP_ENTRY' },
    });
    const targetRace = setupBindingFixture({
      targetSaveError: { errno: 1062 },
    });

    await expect(
      active.service.createBinding(ACCOUNT.selfId, input),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
    await expect(
      bindingRace.service.createBinding(ACCOUNT.selfId, input),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
    await expect(
      targetRace.service.createBinding(ACCOUNT.selfId, input),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
  });

  it('rethrows non-duplicate persistence failures unchanged', async () => {
    const failure = new Error('database unavailable');
    const fixture = setupBindingFixture({ bindingSaveError: failure });

    await expect(
      fixture.service.createBinding(ACCOUNT.selfId, {
        enabled: true,
        subscriptionId: '2041700000000000001',
        templateId: '2041700000000000002',
        targets: [{ targetId: '20000000000000001', targetType: 'group' }],
      }),
    ).rejects.toBe(failure);
  });
});

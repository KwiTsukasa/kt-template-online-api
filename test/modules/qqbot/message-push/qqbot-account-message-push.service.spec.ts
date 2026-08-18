import { HttpStatus } from '@nestjs/common';
import { SystemMessageContractError } from '../../../../src/modules/message-management/contract/message-management.types';
import { QqbotAccountMessagePushService } from '../../../../src/modules/qqbot/message-management-adapter/qqbot-account-message-push.service';
import { QqbotMessageDelivery } from '../../../../src/modules/qqbot/message-management-adapter/qqbot-message-delivery.entity';
import { QqbotMessagePublishBinding } from '../../../../src/modules/qqbot/message-management-adapter/qqbot-message-publish-binding.entity';
import { QqbotMessagePublishTarget } from '../../../../src/modules/qqbot/message-management-adapter/qqbot-message-publish-target.entity';

const ACCOUNT = {
  id: '2041700000000000000',
  selfId: '10000000000000001',
};
const SUBSCRIPTION_ID = '2041700000000000001';

const bindingRow = (overrides: Record<string, unknown> = {}) => ({
  accountId: ACCOUNT.id,
  activeKey: `${ACCOUNT.id}:${SUBSCRIPTION_ID}`,
  createTime: '2026-08-18 08:00:00',
  enabled: true,
  id: 'binding-1',
  isDeleted: false,
  selfId: ACCOUNT.selfId,
  subscriptionId: SUBSCRIPTION_ID,
  updateTime: '2026-08-18 08:00:00',
  ...overrides,
});

const targetRow = (overrides: Record<string, unknown> = {}) => {
  const bindingId = String(overrides.bindingId ?? 'binding-1');
  const targetId = String(overrides.targetId ?? '20000000000000001');
  const targetType = String(overrides.targetType ?? 'group');
  return {
    activeKey: `${bindingId}:${targetType}:${targetId}`,
    bindingId,
    createTime: '2026-08-18 08:00:00',
    enabled: true,
    id: 'target-1',
    isDeleted: false,
    targetId,
    targetName: null,
    targetType,
    updateTime: '2026-08-18 08:00:00',
    ...overrides,
  };
};

const matchesWhere = (
  row: Record<string, unknown>,
  where: Record<string, unknown>,
) => Object.entries(where).every(([key, value]) => row[key] === value);

const createFixture = (input?: {
  accountAvailable?: boolean;
  bindings?: Array<Record<string, unknown>>;
  protocolError?: Error;
  targets?: Array<Record<string, unknown>>;
}) => {
  const bindings = input?.bindings ?? [];
  const targets = input?.targets ?? [];
  const deliveryUpdates: Array<{
    patch: Record<string, unknown>;
    where: Record<string, unknown>;
  }> = [];
  let bindingSequence = bindings.length + 1;
  let targetSequence = targets.length + 1;

  const bindingStore = {
    create: jest.fn((fields: Record<string, unknown>) =>
      bindingRow({ id: `binding-${bindingSequence++}`, ...fields }),
    ),
    find: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
      bindings.filter((row) => matchesWhere(row, where)),
    ),
    findOne: jest.fn(
      async ({
        order,
        where,
      }: {
        order?: unknown;
        where: Record<string, unknown>;
      }) => {
        const found = bindings.filter((row) => matchesWhere(row, where));
        if (order) {
          found.sort((left, right) =>
            String(right.updateTime).localeCompare(String(left.updateTime)),
          );
        }
        return found[0] ?? null;
      },
    ),
    save: jest.fn(async (row: Record<string, unknown>) => {
      const index = bindings.findIndex((item) => item.id === row.id);
      if (index >= 0) bindings[index] = row;
      if (index < 0) bindings.push(row);
      return row;
    }),
  };
  const targetStore = {
    create: jest.fn((fields: Record<string, unknown>) =>
      targetRow({ id: `target-${targetSequence++}`, ...fields }),
    ),
    find: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
      targets
        .filter((row) => matchesWhere(row, where))
        .sort((left, right) =>
          String(left.createTime).localeCompare(String(right.createTime)),
        ),
    ),
    save: jest.fn(async (rows: Array<Record<string, unknown>>) => {
      for (const row of rows) {
        const index = targets.findIndex((item) => item.id === row.id);
        if (index >= 0) targets[index] = row;
        if (index < 0) targets.push(row);
      }
      return rows;
    }),
  };
  const deliveryStore = {
    update: jest.fn(
      async (
        where: Record<string, unknown>,
        patch: Record<string, unknown>,
      ) => {
        deliveryUpdates.push({ patch, where });
        return { affected: 1 };
      },
    ),
  };
  const manager = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === QqbotMessagePublishBinding) return bindingStore;
      if (entity === QqbotMessagePublishTarget) return targetStore;
      if (entity === QqbotMessageDelivery) return deliveryStore;
      throw new Error('unexpected repository');
    }),
  };
  const transaction = jest.fn(
    async (work: (entityManager: typeof manager) => Promise<unknown>) =>
      work(manager),
  );
  Object.assign(bindingStore, {
    manager: {
      getRepository: manager.getRepository,
      transaction,
    },
  });

  const bindingProtocol = {
    inspect: jest.fn(async () => ({
      available: true,
      invalidReasonCode: null,
      sourceKey: 'network.stun.mapping-port-changed',
      sourceName: 'STUN 映射端口变化',
      subscriberKey: 'qqbot',
      subscriberName: 'QQBot',
      subscriptionName: '网络变化订阅',
      templates: [
        { id: 'template-2', name: '详细模板', sortOrder: 0 },
        { id: 'template-1', name: '简短模板', sortOrder: 1 },
      ],
    })),
    requireAvailable: jest.fn(async () => {
      if (input?.protocolError) throw input.protocolError;
    }),
  };
  const service = new QqbotAccountMessagePushService(
    bindingStore as never,
    targetStore as never,
    {
      findBySelfId: jest.fn(async () => {
        if (input?.accountAvailable === false) return null;
        return ACCOUNT;
      }),
    } as never,
    bindingProtocol as never,
  );

  return {
    bindingProtocol,
    bindings,
    deliveryUpdates,
    service,
    targets,
    transaction,
  };
};

describe('QqbotAccountMessagePushService', () => {
  it('normalizes target identities without numeric coercion and rejects invalid targets', () => {
    const fixture = createFixture();

    expect(
      (fixture.service as any).normalizeTargets([
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
      (fixture.service as any).normalizeTargets([
        { targetId: '00001', targetType: 'group' },
      ]),
    ).toThrow(new SystemMessageContractError('invalid_target_id'));
    expect(() =>
      (fixture.service as any).normalizeTargets([
        { targetId: '10001', targetType: 'channel' },
      ]),
    ).toThrow(new SystemMessageContractError('invalid_target_type'));
  });

  it('creates only QQBot private configuration and derives every template from the unified subscription', async () => {
    const fixture = createFixture();

    const view = await fixture.service.createBinding(ACCOUNT.selfId, {
      enabled: true,
      subscriptionId: SUBSCRIPTION_ID,
      targets: [
        {
          targetId: '20000000000000001',
          targetName: '通知群',
          targetType: 'group',
        },
      ],
    });

    expect(fixture.bindingProtocol.requireAvailable).toHaveBeenCalledWith(
      expect.anything(),
      SUBSCRIPTION_ID,
      'qqbot',
      true,
    );
    expect(fixture.bindings[0]).not.toHaveProperty('templateId');
    expect(view).toEqual(
      expect.objectContaining({
        sourceKey: 'network.stun.mapping-port-changed',
        subscriptionId: SUBSCRIPTION_ID,
        templates: [
          { id: 'template-2', name: '详细模板', sortOrder: 0 },
          { id: 'template-1', name: '简短模板', sortOrder: 1 },
        ],
      }),
    );
    expect(view.targets).toEqual([
      expect.objectContaining({
        targetId: '20000000000000001',
        targetType: 'group',
      }),
    ]);
  });

  it('propagates subscriber ownership rejection before persisting QQBot configuration', async () => {
    const fixture = createFixture({
      protocolError: new SystemMessageContractError('subscriber_mismatch'),
    });

    await expect(
      fixture.service.createBinding(ACCOUNT.selfId, {
        enabled: true,
        subscriptionId: SUBSCRIPTION_ID,
        targets: [],
      }),
    ).rejects.toMatchObject({ code: 'subscriber_mismatch' });
    expect(fixture.bindings).toHaveLength(0);
  });

  it('replaces the complete target set and cancels unfinished rows for removed targets', async () => {
    const fixture = createFixture({
      bindings: [bindingRow()],
      targets: [
        targetRow({ id: 'target-retained' }),
        targetRow({
          id: 'target-removed',
          targetId: '30000000000000001',
          targetType: 'private',
        }),
      ],
    });

    await fixture.service.updateBinding(ACCOUNT.selfId, 'binding-1', {
      enabled: true,
      subscriptionId: SUBSCRIPTION_ID,
      targets: [
        {
          targetId: '20000000000000001',
          targetName: '保留目标',
          targetType: 'group',
        },
      ],
    });

    expect(
      fixture.targets.find((target) => target.id === 'target-retained'),
    ).toEqual(expect.objectContaining({ enabled: true, isDeleted: false }));
    expect(
      fixture.targets.find((target) => target.id === 'target-removed'),
    ).toEqual(
      expect.objectContaining({
        activeKey: null,
        enabled: false,
        isDeleted: true,
      }),
    );
    expect(fixture.deliveryUpdates).toEqual([
      expect.objectContaining({
        patch: expect.objectContaining({ status: 'cancelled' }),
        where: expect.objectContaining({ publishTargetId: expect.anything() }),
      }),
    ]);
  });

  it('disabling a binding cancels only unfinished rows owned by that binding', async () => {
    const fixture = createFixture({ bindings: [bindingRow()] });

    const view = await fixture.service.setBindingEnabled(
      ACCOUNT.selfId,
      'binding-1',
      false,
    );

    expect(view.enabled).toBe(false);
    expect(fixture.bindingProtocol.requireAvailable).toHaveBeenCalledWith(
      expect.anything(),
      SUBSCRIPTION_ID,
      'qqbot',
      false,
    );
    expect(fixture.deliveryUpdates).toEqual([
      expect.objectContaining({
        where: expect.objectContaining({ bindingId: 'binding-1' }),
      }),
    ]);
  });

  it('soft-deletes a binding and its active targets in one transaction', async () => {
    const fixture = createFixture({
      bindings: [bindingRow()],
      targets: [targetRow()],
    });

    await expect(
      fixture.service.removeBinding(ACCOUNT.selfId, 'binding-1'),
    ).resolves.toBe(true);

    expect(fixture.bindings[0]).toEqual(
      expect.objectContaining({
        activeKey: null,
        enabled: false,
        isDeleted: true,
      }),
    );
    expect(fixture.targets[0]).toEqual(
      expect.objectContaining({
        activeKey: null,
        enabled: false,
        isDeleted: true,
      }),
    );
    expect(fixture.transaction).toHaveBeenCalledTimes(1);
  });

  it('maps duplicate active account subscriptions to HTTP 409', async () => {
    const fixture = createFixture({ bindings: [bindingRow()] });

    await expect(
      fixture.service.createBinding(ACCOUNT.selfId, {
        enabled: true,
        subscriptionId: SUBSCRIPTION_ID,
        targets: [],
      }),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
  });

  it('rejects an unknown QQBot account before reading subscriber configuration', async () => {
    const fixture = createFixture({ accountAvailable: false });

    await expect(fixture.service.listBindings('missing')).rejects.toMatchObject(
      { code: 'account_unavailable' },
    );
    expect(fixture.bindingProtocol.inspect).not.toHaveBeenCalled();
  });
});

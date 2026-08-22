import { KtDateTime } from '../../../../src/common';
import {
  deliveryRetryDelayMs,
  SystemMessageDeliveryRunnerService,
} from '../../../../src/modules/bot-adapter/message-management/bot-message-delivery-runner.service';
import {
  SYSTEM_MESSAGE_BATCH_SIZE,
  SYSTEM_MESSAGE_RETRY_BASE_MS,
  SYSTEM_MESSAGE_RETRY_MAX_MS,
} from '../../../../src/modules/message-management/application/system-message-runner.constants';
import { SystemMessageTemplateRendererService } from '../../../../src/modules/message-management/application/system-message-template-renderer.service';
import { BotSendAttemptError } from '../../../../src/modules/bot-adapter/core/application/send/bot-send.error';
import { BotAccount } from '../../../../src/modules/bot-adapter/core/infrastructure/persistence/account/bot-account.entity';
import { BotMessageDelivery } from '../../../../src/modules/bot-adapter/message-management/bot-message-delivery.entity';
import { BotMessagePublishBinding } from '../../../../src/modules/bot-adapter/message-management/bot-message-publish-binding.entity';
import { BotMessagePublishTarget } from '../../../../src/modules/bot-adapter/message-management/bot-message-publish-target.entity';

const NOW = new Date('2026-08-18T00:00:00.000Z');
const LEASE_UNTIL = new KtDateTime('2026-08-18T00:01:00.000Z');

const deliveryRow = (overrides: Partial<BotMessageDelivery> = {}) =>
  Object.assign(new BotMessageDelivery(), {
    attemptCount: 1,
    bindingId: 'binding-1',
    createTime: new KtDateTime(NOW),
    expiresAt: new KtDateTime(NOW.getTime() + 60 * 60 * 1000),
    id: 'delivery-1',
    lastErrorCode: null,
    lastErrorMessage: null,
    messageEventId: 'event-1',
    nextAttemptAt: null,
    processingLeaseUntil: LEASE_UNTIL,
    publishTargetId: 'target-1',
    renderedMessage: 'endpoint=demo.example.com:38213',
    selfId: 'bot-1',
    sendLogId: 'old-log',
    status: 'processing',
    subscriptionId: 'subscription-1',
    targetId: 'group-1',
    targetType: 'group',
    templateContent: 'endpoint=${{endpoint}}',
    templateId: 'template-1',
    updateTime: new KtDateTime(NOW),
    variableSnapshot: { endpoint: 'demo.example.com:38213' },
    ...overrides,
  });

const bindingRow = (overrides: Partial<BotMessagePublishBinding> = {}) =>
  Object.assign(new BotMessagePublishBinding(), {
    accountId: 'account-1',
    activeKey: 'account-1:subscription-1',
    enabled: true,
    id: 'binding-1',
    isDeleted: false,
    selfId: 'bot-1',
    subscriptionId: 'subscription-1',
    ...overrides,
  });

const targetRow = (overrides: Partial<BotMessagePublishTarget> = {}) =>
  Object.assign(new BotMessagePublishTarget(), {
    bindingId: 'binding-1',
    enabled: true,
    id: 'target-1',
    isDeleted: false,
    targetId: 'group-1',
    targetType: 'group',
    ...overrides,
  });

const accountRow = (overrides: Partial<BotAccount> = {}) =>
  Object.assign(new BotAccount(), {
    enabled: true,
    id: 'account-1',
    isDeleted: false,
    selfId: 'bot-1',
    ...overrides,
  });

const createFixture = (input?: {
  account?: BotAccount | null;
  binding?: BotMessagePublishBinding | null;
  delivery?: BotMessageDelivery;
  target?: null | BotMessagePublishTarget;
}) => {
  const delivery = input?.delivery ?? deliveryRow();
  const binding = input?.binding === undefined ? bindingRow() : input.binding;
  const target = input?.target === undefined ? targetRow() : input.target;
  const account = input?.account === undefined ? accountRow() : input.account;
  const transitions: Array<{
    values: Record<string, unknown>;
    where: Record<string, unknown>;
  }> = [];
  const deliveryRepository = {
    update: jest.fn(
      async (
        where: Record<string, unknown>,
        values: Record<string, unknown>,
      ) => {
        transitions.push({ values, where });
        return { affected: 1 };
      },
    ),
  };
  const manager = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === BotMessagePublishBinding) {
        return { findOne: jest.fn(async () => binding) };
      }
      if (entity === BotMessagePublishTarget) {
        return { findOne: jest.fn(async () => target) };
      }
      if (entity === BotAccount) {
        return { findOne: jest.fn(async () => account) };
      }
      if (entity === BotMessageDelivery) {
        return { findOne: jest.fn(async () => delivery) };
      }
      throw new Error('unexpected repository');
    }),
  };
  const dataSource = {
    getRepository: jest.fn(() => deliveryRepository),
    transaction: jest.fn(
      async (work: (entityManager: typeof manager) => Promise<unknown>) =>
        work(manager),
    ),
  };
  const sender = {
    sendStrictPlainText: jest.fn(async () => ({ logId: 'send-log-1' })),
  };
  const runner = new SystemMessageDeliveryRunnerService(
    dataSource as never,
    new SystemMessageTemplateRendererService(),
    sender as never,
  );
  const token = {
    attempt: delivery.attemptCount,
    delivery,
    leaseUntil: LEASE_UNTIL,
  };
  return {
    dataSource,
    deliveryRepository,
    runner,
    sender,
    token,
    transitions,
  };
};

describe('SystemMessageDeliveryRunnerService', () => {
  it('bounds exponential retry delay', () => {
    expect(deliveryRetryDelayMs(1)).toBe(SYSTEM_MESSAGE_RETRY_BASE_MS);
    expect(deliveryRetryDelayMs(2)).toBe(SYSTEM_MESSAGE_RETRY_BASE_MS * 2);
    expect(deliveryRetryDelayMs(100)).toBe(SYSTEM_MESSAGE_RETRY_MAX_MS);
  });

  it('sends an immutable unified-template snapshot without consulting a message source', async () => {
    const fixture = createFixture();

    await (fixture.runner as any).processClaim(fixture.token, NOW);

    expect(fixture.sender.sendStrictPlainText).toHaveBeenCalledWith({
      attemptNumber: 1,
      deliveryId: 'delivery-1',
      message: 'endpoint=demo.example.com:38213',
      selfId: 'bot-1',
      targetId: 'group-1',
      targetType: 'group',
    });
    expect(fixture.transitions).toEqual([
      expect.objectContaining({
        values: expect.objectContaining({
          sendLogId: 'send-log-1',
          status: 'success',
        }),
        where: expect.objectContaining({
          attemptCount: 1,
          id: 'delivery-1',
          processingLeaseUntil: LEASE_UNTIL,
          status: 'processing',
        }),
      }),
    ]);
  });

  it('cancels a claimed delivery when the subscriber private configuration disappeared', async () => {
    const fixture = createFixture({ binding: null });

    await (fixture.runner as any).processClaim(fixture.token, NOW);

    expect(fixture.sender.sendStrictPlainText).not.toHaveBeenCalled();
    expect(fixture.transitions[0].values).toEqual(
      expect.objectContaining({
        lastErrorCode: 'delivery_configuration_cancelled',
        status: 'cancelled',
      }),
    );
  });

  it('fails a corrupt frozen message instead of re-adapting its original source', async () => {
    const fixture = createFixture({
      delivery: deliveryRow({ renderedMessage: 'tampered' }),
    });

    await (fixture.runner as any).processClaim(fixture.token, NOW);

    expect(fixture.sender.sendStrictPlainText).not.toHaveBeenCalled();
    expect(fixture.transitions[0].values).toEqual(
      expect.objectContaining({
        lastErrorCode: 'rendered_message_mismatch',
        status: 'failed',
      }),
    );
  });

  it('fails an expired delivery before reading any subscriber configuration', async () => {
    const fixture = createFixture({
      delivery: deliveryRow({ expiresAt: new KtDateTime(NOW) }),
    });

    await (fixture.runner as any).processClaim(fixture.token, NOW);

    expect(fixture.dataSource.transaction).not.toHaveBeenCalled();
    expect(fixture.transitions[0].values).toEqual(
      expect.objectContaining({
        lastErrorCode: 'delivery_expired',
        status: 'failed',
      }),
    );
  });

  it('retries a transient strict-send error while the delivery window remains open', async () => {
    const fixture = createFixture();
    fixture.sender.sendStrictPlainText.mockRejectedValueOnce(
      new BotSendAttemptError({
        code: 'onebot_timeout',
        message: 'timeout',
        retryable: true,
        sendLogId: 'failed-log',
      }),
    );

    await (fixture.runner as any).processClaim(fixture.token, NOW);

    expect(fixture.transitions[0].values).toEqual(
      expect.objectContaining({
        lastErrorCode: 'onebot_timeout',
        nextAttemptAt: new KtDateTime(
          NOW.getTime() + SYSTEM_MESSAGE_RETRY_BASE_MS,
        ),
        sendLogId: 'failed-log',
        status: 'retry',
      }),
    );
  });

  it('does not retry a permanent strict-send rejection', async () => {
    const fixture = createFixture();
    fixture.sender.sendStrictPlainText.mockRejectedValueOnce(
      new BotSendAttemptError({
        code: 'onebot_rejected',
        message: 'rejected',
        retryable: false,
        sendLogId: 'failed-log',
      }),
    );

    await (fixture.runner as any).processClaim(fixture.token, NOW);

    expect(fixture.transitions[0].values).toEqual(
      expect.objectContaining({
        lastErrorCode: 'onebot_rejected',
        sendLogId: 'failed-log',
        status: 'failed',
      }),
    );
  });

  it('processes at most the shared batch limit and stops when no row is due', async () => {
    const fixture = createFixture();
    const claimOne = jest.spyOn(fixture.runner as any, 'claimOne');
    const processClaim = jest
      .spyOn(fixture.runner as any, 'processClaim')
      .mockResolvedValue(undefined);
    for (let index = 0; index < SYSTEM_MESSAGE_BATCH_SIZE; index += 1) {
      claimOne.mockResolvedValueOnce(fixture.token);
    }

    await expect(fixture.runner.runOnce(NOW)).resolves.toBe(
      SYSTEM_MESSAGE_BATCH_SIZE,
    );
    expect(processClaim).toHaveBeenCalledTimes(SYSTEM_MESSAGE_BATCH_SIZE);

    claimOne.mockReset().mockResolvedValueOnce(null);
    processClaim.mockClear();
    await expect(fixture.runner.runOnce(NOW)).resolves.toBe(0);
    expect(processClaim).not.toHaveBeenCalled();
  });

  it('retries an ambiguous owner transition write once with the same lease condition', async () => {
    const fixture = createFixture();
    fixture.deliveryRepository.update
      .mockRejectedValueOnce(new Error('ambiguous write'))
      .mockResolvedValueOnce({ affected: 1 });

    await (fixture.runner as any).persistOwnerTransition(fixture.token, {
      lastErrorCode: null,
      lastErrorMessage: null,
      nextAttemptAt: null,
      processingLeaseUntil: null,
      sendLogId: 'send-log-1',
      status: 'success',
    });

    expect(fixture.deliveryRepository.update).toHaveBeenCalledTimes(2);
    expect(fixture.deliveryRepository.update.mock.calls[0]).toEqual(
      fixture.deliveryRepository.update.mock.calls[1],
    );
  });
});

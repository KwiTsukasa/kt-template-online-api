import { QqbotSendAttemptError } from '../../../../src/modules/qqbot/core/application/send/qqbot-send.error';
import { QqbotSendService } from '../../../../src/modules/qqbot/core/application/send/qqbot-send.service';
import {
  QqbotReverseWsActionError,
  QqbotReverseWsService,
} from '../../../../src/modules/qqbot/core/infrastructure/integration/connection/qqbot-reverse-ws.service';

const account = {
  enabled: true,
  isDeleted: false,
  selfId: '10001',
};

/** Creates bounded fakes for the strict QQBot send contract. */
const createHarness = () => {
  const accountService = {
    findBySelfId: jest.fn().mockResolvedValue(account),
    getDefaultAccount: jest.fn().mockResolvedValue(account),
  };
  const sendLogRepository = {
    create: jest.fn((value) => value),
    save: jest.fn().mockResolvedValue({ id: 'log-1' }),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const busService = { publish: jest.fn().mockResolvedValue(undefined) };
  const messageService = {
    saveOutgoing: jest.fn().mockResolvedValue(undefined),
  };
  const reverseWs = {
    sendAction: jest.fn().mockResolvedValue({
      data: { message_id: 'message-1' },
      echo: 'echo-1',
      retcode: 0,
      status: 'ok',
    }),
  };
  const moduleRef = { get: jest.fn().mockReturnValue(reverseWs) };
  const rateLimitService = {
    waitForSendSlot: jest.fn().mockResolvedValue(undefined),
  };
  const toolsService = {
    getErrorMessage: jest.fn((error, fallback) => error?.message || fallback),
    getPageParams: jest.fn(),
    toStoredMessageText: jest.fn((message) => `stored:${message}`),
  };
  const service = new QqbotSendService(
    sendLogRepository as any,
    accountService as any,
    busService as any,
    messageService as any,
    moduleRef as any,
    rateLimitService as any,
    toolsService as any,
  );
  return {
    accountService,
    busService,
    messageService,
    rateLimitService,
    reverseWs,
    sendLogRepository,
    service,
  };
};

describe('QQBot strict plain-text sender', () => {
  it.each([
    null,
    { ...account, enabled: false },
    { ...account, isDeleted: true },
  ])(
    'never falls back when the configured account is unavailable',
    async (configuredAccount) => {
      const { accountService, service } = createHarness();
      accountService.findBySelfId.mockResolvedValue(configuredAccount);

      await expect(
        service.sendStrictPlainText({
          attemptNumber: 1,
          deliveryId: 'delivery-1',
          message: 'test',
          selfId: 'missing',
          targetId: '20001',
          targetType: 'group',
        }),
      ).rejects.toMatchObject({
        code: 'account_unavailable',
        retryable: true,
        sendLogId: null,
      });
      expect(accountService.getDefaultAccount).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'group',
      'send_group_msg',
      {
        group_id: '20001',
        message: [{ data: { text: '[CQ:at,qq=12345]' }, type: 'text' }],
      },
    ],
    [
      'private',
      'send_private_msg',
      {
        message: [{ data: { text: '[CQ:at,qq=12345]' }, type: 'text' }],
        user_id: '20001',
      },
    ],
  ] as const)(
    'sends strict %s targets as one ordinary text segment with string identifiers',
    async (targetType, action, params) => {
      const {
        busService,
        rateLimitService,
        reverseWs,
        sendLogRepository,
        service,
      } = createHarness();

      await expect(
        service.sendStrictPlainText({
          attemptNumber: 2,
          deliveryId: 'delivery-2',
          message: '[CQ:at,qq=12345]',
          selfId: '10001',
          targetId: '20001',
          targetType,
        }),
      ).resolves.toMatchObject({ logId: 'log-1', status: 'ok' });

      expect(rateLimitService.waitForSendSlot).toHaveBeenCalledWith(
        '10001',
        '20001',
      );
      expect(
        rateLimitService.waitForSendSlot.mock.invocationCallOrder[0],
      ).toBeLessThan(reverseWs.sendAction.mock.invocationCallOrder[0]);
      expect(sendLogRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          action,
          messageText: 'stored:[CQ:at,qq=12345]',
          params: {
            ...params,
            message: [
              { data: { text: 'stored:[CQ:at,qq=12345]' }, type: 'text' },
            ],
            messagePush: { attemptNumber: 2, deliveryId: 'delivery-2' },
          },
        }),
      );
      expect(busService.publish).toHaveBeenCalledWith(
        'qqbot/10001/command/send',
        expect.objectContaining({ action, params }),
      );
      expect(reverseWs.sendAction).toHaveBeenCalledWith(
        '10001',
        action,
        params,
      );
      expect(busService.publish.mock.calls[0][1].params).not.toHaveProperty(
        'messagePush',
      );
      expect(reverseWs.sendAction.mock.calls[0][2]).not.toHaveProperty(
        'messagePush',
      );
      expect(sendLogRepository.update).toHaveBeenCalledWith(
        { id: 'log-1' },
        expect.objectContaining({ status: 'success' }),
      );
    },
  );

  it('persists exactly one outgoing record after a strict success', async () => {
    const { messageService, service } = createHarness();

    await service.sendStrictPlainText({
      attemptNumber: 1,
      deliveryId: 'delivery-1',
      message: 'plain text',
      selfId: '10001',
      targetId: '20001',
      targetType: 'private',
    });

    expect(messageService.saveOutgoing).toHaveBeenCalledTimes(1);
    expect(messageService.saveOutgoing).toHaveBeenCalledWith({
      messageId: 'message-1',
      messageText: 'stored:plain text',
      messageType: 'private',
      selfId: '10001',
      targetId: '20001',
      userId: '20001',
    });
  });

  it('rejects OneBot non-success responses permanently and retains the pending log', async () => {
    const { messageService, reverseWs, sendLogRepository, service } =
      createHarness();
    reverseWs.sendAction.mockResolvedValue({
      message: 'bad target',
      retcode: 1404,
      status: 'failed',
    });

    await expect(
      service.sendStrictPlainText({
        attemptNumber: 1,
        deliveryId: 'delivery-1',
        message: 'plain text',
        selfId: '10001',
        targetId: '20001',
        targetType: 'group',
      }),
    ).rejects.toMatchObject({
      code: 'onebot_rejected',
      retryable: false,
      sendLogId: 'log-1',
    });
    expect(sendLogRepository.update).toHaveBeenCalledWith(
      { id: 'log-1' },
      expect.objectContaining({ errorMessage: 'bad target', status: 'failed' }),
    );
    expect(messageService.saveOutgoing).not.toHaveBeenCalled();
  });

  it.each([
    [
      new QqbotReverseWsActionError('onebot_timeout', 'timeout'),
      'onebot_timeout',
    ],
    [
      new QqbotReverseWsActionError('onebot_disconnected', 'offline'),
      'onebot_disconnected',
    ],
  ])(
    'keeps retryable reverse WS classifications and the log identity',
    async (error, code) => {
      const { reverseWs, sendLogRepository, service } = createHarness();
      reverseWs.sendAction.mockRejectedValue(error);

      await expect(
        service.sendStrictPlainText({
          attemptNumber: 1,
          deliveryId: 'delivery-1',
          message: 'plain text',
          selfId: '10001',
          targetId: '20001',
          targetType: 'group',
        }),
      ).rejects.toMatchObject({ code, retryable: true, sendLogId: 'log-1' });
      expect(sendLogRepository.update).toHaveBeenCalledWith(
        { id: 'log-1' },
        expect.objectContaining({ status: 'failed' }),
      );
    },
  );

  it('retains the original retryable classification when failed-log persistence also fails', async () => {
    const { reverseWs, sendLogRepository, service } = createHarness();
    reverseWs.sendAction.mockRejectedValue(new Error('bus unavailable'));
    sendLogRepository.update.mockRejectedValue(
      new Error('log write unavailable'),
    );

    await expect(
      service.sendStrictPlainText({
        attemptNumber: 1,
        deliveryId: 'delivery-1',
        message: 'plain text',
        selfId: '10001',
        targetId: '20001',
        targetType: 'group',
      }),
    ).rejects.toMatchObject({
      code: 'onebot_disconnected',
      retryable: true,
      sendLogId: 'log-1',
    });
  });

  it('rejects an invalid strict target before rate limiting, logs, or transport', async () => {
    const {
      busService,
      rateLimitService,
      reverseWs,
      sendLogRepository,
      service,
    } = createHarness();

    await expect(
      service.sendStrictPlainText({
        attemptNumber: 1,
        deliveryId: 'delivery-1',
        message: 'plain text',
        selfId: '10001',
        targetId: '20001',
        targetType: 'channel' as never,
      }),
    ).rejects.toMatchObject({
      code: 'invalid_target_type',
      retryable: false,
      sendLogId: null,
    });
    expect(rateLimitService.waitForSendSlot).not.toHaveBeenCalled();
    expect(sendLogRepository.save).not.toHaveBeenCalled();
    expect(busService.publish).not.toHaveBeenCalled();
    expect(reverseWs.sendAction).not.toHaveBeenCalled();
  });

  it('keeps manual sendText default resolution and legacy CQ string payloads', async () => {
    const {
      accountService,
      busService,
      messageService,
      rateLimitService,
      reverseWs,
      sendLogRepository,
      service,
    } = createHarness();

    await service.sendText({
      message: '[CQ:at,qq=12345]',
      selfId: 'missing',
      targetId: '20001',
      targetType: 'group',
    });

    expect(accountService.getDefaultAccount).toHaveBeenCalledWith('missing');
    expect(
      rateLimitService.waitForSendSlot.mock.invocationCallOrder[0],
    ).toBeLessThan(reverseWs.sendAction.mock.invocationCallOrder[0]);
    expect(reverseWs.sendAction).toHaveBeenCalledWith(
      '10001',
      'send_group_msg',
      {
        group_id: '20001',
        message: '[CQ:at,qq=12345]',
      },
    );
    expect(busService.publish).toHaveBeenCalledTimes(1);
    expect(sendLogRepository.save).toHaveBeenCalledTimes(1);
    expect(messageService.saveOutgoing).toHaveBeenCalledTimes(1);
  });
});

describe('QQBot reverse WS action classification', () => {
  it('keeps the typed strict send error fields explicit', () => {
    const error = new QqbotSendAttemptError({
      code: 'onebot_timeout',
      message: 'timeout',
      retryable: true,
      sendLogId: 'log-1',
    });

    expect(error).toMatchObject({
      code: 'onebot_timeout',
      name: 'QqbotSendAttemptError',
      retryable: true,
      sendLogId: 'log-1',
    });
  });

  /** Creates a reverse WS service with no real server or network dependency. */
  const createReverseWsHarness = () => {
    const accountService = {
      markOffline: jest.fn().mockResolvedValue(undefined),
    };
    const busService = { publish: jest.fn().mockResolvedValue(undefined) };
    const service = new QqbotReverseWsService(
      {
        get: jest.fn((key) => (key === 'QQBOT_API_TIMEOUT_MS' ? '10' : '')),
      } as any,
      {} as any,
      {} as any,
      accountService as any,
      busService as any,
      { getErrorMessage: jest.fn() } as any,
    );
    return { accountService, busService, service };
  };

  it('signals a disconnected reverse WS without creating a pending action', async () => {
    const { service } = createReverseWsHarness();

    await expect(
      service.sendAction('10001', 'send_group_msg', {}),
    ).rejects.toMatchObject({
      code: 'onebot_disconnected',
      name: 'QqbotReverseWsActionError',
    });
    expect((service as any).pendingActions.size).toBe(0);
  });

  it('signals timeout, clears pending state, closes the connection, and keeps successful responses intact', async () => {
    jest.useFakeTimers();
    try {
      const { accountService, busService, service } = createReverseWsHarness();
      const ws = { close: jest.fn(), readyState: 1, send: jest.fn() };
      (service as any).connections.set('10001:Universal', ws);

      const timeout = service.sendAction('10001', 'send_group_msg', {});
      expect((service as any).pendingActions.size).toBe(1);
      jest.advanceTimersByTime(10);

      await expect(timeout).rejects.toMatchObject({ code: 'onebot_timeout' });
      expect((service as any).pendingActions.size).toBe(0);
      expect(ws.close).toHaveBeenCalledWith(1011, 'OneBot action timeout');
      expect(accountService.markOffline).toHaveBeenCalledWith(
        '10001',
        'OneBot action timeout',
      );
      expect(busService.publish).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: 'offline' }),
      );

      const successWs = { close: jest.fn(), readyState: 1, send: jest.fn() };
      (service as any).connections.set('10001:Universal', successWs);
      const success = service.sendAction('10001', 'send_group_msg', {});
      const { echo } = JSON.parse(successWs.send.mock.calls[0][0]);
      await (service as any).resolvePendingAction('10001', {
        data: { message_id: 'message-1' },
        echo,
        retcode: 0,
        status: 'ok',
      });
      await expect(success).resolves.toMatchObject({
        data: { message_id: 'message-1' },
        status: 'ok',
      });
      expect((service as any).pendingActions.size).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});

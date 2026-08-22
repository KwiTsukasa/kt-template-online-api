import { BotSendAttemptError } from '../../../../src/modules/bot-adapter/core/application/send/bot-send.error';
import { BotSendService } from '../../../../src/modules/bot-adapter/core/application/send/bot-send.service';
import {
  BotReverseWsActionError,
  BotReverseWsService,
} from '../../../../src/modules/bot-adapter/core/infrastructure/integration/connection/bot-reverse-ws.service';

const account = {
  connectionMode: 'reverse-ws',
  enabled: true,
  isDeleted: false,
  selfId: '10001',
};

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
  const adapter = {
    deliver: jest.fn().mockResolvedValue({
      deliveredAt: '2026-08-22T00:00:00.000Z',
      deliveryKey: 'message-1',
    }),
  };
  const adapterRegistry = {
    require: jest.fn().mockReturnValue(adapter),
  };
  const rateLimitService = {
    waitForSendSlot: jest.fn().mockResolvedValue(undefined),
  };
  const toolsService = {
    getErrorMessage: jest.fn((error, fallback) => error?.message || fallback),
    getPageParams: jest.fn(),
    toStoredMessageText: jest.fn((message) => `stored:${message}`),
  };
  const service = new BotSendService(
    sendLogRepository as any,
    accountService as any,
    adapterRegistry as any,
    busService as any,
    messageService as any,
    rateLimitService as any,
    toolsService as any,
  );
  return {
    accountService,
    adapter,
    adapterRegistry,
    busService,
    messageService,
    rateLimitService,
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
        adapter,
        adapterRegistry,
        busService,
        rateLimitService,
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
      ).toBeLessThan(adapter.deliver.mock.invocationCallOrder[0]);
      expect(adapterRegistry.require).toHaveBeenCalledWith('napcat');
      expect(sendLogRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          action: `napcat_send_${targetType}`,
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
        'bot/10001/command/send',
        expect.objectContaining({
          action: `napcat_send_${targetType}`,
          params,
        }),
      );
      expect(adapter.deliver).toHaveBeenCalledWith(
        expect.objectContaining({
          adapterContext: expect.objectContaining({
            action,
            actionParams: params,
          }),
          connectionKey: '10001',
          intent: { content: '[CQ:at,qq=12345]', kind: 'text' },
          targetKey: '20001',
        }),
      );
      expect(busService.publish.mock.calls[0][1].params).not.toHaveProperty(
        'messagePush',
      );
      expect(
        adapter.deliver.mock.calls[0][0].adapterContext.actionParams,
      ).not.toHaveProperty('messagePush');
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

  it('keeps permanent adapter rejection classification and the pending log identity', async () => {
    const { adapter, messageService, sendLogRepository, service } =
      createHarness();
    adapter.deliver.mockRejectedValue(
      new BotReverseWsActionError('onebot_rejected', 'bad target'),
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
      code: 'onebot_rejected',
      retryable: false,
      sendLogId: 'log-1',
    });
    expect(sendLogRepository.update).toHaveBeenCalledWith(
      { id: 'log-1' },
      expect.objectContaining({
        errorMessage: 'OneBot rejected the send action',
        status: 'failed',
      }),
    );
    expect(messageService.saveOutgoing).not.toHaveBeenCalled();
  });

  it.each([
    [
      new BotReverseWsActionError('onebot_timeout', 'timeout'),
      'onebot_timeout',
    ],
    [
      new BotReverseWsActionError('onebot_disconnected', 'offline'),
      'onebot_disconnected',
    ],
  ])(
    'keeps retryable reverse WS classifications and the log identity',
    async (error, code) => {
      const { adapter, sendLogRepository, service } = createHarness();
      adapter.deliver.mockRejectedValue(error);

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
    const { adapter, sendLogRepository, service } = createHarness();
    adapter.deliver.mockRejectedValue(new Error('adapter unavailable'));
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

  it('redacts raw infrastructure details from both the typed error and failed send log', async () => {
    const { busService, sendLogRepository, service } = createHarness();
    busService.publish.mockRejectedValue(
      new Error(
        'password=broker-secret SELECT * FROM bot_private mqtt://admin@broker',
      ),
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
      message: 'OneBot connection unavailable',
      retryable: true,
      sendLogId: 'log-1',
    });
    expect(sendLogRepository.update).toHaveBeenCalledWith(
      { id: 'log-1' },
      {
        errorMessage: 'OneBot connection unavailable',
        status: 'failed',
      },
    );
    expect(JSON.stringify(sendLogRepository.update.mock.calls)).not.toContain(
      'broker-secret',
    );
  });

  it('rejects an invalid strict target before rate limiting, logs, or transport', async () => {
    const {
      adapter,
      busService,
      rateLimitService,
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
    expect(adapter.deliver).not.toHaveBeenCalled();
  });

  it('keeps manual sendText default resolution and legacy CQ string payloads', async () => {
    const {
      accountService,
      adapter,
      busService,
      messageService,
      rateLimitService,
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
    ).toBeLessThan(adapter.deliver.mock.invocationCallOrder[0]);
    expect(adapter.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        adapterContext: expect.objectContaining({
          action: 'send_group_msg',
          actionParams: {
            group_id: '20001',
            message: '[CQ:at,qq=12345]',
          },
        }),
        connectionKey: '10001',
      }),
    );
    expect(busService.publish).toHaveBeenCalledTimes(1);
    expect(sendLogRepository.save).toHaveBeenCalledTimes(1);
    expect(messageService.saveOutgoing).toHaveBeenCalledTimes(1);
    expect(sendLogRepository.update).toHaveBeenCalledWith(
      { id: 'log-1' },
      expect.objectContaining({ status: 'success' }),
    );
  });
});

describe('Bot reverse WS action classification', () => {
  it.each([
    ['account_unavailable', 'Configured Bot account is unavailable'],
    ['invalid_target_type', 'Strict Bot delivery target type is invalid'],
    ['onebot_rejected', 'OneBot rejected the send action'],
    ['onebot_timeout', 'OneBot send timed out'],
    ['onebot_disconnected', 'OneBot connection unavailable'],
    ['future_unknown_code', 'Bot delivery failed'],
  ])('maps strict-send code %s to a stable safe summary', (code, message) => {
    const error = new BotSendAttemptError({
      code,
      message: 'password=must-not-survive',
      retryable: true,
      sendLogId: null,
    });

    expect(error.message).toBe(message);
    expect(error.message).not.toContain('must-not-survive');
  });

  it('keeps the typed strict send error fields explicit', () => {
    const error = new BotSendAttemptError({
      code: 'onebot_timeout',
      message: 'timeout',
      retryable: true,
      sendLogId: 'log-1',
    });

    expect(error).toMatchObject({
      code: 'onebot_timeout',
      name: 'BotSendAttemptError',
      retryable: true,
      sendLogId: 'log-1',
    });
  });

  const createReverseWsHarness = () => {
    const accountService = {
      markOffline: jest.fn().mockResolvedValue(undefined),
    };
    const busService = { publish: jest.fn().mockResolvedValue(undefined) };
    const service = new BotReverseWsService(
      {
        get: jest.fn((key) => (key === 'BOT_API_TIMEOUT_MS' ? '10' : '')),
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
      name: 'BotReverseWsActionError',
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

  it('retires an OPEN socket whose send throws without leaving a timeout behind', async () => {
    jest.useFakeTimers();
    try {
      const { accountService, busService, service } = createReverseWsHarness();
      const ws = {
        close: jest.fn(),
        readyState: 1,
        send: jest.fn(() => {
          throw new Error('send failed');
        }),
      };
      (service as any).connections.set('10001:Universal', ws);

      await expect(
        service.sendAction('10001', 'send_group_msg', {}),
      ).rejects.toMatchObject({ code: 'onebot_disconnected' });
      expect((service as any).pendingActions.size).toBe(0);
      expect((service as any).connections.has('10001:Universal')).toBe(false);
      expect(ws.close).toHaveBeenCalledWith(
        1011,
        'OneBot connection send failed',
      );
      expect(accountService.markOffline).toHaveBeenCalledWith(
        '10001',
        'OneBot connection send failed',
      );
      expect(busService.publish).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ selfId: '10001', status: 'offline' }),
      );

      jest.advanceTimersByTime(10);
      expect(ws.close).toHaveBeenCalledTimes(1);
      expect(accountService.markOffline).toHaveBeenCalledTimes(1);
      expect(busService.publish).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

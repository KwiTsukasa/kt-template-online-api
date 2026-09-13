import { ConfigService } from '@nestjs/config';
import { BotConversationTaskService } from '@/modules/bot-adapter/core/application/message/bot-conversation-task.service';
import { BotSendAttemptError } from '@/modules/bot-adapter/core/application/send/bot-send.error';
import { toBotPluginMessageEvent } from '@/modules/bot-adapter/core/application/event/plugin-event.mapper';

describe('Durable conversation and delivery state', () => {
  const message = {
    selfId: 'qq-official:test',
    userId: 'first-member',
    messageId: 'm1',
    messageType: 'group',
    targetId: 'group',
    connectionMode: 'official-websocket',
    messageText: '研究报告',
    rawMessage: '研究报告',
    rawEvent: { official_event_type: 'GROUP_AT_MESSAGE_CREATE' },
    replyMessageId: 'old-reply',
    adapterReplyContext: { messageId: 'old' },
    eventTime: new Date(Date.now() - 600000),
  } as any;
  let store: any;
  let tools: any;
  let send: any;
  let plugins: any;
  let artifacts: any;
  let permissions: any;
  const create = () =>
    new BotConversationTaskService(
      new ConfigService({}),
      store,
      tools,
      permissions,
      {} as never,
      {
        require: () => ({ listBoundPluginKeys: async () => ['hermes-agent'] }),
      } as never,
      artifacts,
      send,
      plugins,
    );
  const job = () => {
    const data = {
      message,
      event: toBotPluginMessageEvent(message),
      pluginKey: 'hermes-agent',
      contextId: 'context',
      expiresAt: Date.now() + 3600000,
      conversation: 'order',
      state: 'running',
      cursor: 0,
      attempt: 0,
    };
    const record: any = {
      id: 'a'.repeat(64),
      data: JSON.parse(JSON.stringify(data)),
      updateData: jest.fn(async (value) => {
        record.data = JSON.parse(JSON.stringify(value));
      }),
      moveToDelayed: jest.fn(),
    };
    return record;
  };
  beforeEach(() => {
    const values = new Map();
    store = {
      read: jest.fn(async (key) => values.get(key)),
      write: jest.fn(async (key, value) =>
        values.set(key, JSON.parse(JSON.stringify(value))),
      ),
      progress: jest.fn(),
      redis: {
        zrange: jest.fn().mockResolvedValue([]),
        zrem: jest.fn(),
        exists: jest.fn().mockResolvedValue(1),
        sadd: jest.fn(),
        srem: jest.fn(),
      },
    };
    tools = { closeDurable: jest.fn() };
    permissions = {
      isAllowed: jest.fn().mockResolvedValue(true),
      isBlocked: jest.fn().mockResolvedValue(false),
    };
    send = {
      sendText: jest.fn().mockResolvedValue({ logId: 'sent' }),
      readDelivery: jest.fn(),
    };
    plugins = {
      dispatchEvent: jest.fn().mockResolvedValue({
        handled: true,
        replies: [{ kind: 'text', content: '完整报告' }],
      }),
    };
    artifacts = {
      saveResult: jest.fn().mockResolvedValue('b'.repeat(64)),
      readResult: jest.fn().mockResolvedValue({
        handled: true,
        replies: [{ kind: 'text', content: '完整报告' }],
      }),
    };
  });
  it('persists run continuation and a recreated worker polls the original task', async () => {
    const record = job();
    plugins.dispatchEvent.mockResolvedValueOnce({
      handled: true,
      replies: [],
      continuation: { state: { runId: 'existing' }, delayMs: 2000 },
    });
    await expect(create().process(record, 'lock')).rejects.toThrow(
      'bullmq:movedToDelayed',
    );
    expect(record.data.event.metadata.continuation).toEqual({
      runId: 'existing',
    });
    expect(send.sendText).not.toHaveBeenCalled();
    await create().process(record, 'new-lock');
    expect(
      plugins.dispatchEvent.mock.calls[1][0].event.metadata.continuation,
    ).toEqual({ runId: 'existing' });
    expect(record.data.state).toBe('delivered');
    expect(send.sendText.mock.calls[0][0].replyMessageId).toBeUndefined();
    expect(send.sendText.mock.calls[0][0].adapterReplyContext).toBeUndefined();
    expect(artifacts.saveResult).toHaveBeenCalledTimes(1);
  });
  it('retains a completed answer on definitive rejection and resends it without calling the model', async () => {
    const record = job();
    send.sendText.mockRejectedValueOnce(
      new BotSendAttemptError({
        code: 'official_rejected',
        retryable: false,
        sendLogId: 'no',
        message: 'rejected',
      }),
    );
    await create().process(record);
    expect(record.data.state).toBe('pending');
    expect(record.data.resultHash).toBe('b'.repeat(64));
    record.data.state = 'ready';
    record.data.deliveryMessage = {
      ...message,
      eventTime: new Date(),
      replyMessageId: 'new-reply',
    };
    await create().process(record);
    expect(record.data.state).toBe('delivered');
    expect(plugins.dispatchEvent).toHaveBeenCalledTimes(1);
    expect(send.sendText.mock.calls[1][0].replyMessageId).toBe('new-reply');
  });
  it('does not automatically repeat uncertain sends and reconciles a successful send after restart', async () => {
    const record = job();
    send.sendText.mockRejectedValueOnce(
      new BotSendAttemptError({
        code: 'official_timeout',
        retryable: true,
        sendLogId: 'unknown',
        message: 'timeout',
      }),
    );
    await create().process(record);
    expect(record.data.state).toBe('uncertain');
    await create().process(record);
    expect(send.sendText).toHaveBeenCalledTimes(1);
    record.data.state = 'sending';
    send.readDelivery.mockResolvedValue({ status: 'success' });
    await create().process(record);
    expect(record.data.state).toBe('delivered');
    expect(record.data.cursor).toBe(1);
    expect(send.sendText).toHaveBeenCalledTimes(1);
  });
  it('defers another group member until the active shared conversation has finished', async () => {
    const record = job();
    store.redis.zrange.mockResolvedValue(['earlier-message']);
    await expect(create().process(record, 'lock')).rejects.toThrow(
      'bullmq:movedToDelayed',
    );
    expect(plugins.dispatchEvent).not.toHaveBeenCalled();
  });
  it('revoked sender permissions prevent both inference and delivery', async () => {
    const record = job();
    permissions.isAllowed.mockResolvedValue(false);
    await create().process(record);
    expect(record.data.state).toBe('failed');
    expect(plugins.dispatchEvent).not.toHaveBeenCalled();
    expect(send.sendText).not.toHaveBeenCalled();
  });
  it('expires an unstarted task without dispatch and releases the group queue', async () => {
    const record = job();
    record.data.expiresAt = Date.now() - 1;
    await create().process(record);
    expect(record.data.error).toBe('authorization_expired_before_start');
    expect(plugins.dispatchEvent).not.toHaveBeenCalled();
    expect(store.redis.zrem).toHaveBeenCalledWith('order', record.id);
  });
  it('persists terminal infrastructure failure and never retries uncertain deliveries', async () => {
    const record = job();
    await create().recordFailure(record, new Error('connection lost'));
    expect(record.data.state).toBe('failed');
    expect(tools.closeDurable).toHaveBeenCalledWith('context');
    await create().process(record);
    expect(plugins.dispatchEvent).not.toHaveBeenCalled();
    record.data.state = 'sending';
    await create().recordFailure(record, new Error('connection lost'));
    expect(record.data.state).toBe('uncertain');
    expect(send.sendText).not.toHaveBeenCalled();
  });

  it('keeps shared history across members and restarts without resubmitting observed rows', async () => {
    const first = job();
    first.data.event.metadata.recentMessages = [
      { messageId: 'older', text: '前一个人的话' },
    ];
    await create().process(first);
    const second = job();
    second.id = 'c'.repeat(64);
    second.data.event.eventId = 'm2';
    second.data.message.userId = 'second-member';
    second.data.event.metadata.recentMessages = [
      { messageId: 'older', text: '前一个人的话' },
      { messageId: 'm1', text: '研究报告' },
      { messageId: 'unmentioned', text: '另一位成员的补充' },
    ];
    plugins.dispatchEvent.mockRejectedValueOnce(
      new Error('before acknowledgement'),
    );
    await expect(create().process(second)).rejects.toThrow(
      'before acknowledgement',
    );
    const fixed = plugins.dispatchEvent.mock.calls[1][0].event;
    await create().process(second);
    expect(plugins.dispatchEvent.mock.calls[2][0].event).toEqual(fixed);
    expect(fixed.metadata.recentMessages).toEqual([
      { messageId: 'unmentioned', text: '另一位成员的补充' },
    ]);
  });

  it('does not describe a delivered failure notice as successful execution', async () => {
    const record = job();
    plugins.dispatchEvent.mockResolvedValue({
      handled: true,
      failureCode: 'run_invalid_output',
      replies: [{ kind: 'text', content: '没有生成结果' }],
    });
    await create().process(record);
    expect(record.data).toMatchObject({
      state: 'delivered',
      executionOutcome: 'failed',
      executionError: 'run_invalid_output',
    });
  });
  it('removes a crashed enqueue index after its reservation expires', async () => {
    const record = job();
    store.redis.zrange.mockResolvedValue(['orphan']);
    store.redis.exists.mockResolvedValue(0);
    await expect(create().process(record, 'lock')).rejects.toThrow(
      'bullmq:movedToDelayed',
    );
    expect(store.redis.zrem).toHaveBeenCalledWith('order', 'orphan');
    expect(plugins.dispatchEvent).not.toHaveBeenCalled();
  });
});

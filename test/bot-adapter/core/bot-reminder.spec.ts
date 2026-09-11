const mockQueue = {
  on: jest.fn(),
  getJobSchedulers: jest.fn(),
  getJobs: jest.fn(),
  add: jest.fn(),
  upsertJobScheduler: jest.fn(),
  removeJobScheduler: jest.fn(),
  close: jest.fn(),
};
jest.mock('bullmq', () => ({
  Queue: jest.fn(() => mockQueue),
  Worker: jest.fn(),
}));
import { BotReminderService } from '@/modules/bot-adapter/core/application/message/bot-reminder.service';
import { Queue } from 'bullmq';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BotToolController } from '@/modules/bot-adapter/core/contract/command/bot-tool.controller';
import { BotToolSessionService } from '@/modules/bot-adapter/core/application/command/bot-tool-session.service';

const message = {
  selfId: 'qq-official:1',
  connectionMode: 'official-websocket',
  messageType: 'group',
  targetId: 'group-a',
  userId: 'alice',
  messageId: 'inbound',
  messageText: '',
  rawMessage: '',
  rawEvent: { original: 'payload' },
  replyMessageId: 'expiring-reply',
  eventTime: new Date(),
} as const;
describe('Persistent reminders', () => {
  const permissions = { isBlocked: jest.fn(), isAllowed: jest.fn() };
  const account = { getBoundEventPluginKeys: jest.fn() };
  const send = { sendText: jest.fn() };
  const adapter = { listBoundPluginKeys: jest.fn() };
  const history = { requireMember: jest.fn() };
  const service = new BotReminderService(
    {
      get: (key: string) => {
        if (key === 'PLUGIN_QUEUE_REDIS_HOST') return '127.0.0.1';
        return undefined;
      },
    } as never,
    permissions as never,
    account as never,
    send as never,
    { require: () => adapter } as never,
    history as never,
  );
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueue.getJobs.mockResolvedValue([]);
    mockQueue.getJobSchedulers.mockResolvedValue([]);
    permissions.isBlocked.mockResolvedValue(false);
    permissions.isAllowed.mockResolvedValue(true);
    adapter.listBoundPluginKeys.mockResolvedValue(['hermes-agent']);
    history.requireMember.mockImplementation(async (_message, id) => id);
  });
  it('uses the deployed queue connection keys and leaves API startup available when reminders are not configured', async () => {
    new BotReminderService(
      {
        get: (key: string) =>
          ({
            PLUGIN_QUEUE_REDIS_HOST: 'kt-plugin-redis',
            PLUGIN_QUEUE_REDIS_PORT: '6380',
          })[key],
      } as never,
      permissions as never,
      account as never,
      send as never,
      { require: () => adapter } as never,
      history as never,
    );
    expect(Queue).toHaveBeenCalledWith(
      'bot-reminders',
      expect.objectContaining({
        connection: expect.objectContaining({
          host: 'kt-plugin-redis',
          port: 6380,
        }),
        prefix: 'kt:bot:reminders',
      }),
    );
    const disabled = new BotReminderService(
      { get: () => undefined } as never,
      permissions as never,
      account as never,
      send as never,
      { require: () => adapter } as never,
      history as never,
    );
    await expect(disabled.onApplicationBootstrap()).resolves.toBeUndefined();
    await expect(
      disabled.manage(message, { operation: 'list' }, 'hermes-agent'),
    ).rejects.toThrow('尚未配置');
  });
  it('persists a daily reminder with Shanghai timezone and omits stale reply credentials', async () => {
    await expect(
      service.manage(
        message,
        { operation: 'create', dailyAt: '18:00', text: '提醒吃饭' },
        'hermes-agent',
      ),
    ).resolves.toMatchObject({
      status: 'scheduled',
      timezone: 'Asia/Shanghai',
    });
    const [id, repeat, template] = mockQueue.upsertJobScheduler.mock.calls[0];
    expect(id).toMatch(/^[a-f0-9]{64}-/);
    expect(repeat).toEqual({ pattern: '0 18 * * *', tz: 'Asia/Shanghai' });
    expect(template.data.message).not.toHaveProperty('replyMessageId');
    expect(template.data.message.rawEvent).toEqual({});
    expect(template.data.sourcePluginKey).toBe('hermes-agent');
  });
  it('does not claim scheduling when Redis rejects the write and rejects another owner cancellation', async () => {
    mockQueue.add.mockRejectedValueOnce(new Error('Redis unavailable'));
    await expect(
      service.manage(
        message,
        {
          operation: 'create',
          runAt: new Date(Date.now() + 60000).toISOString(),
          text: '提醒',
        },
        'hermes-agent',
      ),
    ).rejects.toThrow('Redis');
    await expect(
      service.manage(
        message,
        { operation: 'delete', id: 'other-owner-id' },
        'hermes-agent',
      ),
    ).rejects.toThrow('不属于');
    expect(mockQueue.removeJobScheduler).not.toHaveBeenCalled();
  });
  it('reloads Tencent authorization at delivery and preserves platform rejection as failure', async () => {
    const job = {
      data: { message, sourcePluginKey: 'hermes-agent', text: '到时间了' },
    } as never;
    adapter.listBoundPluginKeys.mockResolvedValueOnce([]);
    await expect(service.deliver(job)).rejects.toThrow('绑定已撤销');
    expect(send.sendText).not.toHaveBeenCalled();
    send.sendText.mockRejectedValueOnce(
      new Error('platform rejected proactive message'),
    );
    await expect(service.deliver(job)).rejects.toThrow('platform rejected');
    expect(send.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: 'group-a', selfId: 'qq-official:1' }),
    );
    expect(account.getBoundEventPluginKeys).not.toHaveBeenCalled();
  });

  it.each(['daily', 'once'])(
    'retains a validated member through %s scheduling and JSON reload',
    async (kind) => {
      const time =
        kind === 'daily'
          ? { dailyAt: '17:30' }
          : { runAt: new Date(Date.now() + 60000).toISOString() };
      const result = await service.manage(
        message,
        {
          operation: 'create',
          text: '该浇水啦！',
          platformId: 'other-member',
          ...time,
          selfId: 'forged-bot',
          targetId: 'forged-group',
          userId: 'forged-owner',
        },
        'hermes-agent',
      );
      expect(result).toMatchObject({
        status: 'scheduled',
        platformId: 'other-member',
      });
      expect(history.requireMember).toHaveBeenCalledWith(
        message,
        'other-member',
      );
      const data =
        kind === 'daily'
          ? mockQueue.upsertJobScheduler.mock.calls[0][2].data
          : mockQueue.add.mock.calls[0][1];
      const restored = JSON.parse(JSON.stringify(data));
      expect(restored.message).toMatchObject({
        selfId: message.selfId,
        targetId: message.targetId,
        userId: message.userId,
      });
      expect(restored.message).not.toHaveProperty('replyMessageId');
      await service.deliver({ data: restored } as never);
      expect(send.sendText).toHaveBeenCalledWith({
        selfId: message.selfId,
        targetType: 'group',
        targetId: message.targetId,
        channelId: undefined,
        guildId: undefined,
        message: '<qqbot-at-user id="other-member" /> 该浇水啦！',
      });
      expect(history.requireMember).toHaveBeenCalledTimes(1);
    },
  );

  it('lists the persisted target on both scheduler templates and jobs', async () => {
    await service.manage(
      message,
      {
        operation: 'create',
        text: '提醒',
        dailyAt: '17:30',
        platformId: 'member',
      },
      'hermes-agent',
    );
    const [key, repeat, template] = mockQueue.upsertJobScheduler.mock.calls[0];
    mockQueue.getJobSchedulers.mockResolvedValue([
      { key, next: Date.now() + 60000, ...repeat, template },
    ]);
    mockQueue.getJobs.mockResolvedValue([
      {
        id: 'repeat-job',
        data: template.data,
        getState: async () => 'delayed',
      },
    ]);
    const result = await service.manage(
      message,
      { operation: 'list' },
      'hermes-agent',
    );
    expect(result).toMatchObject({
      daily: [{ id: key, text: '提醒', platformId: 'member' }],
      jobs: [{ platformId: 'member' }],
    });
  });

  it('rejects unconfirmed targets, private mentions and injected tags without enqueueing', async () => {
    history.requireMember.mockRejectedValueOnce(new Error('未在当前会话出现'));
    await expect(
      service.manage(
        message,
        {
          operation: 'create',
          text: '提醒',
          dailyAt: '17:30',
          platformId: 'stranger',
        },
        'hermes-agent',
      ),
    ).rejects.toThrow('未在当前会话');
    await expect(
      service.manage(
        { ...message, messageType: 'private' },
        {
          operation: 'create',
          text: '提醒',
          dailyAt: '17:30',
          platformId: 'member',
        },
        'hermes-agent',
      ),
    ).rejects.toThrow('私聊');
    await expect(
      service.manage(
        message,
        {
          operation: 'create',
          text: '提醒',
          dailyAt: '17:30',
          platformId: 123,
        },
        'hermes-agent',
      ),
    ).rejects.toThrow('平台ID');
    for (const text of [
      '<qqbot-at-user id="other" />',
      '<QQBOT-at-everyone />',
      '<@other>',
      '[CQ:at,qq=other]',
    ]) {
      await expect(
        service.manage(
          message,
          { operation: 'create', text, dailyAt: '17:30' },
          'hermes-agent',
        ),
      ).rejects.toThrow('正文');
    }
    expect(mockQueue.add).not.toHaveBeenCalled();
    expect(mockQueue.upsertJobScheduler).not.toHaveBeenCalled();
  });

  it('renders the appropriate OneBot and channel mentions and rejects malformed persisted targets', async () => {
    account.getBoundEventPluginKeys.mockResolvedValue(['hermes-agent']);
    const data = {
      message: { ...message, connectionMode: 'reverse-ws' },
      sourcePluginKey: 'hermes-agent',
      text: '提醒',
      platformId: '12345',
    };
    await service.deliver({ data } as never);
    expect(send.sendText).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: '[CQ:at,qq=12345] 提醒' }),
    );
    await service.deliver({
      data: { ...data, message: { ...message, messageType: 'channel' } },
    } as never);
    expect(send.sendText).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: '<@12345> 提醒' }),
    );
    await expect(
      service.deliver({ data: { ...data, platformId: 'bad" />' } } as never),
    ).rejects.toThrow('平台ID');
    expect(send.sendText).toHaveBeenCalledTimes(2);
  });

  it('passes a real HTTP tool call through member validation, persistence and delayed delivery', async () => {
    const sessions = new BotToolSessionService(
      permissions as never,
      {} as never,
      history as never,
      service,
      send as never,
    );
    const module = await Test.createTestingModule({
      controllers: [BotToolController],
      providers: [
        { provide: ConfigService, useValue: { get: () => 'test-key' } },
        { provide: BotToolSessionService, useValue: sessions },
      ],
    }).compile();
    const app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    try {
      const contextId = sessions.open(message, {
        pluginKeys: ['hermes-agent'],
      });
      const body = {
        contextId,
        action: 'reminder',
        operation: 'create',
        runAt: new Date(Date.now() + 60000).toISOString(),
        text: '提醒',
        platformId: 'member',
      };
      const response = await fetch(`${await app.getUrl()}/bot/tools/call`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        result: { status: 'scheduled', platformId: 'member' },
      });
      sessions.close(contextId);
      await service.deliver({
        data: JSON.parse(JSON.stringify(mockQueue.add.mock.calls[0][1])),
      } as never);
      expect(send.sendText).toHaveBeenCalledWith(
        expect.objectContaining({
          message: '<qqbot-at-user id="member" /> 提醒',
        }),
      );
    } finally {
      await app.close();
    }
  });
});

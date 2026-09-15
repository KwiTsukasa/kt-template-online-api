import { BotReminderService } from '@/modules/bot-adapter/core/application/message/bot-reminder.service';
import type { BotReminder } from '@/modules/bot-adapter/core/infrastructure/persistence/message/bot-reminder.entity';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';
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

describe('独立 Bot 提醒意图与发送', () => {
  const rows = new Map<string, BotReminder>();
  const store = {
    create: jest.fn(async (id, data) => {
      const row = {
        id,
        owner: data.owner,
        data,
        status: 'pending',
        scheduleId: null,
        syncPending: true,
        lastError: null,
      } as BotReminder;
      rows.set(id, structuredClone(row));
      return row;
    }),
    list: jest.fn(async (owner) =>
      [...rows.values()].filter((row) => row.owner === owner),
    ),
    pending: jest.fn(async () =>
      [...rows.values()].filter((row) => row.syncPending).map((row) => row.id),
    ),
    withReminder: jest.fn(async (id, operation) => {
      if (!rows.has(id)) throw new Error('提醒不存在');
      return operation(structuredClone(rows.get(id)), {
        save: async (row) => {
          rows.set(id, structuredClone(row));
          return row;
        },
      });
    }),
  };
  const permissions = { isBlocked: jest.fn(), isAllowed: jest.fn() };
  const account = { getBoundEventPluginKeys: jest.fn() };
  const send = { sendText: jest.fn() };
  const adapter = { listBoundPluginKeys: jest.fn() };
  const history = { requireMember: jest.fn() };
  const scheduler = { ensure: jest.fn(), read: jest.fn(), close: jest.fn() };
  const service = new BotReminderService(
    store as never,
    permissions as never,
    account as never,
    send as never,
    { require: () => adapter } as never,
    history as never,
  );
  const release = service.attach(scheduler);
  beforeEach(() => {
    jest.clearAllMocks();
    rows.clear();
    permissions.isBlocked.mockResolvedValue(false);
    permissions.isAllowed.mockResolvedValue(true);
    adapter.listBoundPluginKeys.mockResolvedValue(['hermes-agent']);
    account.getBoundEventPluginKeys.mockResolvedValue(['hermes-agent']);
    history.requireMember.mockImplementation(async (_message, id) => id);
    scheduler.ensure.mockResolvedValue({
      scheduleId: '100',
      enabled: true,
      nextRunAt: new Date(Date.now() + 60000).toISOString(),
    });
    scheduler.read.mockResolvedValue({
      scheduleId: '100',
      enabled: true,
      nextRunAt: new Date(Date.now() + 60000).toISOString(),
    });
    scheduler.close.mockResolvedValue(undefined);
    send.sendText.mockResolvedValue({ sent: true });
  });
  afterAll(release);

  it('没有装配时不保存新提醒，并拒绝双重调度拥有者', async () => {
    const unbound = new BotReminderService(
      store as never,
      permissions as never,
      account as never,
      send as never,
      { require: () => adapter } as never,
      history as never,
    );
    await expect(
      unbound.manage(
        message,
        { operation: 'create', dailyAt: '18:00', text: '提醒' },
        'hermes-agent',
      ),
    ).rejects.toThrow('尚未装配');
    expect(store.create).not.toHaveBeenCalled();
    expect(() => service.attach(scheduler)).toThrow('已经装配');
  });

  it('保存最小消息及每日时刻，向调度适配器只提供身份与时序', async () => {
    const result = await service.manage(
      message,
      { operation: 'create', dailyAt: '18:00', text: '吃饭' },
      'hermes-agent',
    );
    expect(result).toMatchObject({
      status: 'scheduled',
      timezone: 'Asia/Shanghai',
    });
    const [id, data] = store.create.mock.calls[0];
    expect(id).toMatch(/^[a-f0-9]{64}-/);
    expect(data.repeat).toBe('0 18 * * *');
    expect(data.message).not.toHaveProperty('replyMessageId');
    expect(data.message.rawEvent).toEqual({});
    expect(data.sourcePluginKey).toBe('hermes-agent');
    expect(scheduler.ensure).toHaveBeenCalledWith({
      id,
      dueAt: data.dueAt,
      repeat: '0 18 * * *',
    });
    expect(rows.get(id)).toMatchObject({
      status: 'scheduled',
      scheduleId: '100',
      syncPending: false,
    });
  });

  it('按持久发生日期轮换文案，相同日期重试保持正文及提及一致', async () => {
    await service.manage(
      message,
      {
        operation: 'create',
        dailyAt: '18:00',
        text: '浇水',
        variants: ['第一天', '第二天'],
        platformId: 'member',
      },
      'hermes-agent',
    );
    const data = store.create.mock.calls[0][1];
    const second = new Date(Date.parse(data.dueAt) + 86400000).toISOString();
    await service.deliver(data);
    await service.deliver(data, second);
    await service.deliver(data, second);
    expect(send.sendText.mock.calls.map(([input]) => input.message)).toEqual([
      '<qqbot-at-user id="member" /> 第一天',
      '<qqbot-at-user id="member" /> 第二天',
      '<qqbot-at-user id="member" /> 第二天',
    ]);
  });

  it('调度响应失败仍保留可恢复意图，不声称安排成功也不重建提醒身份', async () => {
    scheduler.ensure.mockRejectedValueOnce(new Error('调度响应丢失'));
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
    ).rejects.toThrow('响应丢失');
    const row = [...rows.values()][0];
    expect(row).toMatchObject({
      status: 'pending',
      syncPending: true,
      lastError: '调度响应丢失',
    });
    await service.synchronize(row.id);
    expect(rows.size).toBe(1);
    expect(rows.get(row.id).status).toBe('scheduled');
    expect(scheduler.ensure.mock.calls[1][0].id).toBe(row.id);
  });

  it('取消先保存意图，关闭计划失败后到期执行也不能发送', async () => {
    await service.manage(
      message,
      { operation: 'create', dailyAt: '18:00', text: '提醒' },
      'hermes-agent',
    );
    const row = [...rows.values()][0];
    scheduler.close.mockRejectedValueOnce(new Error('暂不可达'));
    await expect(
      service.manage(
        message,
        { operation: 'delete', id: row.id },
        'hermes-agent',
      ),
    ).rejects.toThrow('暂不可达');
    expect(rows.get(row.id)).toMatchObject({
      status: 'cancelled',
      syncPending: true,
    });
    await expect(
      service.execute(row.id, row.data.dueAt, new AbortController().signal),
    ).rejects.toThrow('已取消');
    expect(send.sendText).not.toHaveBeenCalled();
    await service.synchronize(row.id);
    expect(rows.get(row.id).syncPending).toBe(false);
  });

  it('隔离不同发起人的列表及取消请求', async () => {
    await service.manage(
      message,
      { operation: 'create', dailyAt: '18:00', text: '提醒' },
      'hermes-agent',
    );
    const row = [...rows.values()][0];
    await expect(
      service.manage(
        { ...message, userId: 'bob' },
        { operation: 'delete', id: row.id },
        'hermes-agent',
      ),
    ).rejects.toThrow('不属于');
    expect(
      await service.manage(
        { ...message, userId: 'bob' },
        { operation: 'list' },
        'hermes-agent',
      ),
    ).toEqual({ daily: [], jobs: [] });
    expect(scheduler.close).not.toHaveBeenCalled();
  });

  it('到期重新校验腾讯绑定并保留平台拒绝信息', async () => {
    const data = {
      message,
      sourcePluginKey: 'hermes-agent',
      text: '到时间了',
    } as never;
    adapter.listBoundPluginKeys.mockResolvedValueOnce([]);
    await expect(service.deliver(data)).rejects.toThrow('绑定已撤销');
    expect(send.sendText).not.toHaveBeenCalled();
    send.sendText.mockRejectedValueOnce(
      new Error('platform rejected proactive message'),
    );
    await expect(service.deliver(data)).rejects.toThrow('platform rejected');
    send.sendText.mockRejectedValueOnce(
      new HttpException({ msg: '主动消息失败, 无权限' }, 403),
    );
    await expect(service.deliver(data)).rejects.toThrow('主动消息失败, 无权限');
    expect(account.getBoundEventPluginKeys).not.toHaveBeenCalled();
  });

  it.each(['daily', 'once'])(
    '保留 %s 提醒的已验证目标，忽略伪造发起人及群信息',
    async (kind) => {
      let timing = { dailyAt: '17:30' } as Record<string, string>;
      if (kind === 'once')
        timing = { runAt: new Date(Date.now() + 60000).toISOString() };
      const result = await service.manage(
        message,
        {
          operation: 'create',
          text: '浇水',
          platformId: 'member',
          ...timing,
          selfId: 'forged',
          targetId: 'forged',
          userId: 'forged',
        },
        'hermes-agent',
      );
      expect(result).toMatchObject({
        status: 'scheduled',
        platformId: 'member',
      });
      const data = JSON.parse(JSON.stringify(store.create.mock.calls[0][1]));
      expect(data.message).toMatchObject({
        selfId: message.selfId,
        targetId: message.targetId,
        userId: message.userId,
      });
      await service.deliver(data);
      expect(send.sendText).toHaveBeenCalledWith(
        expect.objectContaining({
          message: '<qqbot-at-user id="member" /> 浇水',
          targetId: message.targetId,
        }),
      );
      expect(history.requireMember).toHaveBeenCalledTimes(1);
    },
  );

  it('列表显示计划的实际停用状态并保留已确认的提及目标', async () => {
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
    scheduler.read.mockResolvedValue({
      scheduleId: '100',
      enabled: false,
      nextRunAt: null,
    });
    expect(
      await service.manage(message, { operation: 'list' }, 'hermes-agent'),
    ).toMatchObject({
      daily: [{ platformId: 'member', status: 'disabled', nextRunAt: null }],
    });
  });

  it('空成员字段保留普通群和私聊提醒', async () => {
    for (const messageType of ['group', 'private'] as const) {
      await service.manage(
        { ...message, messageType },
        {
          operation: 'create',
          text: '普通提醒',
          dailyAt: '17:30',
          runAt: '',
          id: '',
          platformId: '',
        },
        'hermes-agent',
      );
      const data = store.create.mock.calls.at(-1)[1];
      expect(data.platformId).toBeUndefined();
      await service.deliver(data);
      expect(send.sendText).toHaveBeenLastCalledWith(
        expect.objectContaining({
          message: '普通提醒',
          targetType: messageType,
        }),
      );
    }
    expect(history.requireMember).not.toHaveBeenCalled();
  });

  it('未确认成员、私聊提及及任何正文中的交互标签均在保存前拒绝', async () => {
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
      await expect(
        service.manage(
          message,
          {
            operation: 'create',
            text: '提醒',
            variants: ['正常', text],
            dailyAt: '17:30',
          },
          'hermes-agent',
        ),
      ).rejects.toThrow('普通文本');
    }
    expect(store.create).not.toHaveBeenCalled();
  });

  it('渲染 OneBot 及频道提及，并拒绝损坏的持久目标', async () => {
    const data = {
      message: { ...message, connectionMode: 'reverse-ws' },
      sourcePluginKey: 'hermes-agent',
      text: '提醒',
      platformId: '12345',
    };
    await service.deliver(data as never);
    expect(send.sendText).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: '[CQ:at,qq=12345] 提醒' }),
    );
    await service.deliver({
      ...data,
      message: { ...message, messageType: 'channel' },
    } as never);
    expect(send.sendText).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: '<@12345> 提醒' }),
    );
    await expect(
      service.deliver({ ...data, platformId: 'bad" />' } as never),
    ).rejects.toThrow('平台ID');
  });

  it('一次性提醒保留发送结果并阻止重复发送', async () => {
    await service.manage(
      message,
      {
        operation: 'create',
        runAt: new Date(Date.now() + 60000).toISOString(),
        text: '提醒',
      },
      'hermes-agent',
    );
    const row = [...rows.values()][0];
    await service.execute(row.id, row.data.dueAt, new AbortController().signal);
    expect(rows.get(row.id).status).toBe('succeeded');
    await expect(
      service.execute(row.id, row.data.dueAt, new AbortController().signal),
    ).rejects.toThrow('不能重复');
    expect(send.sendText).toHaveBeenCalledTimes(1);
  });

  it('真实工具 HTTP 请求经过成员校验、持久意图和独立发送入口', async () => {
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
      const contextId = sessions.open(message, 'hermes-agent', {
        pluginKeys: ['hermes-agent'],
      });
      const response = await fetch(`${await app.getUrl()}/bot/tools/call`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contextId,
          action: 'reminder',
          operation: 'create',
          runAt: new Date(Date.now() + 60000).toISOString(),
          text: '提醒',
          platformId: 'member',
        }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        result: { status: 'scheduled', platformId: 'member' },
      });
      sessions.close(contextId);
      const row = [...rows.values()][0];
      await service.execute(
        row.id,
        row.data.dueAt,
        new AbortController().signal,
      );
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

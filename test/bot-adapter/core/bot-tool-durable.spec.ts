import { BotToolSessionService } from '@/modules/bot-adapter/core/application/command/bot-tool-session.service';

describe('持久工具授权的读取、副作用和重启边界', () => {
  const message = {
    selfId: 'qq-official:test',
    userId: 'member-a',
    targetId: 'group-a',
    messageId: 'event-a',
    messageType: 'group',
    messageText: '查记录',
    eventTime: new Date(),
  } as any;
  let values: Map<string, any>;
  let store: any;
  let permissions: any;
  let commands: any;
  let reminders: any;
  let adapter: any;
  const service = () =>
    new BotToolSessionService(
      permissions,
      commands,
      undefined,
      reminders,
      undefined,
      undefined,
      store,
      { require: () => adapter } as never,
    );
  beforeEach(() => {
    values = new Map();
    store = {
      read: jest.fn(async (key) => values.get(key)),
      write: jest.fn(async (key, value) => {
        values.set(key, JSON.parse(JSON.stringify(value)));
      }),
      reserve: jest.fn(async (key) => {
        if (values.has(key)) return false;
        values.set(key, { status: 'running' });
        return true;
      }),
      redis: { incr: jest.fn().mockResolvedValue(1), expire: jest.fn() },
    };
    permissions = {
      isBlocked: jest.fn().mockResolvedValue(false),
      isAllowed: jest.fn().mockResolvedValue(true),
    };
    commands = {
      isReadOnlyForTools: jest.fn().mockResolvedValue(false),
      executeForTools: jest.fn().mockResolvedValue({ status: 'success' }),
    };
    reminders = { manage: jest.fn().mockResolvedValue({ jobs: [] }) };
    adapter = {
      listBoundPluginKeys: jest.fn().mockResolvedValue(['hermes-agent']),
      readConversationApi: jest.fn().mockResolvedValue({ id: 'current' }),
    };
  });
  it('restores the original sender and reuses confirmed side effects after service restart', async () => {
    await service().openDurable(
      'context',
      message,
      Date.now() + 100000,
      'hermes-agent',
    );
    const input = {
      action: 'run',
      commandId: 'command',
      text: '/run',
      userId: 'forged',
      targetId: 'another-group',
    };
    await service().call('context', input);
    await service().call('context', input);
    expect(commands.executeForTools).toHaveBeenCalledTimes(1);
    expect(commands.executeForTools.mock.calls[0][0]).toMatchObject({
      userId: 'member-a',
      targetId: 'group-a',
    });
    await service().closeDurable('context');
    await expect(service().call('context', input)).rejects.toThrow('失效');
  });
  it('does not repeat an operation with unknown outcome or revoked permission', async () => {
    await service().openDurable(
      'context',
      message,
      Date.now() + 100000,
      'hermes-agent',
    );
    commands.executeForTools.mockRejectedValueOnce(
      new Error('timeout after dispatch'),
    );
    const input = { action: 'run', commandId: 'command', text: '/run' };
    await expect(service().call('context', input)).rejects.toThrow('timeout');
    await expect(service().call('context', input)).rejects.toThrow('尚未确认');
    permissions.isAllowed.mockResolvedValue(false);
    await expect(service().call('context', input)).rejects.toThrow('权限');
    expect(commands.executeForTools).toHaveBeenCalledTimes(1);
  });
  it('refreshes reminder listings and permits read-only pagination without consuming write limits', async () => {
    await service().openDurable(
      'context',
      message,
      Date.now() + 100000,
      'hermes-agent',
    );
    const current = service();
    await current.call('context', { action: 'reminder', operation: 'list' });
    reminders.manage.mockResolvedValueOnce({ jobs: ['new'] });
    await expect(
      current.call('context', { action: 'reminder', operation: 'list' }),
    ).resolves.toEqual({ jobs: ['new'] });
    commands.isReadOnlyForTools.mockResolvedValue(true);
    for (let index = 0; index < 12; index++)
      await current.call('context', {
        action: 'run',
        commandId: 'read',
        text: `/read start=${index}`,
      });
    expect(commands.executeForTools).toHaveBeenCalledTimes(12);
    expect(store.reserve).not.toHaveBeenCalled();
  });
  it('uses the current adapter after restart and never extends an expired authorization', async () => {
    await service().openDurable(
      'context',
      message,
      Date.now() + 100000,
      'hermes-agent',
    );
    await service().call('context', {
      action: 'platform_api',
      method: 'GET',
      path: '/users/@me',
    });
    expect(adapter.readConversationApi).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionKey: 'qq-official:test',
        targetKey: 'group-a',
      }),
    );
    adapter.listBoundPluginKeys.mockResolvedValue([]);
    await expect(
      service().call('context', { action: 'reminder', operation: 'list' }),
    ).rejects.toThrow('授权已撤销');
    values.get('turn:context').expiresAt = Date.now() - 1;
    await expect(
      service().call('context', { action: 'reminder', operation: 'list' }),
    ).rejects.toThrow('失效');
  });
});

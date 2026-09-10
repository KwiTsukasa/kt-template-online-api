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
  const service = new BotReminderService(
    { get: () => undefined, getOrThrow: () => '127.0.0.1' } as never,
    permissions as never,
    account as never,
    send as never,
    { require: () => adapter } as never,
  );
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueue.getJobs.mockResolvedValue([]);
    mockQueue.getJobSchedulers.mockResolvedValue([]);
    permissions.isBlocked.mockResolvedValue(false);
    permissions.isAllowed.mockResolvedValue(true);
    adapter.listBoundPluginKeys.mockResolvedValue(['hermes-agent']);
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
});

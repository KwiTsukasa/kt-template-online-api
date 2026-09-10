import { TencentBotService } from '@/modules/bot-adapter/tencent/infrastructure/tencent-bot.service';

describe('Tencent conversation API tools', () => {
  const service = Object.create(TencentBotService.prototype) as any;
  const account = {
    bot: { api: { get: jest.fn().mockResolvedValue({ ok: true }) } },
  };
  const message = { guildId: '123', channelId: '456' };
  beforeEach(() => jest.clearAllMocks());

  it('delegates the current guild read and blocks other channels, path traversal and unsupported queries', async () => {
    await expect(
      service.readConversationApi(account, message, {
        path: '/guilds/123/members',
        query: { limit: '20' },
      }),
    ).resolves.toEqual({ ok: true });
    expect(account.bot.api.get).toHaveBeenCalledWith('/guilds/123/members', {
      limit: '20',
    });
    for (const input of [
      { path: '/channels/789' },
      { path: '/channels/456/../789' },
      { path: '/users/@me', query: { unsupported: 'injected' } },
      { path: '/users/@me', query: { limit: '401' } },
    ]) {
      await expect(
        service.readConversationApi(account, message, input),
      ).rejects.toThrow();
    }
    expect(account.bot.api.get).toHaveBeenCalledTimes(1);
  });

  it('does not fabricate a guild scope for ordinary QQ groups', async () => {
    await expect(
      service.readConversationApi(account, {}, { path: '/users/@me' }),
    ).resolves.toEqual({ ok: true });
    await expect(
      service.readConversationApi(account, {}, { path: '/guilds/123/members' }),
    ).rejects.toThrow('当前会话');
  });
});

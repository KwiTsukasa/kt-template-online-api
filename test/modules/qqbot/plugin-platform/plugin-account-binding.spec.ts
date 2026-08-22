import { QqbotPluginAccountBindingService } from '@/modules/qqbot/plugin-platform/application/account-binding/qqbot-plugin-account-binding.service';

describe('QQBot plugin account binding', () => {
  const officialAccount = {
    connectionMode: 'official-websocket',
    enabled: true,
    id: '2090739000000000001',
    isDeleted: false,
    name: 'Official Bot',
    selfId: 'qq-official:1020000000',
  };
  const plugin = {
    id: '2060000000000000002',
    pluginKey: 'bangdream',
    pluginName: 'BangDream',
    status: 'enabled',
  };

  it('lists an unbound official account in the same platform matrix as other transports', async () => {
    const bindingRepository = {
      find: jest.fn(async () => []),
    };
    const pluginRepository = {
      find: jest.fn(async () => [plugin]),
    };
    const accountService = {
      allEnabled: jest.fn(async () => [officialAccount]),
    };
    const service = new QqbotPluginAccountBindingService(
      bindingRepository as any,
      pluginRepository as any,
      accountService as any,
    );

    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({
        accountId: officialAccount.id,
        bound: false,
        connectionMode: 'official-websocket',
        id: null,
        pluginId: plugin.id,
        pluginKey: 'bangdream',
        selfId: officialAccount.selfId,
      }),
    ]);
  });

  it('persists and resolves official account bindings by stable business keys', async () => {
    const savedBinding = {
      accountId: officialAccount.id,
      enabled: true,
      id: '2090739000000000100',
      pluginId: plugin.id,
    };
    const bindingRepository = {
      count: jest.fn(async () => 1),
      create: jest.fn((value) => value),
      find: jest.fn(async () => [savedBinding]),
      findOne: jest.fn(async () => null),
      save: jest.fn(async () => savedBinding),
      update: jest.fn(async () => ({ affected: 1 })),
    };
    const pluginRepository = {
      find: jest.fn(async () => [plugin]),
      findOne: jest.fn(async () => plugin),
    };
    const accountService = {
      findBySelfId: jest.fn(async () => officialAccount),
    };
    const service = new QqbotPluginAccountBindingService(
      bindingRepository as any,
      pluginRepository as any,
      accountService as any,
    );

    await expect(
      service.bind({
        pluginKey: plugin.pluginKey,
        selfId: officialAccount.selfId,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        bound: true,
        connectionMode: 'official-websocket',
        pluginKey: 'bangdream',
        selfId: officialAccount.selfId,
      }),
    );
    expect(bindingRepository.create).toHaveBeenCalledWith({
      accountId: officialAccount.id,
      enabled: true,
      pluginId: plugin.id,
    });
    await expect(
      service.listBoundPluginKeys(officialAccount.selfId),
    ).resolves.toEqual(['bangdream']);
    await expect(
      service.isBound({
        pluginKey: plugin.pluginKey,
        selfId: officialAccount.selfId,
      }),
    ).resolves.toBe(true);
  });
});

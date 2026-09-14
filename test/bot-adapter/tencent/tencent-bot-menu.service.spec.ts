import { TencentBotMenuService } from '@/modules/bot-adapter/tencent/application/tencent-bot-menu.service';
import { createServer } from 'node:http';
import { once } from 'node:events';

describe('TencentBotMenuService', () => {
  it('projects bound protocol commands into C2C menu and four official panel scopes', async () => {
    const syncPluginMenus = jest.fn().mockResolvedValue({ menuUpdated: 1 });
    const service = new TencentBotMenuService(
      {
        findById: jest.fn().mockResolvedValue({
          id: 'account-1',
          selfId: 'qq-official:1020000000',
        }),
      } as never,
      {
        listBoundPluginKeys: jest.fn().mockResolvedValue(['demo']),
      } as never,
      {
        find: jest.fn().mockResolvedValue([
          {
            aliases: '["状态"]',
            code: 'status',
            name: '查询状态',
            pluginKey: 'demo',
            prefixes: '["/"]',
            targetType: 'all',
          },
          {
            aliases: '["群排行"]',
            code: 'group-rank',
            name: '群排行',
            pluginKey: 'demo',
            prefixes: '["/"]',
            targetType: 'group',
          },
          {
            aliases: '["频道"]',
            code: 'channel',
            name: '频道帮助',
            pluginKey: 'demo',
            prefixes: '["/"]',
            targetType: 'channel',
          },
        ]),
      } as never,
      {
        listPlugins: jest.fn().mockResolvedValue([
          {
            key: 'demo',
            name: '演示插件',
            operationCount: 3,
            triggerMode: 'command',
            version: '1.0.0',
          },
        ]),
      } as never,
      { syncPluginMenus } as never,
    );

    await expect(service.sync('account-1')).resolves.toEqual({
      menuUpdated: 1,
    });
    expect(syncPluginMenus).toHaveBeenCalledWith({
      projection: {
        menuItems: [
          {
            name: 'KT·1演示',
            sub_menu_items: [
              { name: '状态', send_message: '/状态', type: 'send_message' },
            ],
            type: 'menu',
          },
        ],
        panels: {
          c2c: [
            {
              desc: '查询状态',
              name: '状态',
              only_admin: false,
              type: 'command',
            },
          ],
          channel: [
            {
              desc: '查询状态',
              name: '状态',
              only_admin: false,
              type: 'command',
            },
            {
              desc: '频道帮助',
              name: '频道',
              only_admin: false,
              type: 'command',
            },
          ],
          dm: [
            {
              desc: '查询状态',
              name: '状态',
              only_admin: false,
              type: 'command',
            },
            {
              desc: '频道帮助',
              name: '频道',
              only_admin: false,
              type: 'command',
            },
          ],
          group: [
            {
              desc: '查询状态',
              name: '状态',
              only_admin: false,
              type: 'command',
            },
            {
              desc: '群排行',
              name: '群排行',
              only_admin: false,
              type: 'command',
            },
          ],
        },
      },
      selfId: 'qq-official:1020000000',
    });
  });

  it('limits shortcuts to twenty and reports omitted entries without losing the full command menu', async () => {
    const syncPluginMenus = jest.fn().mockResolvedValue({ menuUpdated: 1 });
    const commands = Array.from({ length: 21 }, (_value, index) => ({
      aliases: `["c${index}"]`,
      code: `c${index}`,
      name: `Command ${index}`,
      pluginKey: 'demo',
      prefixes: '["/"]',
      targetType: 'all',
    }));
    const service = new TencentBotMenuService(
      {
        findById: jest.fn().mockResolvedValue({
          id: 'account-1',
          selfId: 'qq-official:1020000000',
        }),
      } as never,
      {
        listBoundPluginKeys: jest.fn().mockResolvedValue(['demo']),
      } as never,
      { find: jest.fn().mockResolvedValue(commands) } as never,
      {
        listPlugins: jest.fn().mockResolvedValue([
          {
            key: 'demo',
            name: 'Demo',
            operationCount: 21,
            triggerMode: 'command',
            version: '1.0.0',
          },
        ]),
      } as never,
      { syncPluginMenus } as never,
    );

    const server = createServer(async (_request, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(await service.sync('account-1')));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const address = server.address() as { port: number };
      const response = await fetch(
        `http://127.0.0.1:${address.port}/menu/sync`,
        { method: 'POST' },
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        menuUpdated: 1,
        omittedPanelCommands: {
          c2c: ['c20'],
          channel: ['c20'],
          dm: ['c20'],
          group: ['c20'],
        },
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    const { projection } = syncPluginMenus.mock.calls[0][0];
    expect(projection.panels.c2c).toHaveLength(20);
    expect(
      projection.panels.group.map((item: { name: string }) => item.name),
    ).toEqual(commands.slice(0, 20).map((command) => command.code));
    expect(
      projection.menuItems.flatMap(
        (item: { sub_menu_items: unknown[] }) => item.sub_menu_items,
      ),
    ).toHaveLength(21);
  });
});

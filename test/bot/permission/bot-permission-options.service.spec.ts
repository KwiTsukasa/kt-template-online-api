jest.mock(
  '@/modules/bot-adapter/core/infrastructure/integration/connection/bot-reverse-ws.service',
  () => ({ BotReverseWsService: class {} }),
);

import { Test } from '@nestjs/testing';
import { ToolsService } from '@/common';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { BotPermissionController } from '@/modules/bot-adapter/core/contract/permission/bot-permission.controller';
import { BotPermissionService } from '@/modules/bot-adapter/core/application/permission/bot-permission.service';
import { BotPermissionOptionsService } from '@/modules/bot-adapter/core/application/permission/bot-permission-options.service';
import { BotConfigService } from '@/modules/bot-adapter/core/application/config/bot-config.service';

const createHarness = () => {
  const accounts = [
    {
      selfId: '100001',
      name: 'NapCat',
      connectionMode: 'reverse-ws',
      enabled: true,
    },
    {
      selfId: 'qq-official:200001',
      name: 'Official',
      connectionMode: 'official-websocket',
      enabled: false,
    },
  ];
  const messages = [
    {
      selfId: 'qq-official:200001',
      messageType: 'group',
      targetId: 'group-a',
      userId: 'user-a',
      senderNickname: 'A',
      direction: 'inbound',
    },
    {
      selfId: 'qq-official:200001',
      messageType: 'group',
      targetId: 'group-b',
      userId: 'user-b',
      senderNickname: 'B',
      direction: 'inbound',
    },
    {
      selfId: 'qq-official:other',
      messageType: 'group',
      targetId: 'group-a',
      userId: 'foreign',
      direction: 'inbound',
    },
    {
      selfId: 'qq-official:200001',
      messageType: 'group',
      targetId: 'group-a',
      userId: 'bot',
      direction: 'outbound',
    },
  ];
  const accountRepository = { find: jest.fn().mockResolvedValue(accounts) };
  const messageRepository = {
    createQueryBuilder: () => {
      const parameters: Record<string, string> = {};
      let field = '';
      const builder = {
        select: (value: string) => {
          field = value.split('.')[1];
          return builder;
        },
        addSelect: () => builder,
        where: (_sql: string, values: Record<string, string>) => {
          Object.assign(parameters, values);
          return builder;
        },
        andWhere: (_sql: string, values: Record<string, string>) => {
          Object.assign(parameters, values);
          return builder;
        },
        groupBy: () => builder,
        orderBy: () => builder,
        getRawMany: async () =>
          messages
            .filter(
              (row) =>
                row.selfId === parameters.selfId &&
                row.direction === parameters.direction &&
                (!parameters.targetType ||
                  row.messageType === parameters.targetType) &&
                (!parameters.targetId || row.targetId === parameters.targetId),
            )
            .map((row) => ({ value: row[field], name: row.senderNickname })),
      };
      return builder;
    },
  };
  const reverseWs = {
    sendAction: jest.fn(async (_selfId, action, params) => {
      if (action === 'get_group_list')
        return {
          status: 'ok',
          data: [
            { group_id: '300001', group_name: 'Group A' },
            { group_id: '300002', group_name: 'Group B' },
          ],
        };
      if (action === 'get_group_member_list')
        return {
          status: 'ok',
          data: [{ user_id: `${params.group_id}1`, card: 'Member' }],
        };
      return {
        status: 'ok',
        data: [{ user_id: '400001', nickname: 'Friend' }],
      };
    }),
  };
  const service = new BotPermissionOptionsService(
    accountRepository as any,
    messageRepository as any,
    reverseWs as any,
  );
  return { accountRepository, reverseWs, service };
};

describe('Bot permission cascades', () => {
  it('returns all adapters including disabled accounts without credential fields', async () => {
    const harness = createHarness();
    const result = await harness.service.list({});
    expect(result.accounts.map((item) => item.value)).toEqual([
      '100001',
      'qq-official:200001',
    ]);
    expect(harness.accountRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isDeleted: false },
        select: ['selfId', 'name', 'connectionMode', 'enabled'],
      }),
    );
    expect(result.targets).toEqual([]);
  });

  it('uses only the selected group for exact NapCat member candidates', async () => {
    const harness = createHarness();
    const result = await harness.service.list({
      selfId: '100001',
      targetType: 'group',
      targetId: '300002',
    });
    expect(result.users).toEqual([
      { label: 'Member (3000021)', value: '3000021' },
    ]);
    expect(harness.reverseWs.sendAction).toHaveBeenCalledWith(
      '100001',
      'get_group_member_list',
      { group_id: '300002' },
    );
    harness.reverseWs.sendAction.mockClear();
    const unknown = await harness.service.list({
      selfId: '100001',
      targetType: 'group',
      targetId: '999999',
    });
    expect(unknown.users).toEqual([]);
    expect(harness.reverseWs.sendAction).not.toHaveBeenCalledWith(
      '100001',
      'get_group_member_list',
      expect.anything(),
    );
  });

  it('isolates official group members by selfId, group and inbound direction', async () => {
    const harness = createHarness();
    const result = await harness.service.list({
      selfId: 'qq-official:200001',
      targetType: 'group',
      targetId: 'group-a',
    });
    expect(result.users).toEqual([{ label: 'A (user-a)', value: 'user-a' }]);
    expect(harness.reverseWs.sendAction).not.toHaveBeenCalled();
    expect(
      (
        await harness.service.list({
          selfId: 'qq-official:200001',
          targetType: 'group',
          targetId: 'missing',
        })
      ).users,
    ).toEqual([]);
    await expect(
      harness.service.list({ selfId: 'missing' }),
    ).rejects.toBeDefined();
  });

  it('serves account/group/member cascades through an actual local HTTP route', async () => {
    const harness = createHarness();
    const config = new BotConfigService({
      findOne: jest.fn().mockResolvedValue({ configValue: 'false' }),
    } as any);
    const permissions = new BotPermissionService(
      config,
      {} as any,
      {} as any,
      new ToolsService(),
    );
    const module = await Test.createTestingModule({
      controllers: [BotPermissionController],
      providers: [
        { provide: BotPermissionService, useValue: permissions },
        { provide: BotPermissionOptionsService, useValue: harness.service },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const app = module.createNestApplication();
    try {
      await app.listen(0, '127.0.0.1');
      const base = await app.getUrl();
      const response = await fetch(
        `${base}/bot/permission/options?selfId=qq-official%3A200001&targetType=group&targetId=group-a`,
        { signal: AbortSignal.timeout(5000) },
      );
      expect(response.status).toBe(200);
      expect((await response.json()).data.users).toEqual([
        { label: 'A (user-a)', value: 'user-a' },
      ]);
      const policy = await fetch(`${base}/bot/permission/config`, {
        signal: AbortSignal.timeout(5000),
      });
      expect((await policy.json()).data).toEqual({
        allowlistEnabled: true,
        blocklistEnabled: true,
      });
      await expect(
        config.updatePermissionConfig({ blocklistEnabled: false }),
      ).rejects.toBeDefined();
    } finally {
      await app.close();
    }
  });
});

import { ToolsService } from '@/common';
import { QqbotAccountService } from '@/qqbot/account/qqbot-account.service';

describe('QqbotAccountService', () => {
  it('preserves previous offline reason when later disconnect has no explicit error', async () => {
    const accountRepository = {
      update: jest.fn(),
    };
    const service = new QqbotAccountService(
      accountRepository as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      new ToolsService(),
    );

    await service.markOffline('1914728559');

    expect(accountRepository.update).toHaveBeenCalledWith(
      { selfId: '1914728559' },
      {
        connectStatus: 'offline',
      },
    );
  });

  it('truncates offline reason before writing lastError column', async () => {
    const accountRepository = {
      update: jest.fn(),
    };
    const service = new QqbotAccountService(
      accountRepository as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      new ToolsService(),
    );

    await service.markOffline('1914728559', '错误'.repeat(300));

    expect(accountRepository.update).toHaveBeenCalledWith(
      { selfId: '1914728559' },
      {
        connectStatus: 'offline',
        lastError: `${'错误'.repeat(248)}错...`,
      },
    );
  });

  it('syncs NapCat runtime offline logs back to account list status', async () => {
    const account = {
      connectStatus: 'online',
      enabled: true,
      id: 'account-1',
      isDeleted: false,
      lastError: null,
      name: '主账号',
      selfId: '1914728559',
    };
    const binding = {
      accountId: 'account-1',
      bindStatus: 'bound',
      containerId: 'container-1',
      isDeleted: false,
      isPrimary: true,
      lastLoginAt: new Date('2026-06-10T12:00:00.000Z'),
    };
    const container = {
      id: 'container-1',
      isDeleted: false,
      lastError: null,
      name: 'kt-qqbot-napcat-1914728559',
      status: 'running',
      webuiPort: 6101,
    };
    const createAccountBuilder = () => ({
      andWhere: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[account], 1]),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    });
    const createBindingBuilder = () => ({
      addOrderBy: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([binding]),
      orderBy: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    });
    const createContainerBuilder = () => ({
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([container]),
      where: jest.fn().mockReturnThis(),
    });
    const accountRepository = {
      createQueryBuilder: jest.fn(createAccountBuilder),
      update: jest.fn(),
    };
    const napcatContainerService = {
      detectRuntimeOffline: jest
        .fn()
        .mockResolvedValue('NapCat 账号状态变更为离线'),
    };
    const systemNoticePublisher = {
      publishSystemNotice: jest.fn().mockResolvedValue('notice-1'),
    };
    const service = new QqbotAccountService(
      accountRepository as any,
      {} as any,
      { createQueryBuilder: jest.fn(createBindingBuilder) } as any,
      { createQueryBuilder: jest.fn(createContainerBuilder) } as any,
      napcatContainerService as any,
      new ToolsService(),
      systemNoticePublisher as any,
    );

    const page = await service.page({});

    expect(accountRepository.update).toHaveBeenCalledWith(
      { selfId: '1914728559' },
      {
        connectStatus: 'offline',
        lastError: 'NapCat 账号状态变更为离线',
      },
    );
    expect(page.list[0]).toEqual(
      expect.objectContaining({
        connectStatus: 'offline',
        lastError: 'NapCat 账号状态变更为离线',
      }),
    );
    expect(systemNoticePublisher.publishSystemNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'NapCat 账号状态变更为离线',
        dedupeKey: 'qqbot:offline:1914728559',
        eventType: 'qqbot.account.offline',
        notifyRoleCode: 'super',
        severity: 'error',
        source: 'qqbot',
        title: 'QQBot 账号已下线：1914728559',
      }),
    );
  });

  it('does not re-read NapCat logs when the container was checked recently', async () => {
    const account = {
      connectStatus: 'online',
      enabled: true,
      id: 'account-1',
      isDeleted: false,
      lastError: null,
      name: '主账号',
      selfId: '1914728559',
    };
    const binding = {
      accountId: 'account-1',
      bindStatus: 'bound',
      containerId: 'container-1',
      isDeleted: false,
      isPrimary: true,
      lastLoginAt: new Date('2026-06-10T12:00:00.000Z'),
    };
    const container = {
      id: 'container-1',
      isDeleted: false,
      lastCheckedAt: new Date(),
      lastError: null,
      name: 'kt-qqbot-napcat-1914728559',
      status: 'running',
      webuiPort: 6101,
    };
    const accountRepository = {
      createQueryBuilder: jest.fn(() => ({
        andWhere: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[account], 1]),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
      })),
      update: jest.fn(),
    };
    const napcatContainerService = {
      detectRuntimeOffline: jest.fn(),
    };
    const service = new QqbotAccountService(
      accountRepository as any,
      {} as any,
      {
        createQueryBuilder: jest.fn(() => ({
          addOrderBy: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([binding]),
          orderBy: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
        })),
      } as any,
      {
        createQueryBuilder: jest.fn(() => ({
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([container]),
          where: jest.fn().mockReturnThis(),
        })),
      } as any,
      napcatContainerService as any,
      new ToolsService(),
    );

    const page = await service.page({});

    expect(napcatContainerService.detectRuntimeOffline).not.toHaveBeenCalled();
    expect(accountRepository.update).not.toHaveBeenCalled();
    expect(page.list[0]).toEqual(
      expect.objectContaining({
        connectStatus: 'online',
        napcat: expect.objectContaining({
          lastCheckedAt: container.lastCheckedAt,
        }),
      }),
    );
  });

  it('ignores cached NapCat offline reason after the account reconnects', async () => {
    const checkedAt = new Date('2026-06-11T02:00:00.000Z');
    const account = {
      connectStatus: 'online',
      enabled: true,
      id: 'account-1',
      isDeleted: false,
      lastConnectedAt: new Date('2026-06-11T02:00:10.000Z'),
      lastError: null,
      name: '主账号',
      selfId: '1914728559',
    };
    const binding = {
      accountId: 'account-1',
      bindStatus: 'bound',
      containerId: 'container-1',
      isDeleted: false,
      isPrimary: true,
      lastLoginAt: checkedAt,
    };
    const container = {
      id: 'container-1',
      isDeleted: false,
      lastCheckedAt: checkedAt,
      lastError: '账号状态变更为离线',
      name: 'kt-qqbot-napcat-1914728559',
      status: 'running',
      webuiPort: 6101,
    };
    const accountRepository = {
      createQueryBuilder: jest.fn(() => ({
        andWhere: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[account], 1]),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
      })),
      update: jest.fn(),
    };
    const napcatContainerService = {
      detectRuntimeOffline: jest.fn(),
    };
    const systemNoticePublisher = {
      publishSystemNotice: jest.fn(),
    };
    const service = new QqbotAccountService(
      accountRepository as any,
      {} as any,
      {
        createQueryBuilder: jest.fn(() => ({
          addOrderBy: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([binding]),
          orderBy: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
        })),
      } as any,
      {
        createQueryBuilder: jest.fn(() => ({
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([container]),
          where: jest.fn().mockReturnThis(),
        })),
      } as any,
      napcatContainerService as any,
      new ToolsService(),
      systemNoticePublisher as any,
    );

    const page = await service.page({});

    expect(napcatContainerService.detectRuntimeOffline).not.toHaveBeenCalled();
    expect(accountRepository.update).not.toHaveBeenCalled();
    expect(systemNoticePublisher.publishSystemNotice).not.toHaveBeenCalled();
    expect(page.list[0]).toEqual(
      expect.objectContaining({
        connectStatus: 'online',
        lastError: null,
      }),
    );
  });
});

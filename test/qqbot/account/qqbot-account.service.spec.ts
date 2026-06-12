import { ToolsService } from '@/common';
import { QqbotAccountService } from '@/qqbot/account/qqbot-account.service';

describe('QqbotAccountService', () => {
  it('stores NapCat login password as encrypted secret and never persists the transport field', async () => {
    const toolsService = new ToolsService();
    const accountRepository = {
      create: jest.fn((input) => input),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (input) => ({ ...input, id: 'account-1' })),
    };
    const service = new QqbotAccountService(
      accountRepository as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      toolsService,
      undefined,
      {
        get: jest.fn((key: string) =>
          key === 'QQBOT_ACCOUNT_SECRET_KEY' ? 'unit-secret' : '',
        ),
      } as any,
      {
        decryptPassword: jest.fn().mockReturnValue('qq-login-password'),
      } as any,
    );

    await service.save({
      encryptedLoginPassword: 'encrypted-payload',
      selfId: '1914728559',
    });

    const payload = accountRepository.create.mock.calls[0][0];
    expect(payload.encryptedLoginPassword).toBeUndefined();
    expect(payload.napcatLoginPasswordSecret).toBeTruthy();
    expect(payload.napcatLoginPasswordSecret).not.toContain(
      'qq-login-password',
    );
    expect(
      toolsService.decryptSecretText(
        payload.napcatLoginPasswordSecret,
        'unit-secret',
      ),
    ).toBe('qq-login-password');
  });

  it('requires an explicit secret key before storing NapCat login password', async () => {
    const accountRepository = {
      create: jest.fn((input) => input),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (input) => ({ ...input, id: 'account-1' })),
    };
    const service = new QqbotAccountService(
      accountRepository as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      new ToolsService(),
      undefined,
      {
        get: jest.fn().mockReturnValue(''),
      } as any,
      {
        decryptPassword: jest.fn().mockReturnValue('qq-login-password'),
      } as any,
    );

    await expect(
      service.save({
        encryptedLoginPassword: 'encrypted-payload',
        selfId: '1914728559',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        msg: 'QQBot 账号登录密码密钥未配置，请设置 QQBOT_ACCOUNT_SECRET_KEY 或 ADMIN_TOKEN_SECRET',
      }),
    });
    expect(accountRepository.save).not.toHaveBeenCalled();
  });

  it('rejects public placeholder secret before storing NapCat login password', async () => {
    const accountRepository = {
      create: jest.fn((input) => input),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (input) => ({ ...input, id: 'account-1' })),
    };
    const service = new QqbotAccountService(
      accountRepository as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      new ToolsService(),
      undefined,
      {
        get: jest.fn((key: string) =>
          key === 'ADMIN_TOKEN_SECRET' ? 'change-me' : '',
        ),
      } as any,
      {
        decryptPassword: jest.fn().mockReturnValue('qq-login-password'),
      } as any,
    );

    await expect(
      service.save({
        encryptedLoginPassword: 'encrypted-payload',
        selfId: '1914728559',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        msg: 'QQBot 账号登录密码密钥未配置，请设置 QQBOT_ACCOUNT_SECRET_KEY 或 ADMIN_TOKEN_SECRET',
      }),
    });
    expect(accountRepository.save).not.toHaveBeenCalled();
  });

  it('preserves NapCat login password whitespace after decryption', async () => {
    const toolsService = new ToolsService();
    const accountRepository = {
      create: jest.fn((input) => input),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (input) => ({ ...input, id: 'account-1' })),
    };
    const service = new QqbotAccountService(
      accountRepository as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      toolsService,
      undefined,
      {
        get: jest.fn((key: string) =>
          key === 'QQBOT_ACCOUNT_SECRET_KEY' ? 'unit-secret' : '',
        ),
      } as any,
      {
        decryptPassword: jest.fn().mockReturnValue(' qq-login-password '),
      } as any,
    );

    await service.save({
      encryptedLoginPassword: 'encrypted-payload',
      selfId: '1914728559',
    });

    const payload = accountRepository.create.mock.calls[0][0];
    expect(
      toolsService.decryptSecretText(
        payload.napcatLoginPasswordSecret,
        'unit-secret',
      ),
    ).toBe(' qq-login-password ');
  });

  it('does not update NapCat login password when edit leaves the password blank', async () => {
    const accountRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'account-1' }),
      update: jest.fn(),
    };
    const service = new QqbotAccountService(
      accountRepository as any,
      { update: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      new ToolsService(),
    );

    await service.update({
      id: 'account-1',
      name: 'Mirror',
      selfId: '1914728559',
    });

    expect(accountRepository.update).toHaveBeenCalledWith(
      { id: 'account-1' },
      expect.not.objectContaining({
        encryptedLoginPassword: expect.anything(),
        napcatLoginPasswordSecret: expect.anything(),
      }),
    );
  });

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

  it('separates OneBot, container, WebUI and QQ login status for offline accounts', async () => {
    const account = {
      connectStatus: 'offline',
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
      lastCheckedAt: new Date('2026-06-11T02:00:00.000Z'),
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
      inspectRuntimeStatus: jest.fn().mockResolvedValue({
        checkedAt: new Date('2026-06-12T12:00:00.000Z'),
        containerOnline: true,
        lastError: '二维码已过期，请刷新',
        qqLoginMessage: '二维码已过期，请刷新',
        qqLoginStatus: 'qrcode_expired',
        webuiOnline: true,
      }),
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
          addSelect: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([container]),
          where: jest.fn().mockReturnThis(),
        })),
      } as any,
      napcatContainerService as any,
      new ToolsService(),
    );

    const page = await service.page({});

    expect(napcatContainerService.inspectRuntimeStatus).toHaveBeenCalledWith(
      container,
    );
    expect(accountRepository.update).not.toHaveBeenCalled();
    expect(page.list[0]).toEqual(
      expect.objectContaining({
        connectStatus: 'offline',
        napcat: expect.objectContaining({
          containerOnline: true,
          oneBotOnline: false,
          qqLoginMessage: '二维码已过期，请刷新',
          qqLoginStatus: 'qrcode_expired',
          webuiOnline: true,
        }),
      }),
    );
  });

  it('does not expose WebUI errors as QQ login messages in cached runtime status', async () => {
    const checkedAt = new Date();
    const account = {
      connectStatus: 'offline',
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
      lastLoginAt: checkedAt,
    };
    const container = {
      id: 'container-1',
      isDeleted: false,
      lastCheckedAt: checkedAt,
      lastError: 'NapCat WebUI 配置缺失',
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
          addSelect: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([container]),
          where: jest.fn().mockReturnThis(),
        })),
      } as any,
      {} as any,
      new ToolsService(),
    );

    const page = await service.page({});

    expect(page.list[0].napcat).toEqual(
      expect.objectContaining({
        containerOnline: true,
        lastError: 'NapCat WebUI 配置缺失',
        qqLoginMessage: null,
        qqLoginStatus: 'unknown',
        webuiOnline: null,
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
      publishSystemNotice: jest.fn().mockResolvedValue(undefined),
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

  it('lets watchdog auto-login before marking an account offline', async () => {
    const toolsService = new ToolsService();
    const account = {
      connectStatus: 'online',
      enabled: true,
      id: 'account-1',
      isDeleted: false,
      lastError: null,
      name: '主账号',
      napcatLoginPasswordSecret: toolsService.encryptSecretText(
        'qq-login-password',
        'unit-secret',
      ),
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
    const accountRepository = {
      createQueryBuilder: jest.fn(() => ({
        addSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([account]),
        where: jest.fn().mockReturnThis(),
      })),
      update: jest.fn(),
    };
    const napcatContainerService = {
      detectRuntimeOffline: jest
        .fn()
        .mockResolvedValue('NapCat 账号状态变更为离线'),
      tryAutoLogin: jest.fn().mockResolvedValue({
        method: 'password',
        success: true,
      }),
    };
    const systemNoticePublisher = {
      publishSystemNotice: jest.fn().mockResolvedValue(undefined),
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
      toolsService,
      systemNoticePublisher as any,
      {
        get: jest.fn((key: string) =>
          key === 'QQBOT_ACCOUNT_SECRET_KEY' ? 'unit-secret' : '',
        ),
      } as any,
    );

    const result = await service.runOfflineWatchdog();

    expect(result).toEqual({ checked: 1 });
    expect(napcatContainerService.tryAutoLogin).toHaveBeenCalledWith(
      container,
      {
        loginPassword: 'qq-login-password',
        selfId: '1914728559',
      },
    );
    expect(accountRepository.update).toHaveBeenCalledWith(
      { selfId: '1914728559' },
      expect.objectContaining({
        clientRole: 'Universal',
        connectStatus: 'online',
        lastConnectedAt: expect.any(Date),
        lastError: null,
      }),
    );
    expect(systemNoticePublisher.publishSystemNotice).not.toHaveBeenCalled();
  });

  it('records a cleanup failure when watchdog auto-login leaves runtime password env uncertain', async () => {
    const toolsService = new ToolsService();
    const account = {
      connectStatus: 'online',
      enabled: true,
      id: 'account-1',
      isDeleted: false,
      lastError: null,
      name: '主账号',
      napcatLoginPasswordSecret: toolsService.encryptSecretText(
        'qq-login-password',
        'unit-secret',
      ),
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
    const accountRepository = {
      createQueryBuilder: jest.fn(() => ({
        addSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([account]),
        where: jest.fn().mockReturnThis(),
      })),
      update: jest.fn(),
    };
    const napcatContainerService = {
      detectRuntimeOffline: jest
        .fn()
        .mockResolvedValue('NapCat 账号状态变更为离线'),
      tryAutoLogin: jest.fn().mockResolvedValue({
        cleanupFailed: true,
        success: false,
      }),
    };
    const systemNoticePublisher = {
      publishSystemNotice: jest.fn().mockResolvedValue(undefined),
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
      toolsService,
      systemNoticePublisher as any,
      {
        get: jest.fn((key: string) =>
          key === 'QQBOT_ACCOUNT_SECRET_KEY' ? 'unit-secret' : '',
        ),
      } as any,
    );

    await service.runOfflineWatchdog();

    expect(accountRepository.update).toHaveBeenCalledTimes(1);
    expect(accountRepository.update).toHaveBeenCalledWith(
      { selfId: '1914728559' },
      {
        connectStatus: 'offline',
        lastError: 'NapCat 自动登录后运行态密码清理失败，请手动更新登录',
      },
    );
    expect(systemNoticePublisher.publishSystemNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'NapCat 自动登录后运行态密码清理失败，请手动更新登录',
        eventType: 'qqbot.account.offline',
        severity: 'error',
        title: 'QQBot 账号已下线：1914728559',
      }),
    );
    expect(
      JSON.stringify(accountRepository.update.mock.calls),
    ).not.toContain('NapCat 账号状态变更为离线');
  });
});

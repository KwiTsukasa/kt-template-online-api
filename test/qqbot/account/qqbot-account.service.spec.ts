import { ToolsService } from '@/common';
import type { QqbotAccountNapcatRuntimePort } from '@/modules/qqbot/core/application/account/qqbot-account-napcat-runtime.port';
import { QqbotAccountService } from '@/modules/qqbot/core/application/account/qqbot-account.service';
import { QqbotNapcatAccountRuntimeService } from '@/modules/qqbot/napcat/application/account-runtime/qqbot-napcat-account-runtime.service';

/**
 * 创建 测试断言对象或配置。
 * @param input - input 输入；使用 `accountRepository`、`accountAbilityRepository`、`toolsService`、`napcatRuntime` 字段生成结果。
 */
const createAccountService = (input: {
  accountAbilityRepository?: any;
  accountRepository: any;
  configService?: any;
  napcatRuntime?: QqbotAccountNapcatRuntimePort;
  passwordCryptoService?: any;
  systemNoticePublisher?: any;
  toolsService?: ToolsService;
}) =>
  new QqbotAccountService(
    input.accountRepository,
    input.accountAbilityRepository || {},
    input.toolsService || new ToolsService(),
    input.napcatRuntime,
    input.systemNoticePublisher,
    input.configService,
    input.passwordCryptoService,
  );

/**
 * 创建 测试断言对象或配置。
 * @param input - input 输入；使用 `bindingRepository`、`containerRepository`、`containerService`、`toolsService` 字段生成结果。
 */
const createNapcatRuntime = (input: {
  bindingRepository: any;
  containerRepository: any;
  containerService: any;
  toolsService?: ToolsService;
}) =>
  new QqbotNapcatAccountRuntimeService(
    input.bindingRepository,
    input.containerRepository,
    input.containerService,
    input.toolsService || new ToolsService(),
  );

/**
 * 创建 测试断言对象或配置。
 * @param input - input 输入；使用 `toolsService`、`accountRepository`、`configService`、`bindingRepository` 字段生成结果。
 */
const createAccountServiceWithNapcatRuntime = (input: {
  accountRepository: any;
  bindingRepository: any;
  configService?: any;
  containerRepository: any;
  containerService: any;
  passwordCryptoService?: any;
  systemNoticePublisher?: any;
  toolsService?: ToolsService;
}) => {
  const toolsService = input.toolsService || new ToolsService();
  return createAccountService({
    accountRepository: input.accountRepository,
    configService: input.configService,
    napcatRuntime: createNapcatRuntime({
      bindingRepository: input.bindingRepository,
      containerRepository: input.containerRepository,
      containerService: input.containerService,
      toolsService,
    }),
    passwordCryptoService: input.passwordCryptoService,
    systemNoticePublisher: input.systemNoticePublisher,
    toolsService,
  });
};

describe('QqbotAccountService', () => {
  it('stores NapCat login password as encrypted secret and never persists the transport field', async () => {
    const toolsService = new ToolsService();
    const accountRepository = {
      create: jest.fn((input) => input),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (input) => ({ ...input, id: 'account-1' })),
    };
    const service = createAccountService({
      accountRepository,
      configService: {
        get: jest.fn((key: string) =>
          key === 'QQBOT_ACCOUNT_SECRET_KEY' ? 'unit-secret' : '',
        ),
      },
      passwordCryptoService: {
        decryptPassword: jest.fn().mockReturnValue('qq-login-password'),
      },
      toolsService,
    });

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
    const service = createAccountService({
      accountRepository,
      configService: {
        get: jest.fn().mockReturnValue(''),
      },
      passwordCryptoService: {
        decryptPassword: jest.fn().mockReturnValue('qq-login-password'),
      },
    });

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
    const service = createAccountService({
      accountRepository,
      configService: {
        get: jest.fn((key: string) =>
          key === 'ADMIN_TOKEN_SECRET' ? 'change-me' : '',
        ),
      },
      passwordCryptoService: {
        decryptPassword: jest.fn().mockReturnValue('qq-login-password'),
      },
    });

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
    const service = createAccountService({
      accountRepository,
      configService: {
        get: jest.fn((key: string) =>
          key === 'QQBOT_ACCOUNT_SECRET_KEY' ? 'unit-secret' : '',
        ),
      },
      passwordCryptoService: {
        decryptPassword: jest.fn().mockReturnValue(' qq-login-password '),
      },
      toolsService,
    });

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
    const service = createAccountService({
      accountAbilityRepository: { update: jest.fn() },
      accountRepository,
    });

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
    const service = createAccountService({ accountRepository });

    await service.markOffline('1914728559');

    expect(accountRepository.update).toHaveBeenCalledWith(
      { selfId: '1914728559' },
      {
        connectStatus: 'offline',
      },
    );
  });

  it('preserves QQ login error when OneBot connection comes online', async () => {
    const accountRepository = {
      update: jest.fn(),
    };
    const service = createAccountService({ accountRepository });

    await service.markOnline('1914728559', 'Universal');

    const updatePayload = accountRepository.update.mock.calls[0][1];
    expect(updatePayload).toEqual(
      expect.objectContaining({
        clientRole: 'Universal',
        connectStatus: 'online',
        lastConnectedAt: expect.any(Date),
      }),
    );
    expect(updatePayload).not.toHaveProperty('lastError');
  });

  it('clears QQ login error only when online state is explicitly confirmed', async () => {
    const accountRepository = {
      update: jest.fn(),
    };
    const service = createAccountService({ accountRepository });

    await service.markOnline('1914728559', 'Universal', null);

    expect(accountRepository.update).toHaveBeenCalledWith(
      { selfId: '1914728559' },
      expect.objectContaining({
        clientRole: 'Universal',
        connectStatus: 'online',
        lastConnectedAt: expect.any(Date),
        lastError: null,
      }),
    );
  });

  it('truncates offline reason before writing lastError column', async () => {
    const accountRepository = {
      update: jest.fn(),
    };
    const service = createAccountService({ accountRepository });

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
    /**
     * 创建 账号。
     */
    const createAccountBuilder = () => ({
      andWhere: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[account], 1]),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    });
    /**
     * 创建 账号绑定。
     */
    const createBindingBuilder = () => ({
      addOrderBy: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([binding]),
      orderBy: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    });
    /**
     * 创建 容器。
     */
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
    const service = createAccountServiceWithNapcatRuntime({
      accountRepository,
      bindingRepository: { createQueryBuilder: jest.fn(createBindingBuilder) },
      containerRepository: {
        createQueryBuilder: jest.fn(createContainerBuilder),
      },
      containerService: napcatContainerService,
      systemNoticePublisher,
    });

    const page = await service.page({});

    expect(accountRepository.update).toHaveBeenCalledWith(
      { selfId: '1914728559' },
      {
        lastError: 'NapCat 账号状态变更为离线',
      },
    );
    expect(page.list[0]).toEqual(
      expect.objectContaining({
        connectStatus: 'online',
        lastError: 'NapCat 账号状态变更为离线',
        napcat: expect.objectContaining({
          oneBotOnline: true,
          qqLoginStatus: 'offline',
        }),
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
    const service = createAccountServiceWithNapcatRuntime({
      accountRepository,
      bindingRepository: {
        createQueryBuilder: jest.fn(() => ({
          addOrderBy: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([binding]),
          orderBy: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
        })),
      },
      containerRepository: {
        createQueryBuilder: jest.fn(() => ({
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([container]),
          where: jest.fn().mockReturnThis(),
        })),
      },
      containerService: napcatContainerService,
    });

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
    const service = createAccountServiceWithNapcatRuntime({
      accountRepository,
      bindingRepository: {
        createQueryBuilder: jest.fn(() => ({
          addOrderBy: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([binding]),
          orderBy: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
        })),
      },
      containerRepository: {
        createQueryBuilder: jest.fn(() => ({
          addSelect: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([container]),
          where: jest.fn().mockReturnThis(),
        })),
      },
      containerService: napcatContainerService,
    });

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
    const service = createAccountServiceWithNapcatRuntime({
      accountRepository,
      bindingRepository: {
        createQueryBuilder: jest.fn(() => ({
          addOrderBy: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([binding]),
          orderBy: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
        })),
      },
      containerRepository: {
        createQueryBuilder: jest.fn(() => ({
          addSelect: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([container]),
          where: jest.fn().mockReturnThis(),
        })),
      },
      containerService: {},
    });

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

  it('does not derive QQ login online status from OneBot heartbeat cache', async () => {
    const checkedAt = new Date();
    const account = {
      connectStatus: 'online',
      enabled: true,
      id: 'account-1',
      isDeleted: false,
      lastError: null,
      lastHeartbeatAt: new Date(),
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
    const service = createAccountServiceWithNapcatRuntime({
      accountRepository,
      bindingRepository: {
        createQueryBuilder: jest.fn(() => ({
          addOrderBy: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([binding]),
          orderBy: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
        })),
      },
      containerRepository: {
        createQueryBuilder: jest.fn(() => ({
          addSelect: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([container]),
          where: jest.fn().mockReturnThis(),
        })),
      },
      containerService: {},
    });

    const page = await service.page({});

    expect(page.list[0].napcat).toEqual(
      expect.objectContaining({
        oneBotOnline: true,
        qqLoginStatus: 'unknown',
        webuiOnline: null,
      }),
    );
  });

  it('ignores cached NapCat offline reason after the account reconnects', async () => {
    const now = Date.now();
    const checkedAt = new Date(now - 10_000);
    const account = {
      connectStatus: 'online',
      enabled: true,
      id: 'account-1',
      isDeleted: false,
      lastConnectedAt: new Date(now - 5_000),
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
    const service = createAccountServiceWithNapcatRuntime({
      accountRepository,
      bindingRepository: {
        createQueryBuilder: jest.fn(() => ({
          addOrderBy: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([binding]),
          orderBy: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
        })),
      },
      containerRepository: {
        createQueryBuilder: jest.fn(() => ({
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([container]),
          where: jest.fn().mockReturnThis(),
        })),
      },
      containerService: napcatContainerService,
      systemNoticePublisher,
    });

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

  it('does not let heartbeat bypass stale NapCat offline inspection', async () => {
    const checkedAt = new Date(Date.now() - 60_000);
    const account = {
      connectStatus: 'online',
      enabled: true,
      id: 'account-1',
      isDeleted: false,
      lastConnectedAt: new Date(Date.now() - 120_000),
      lastError: null,
      lastHeartbeatAt: new Date(),
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
        checkedAt: new Date(),
        containerOnline: true,
        lastError: '账号状态变更为离线',
        qqLoginMessage: '账号状态变更为离线',
        qqLoginStatus: 'offline',
        webuiOnline: true,
      }),
    };
    const service = createAccountServiceWithNapcatRuntime({
      accountRepository,
      bindingRepository: {
        createQueryBuilder: jest.fn(() => ({
          addOrderBy: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([binding]),
          orderBy: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
        })),
      },
      containerRepository: {
        createQueryBuilder: jest.fn(() => ({
          addSelect: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([container]),
          where: jest.fn().mockReturnThis(),
        })),
      },
      containerService: napcatContainerService,
    });

    const page = await service.page({});

    expect(napcatContainerService.inspectRuntimeStatus).toHaveBeenCalledWith(
      container,
    );
    expect(accountRepository.update).toHaveBeenCalledWith(
      { selfId: '1914728559' },
      {
        lastError: '账号状态变更为离线',
      },
    );
    expect(page.list[0]).toEqual(
      expect.objectContaining({
        connectStatus: 'online',
        lastError: '账号状态变更为离线',
        napcat: expect.objectContaining({
          oneBotOnline: true,
          qqLoginStatus: 'offline',
        }),
      }),
    );
  });

  it('clears previous QQ login error when NapCat WebUI confirms QQ is online', async () => {
    const checkedAt = new Date(Date.now() - 60_000);
    const account = {
      connectStatus: 'online',
      enabled: true,
      id: 'account-1',
      isDeleted: false,
      lastConnectedAt: new Date(Date.now() - 120_000),
      lastError: '账号状态变更为离线',
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
      inspectRuntimeStatus: jest.fn().mockResolvedValue({
        checkedAt: new Date(),
        containerOnline: true,
        lastError: null,
        qqLoginMessage: null,
        qqLoginStatus: 'online',
        webuiOnline: true,
      }),
    };
    const service = createAccountServiceWithNapcatRuntime({
      accountRepository,
      bindingRepository: {
        createQueryBuilder: jest.fn(() => ({
          addOrderBy: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([binding]),
          orderBy: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
        })),
      },
      containerRepository: {
        createQueryBuilder: jest.fn(() => ({
          addSelect: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([container]),
          where: jest.fn().mockReturnThis(),
        })),
      },
      containerService: napcatContainerService,
    });

    const page = await service.page({});

    expect(accountRepository.update).toHaveBeenCalledWith(
      { selfId: '1914728559' },
      { lastError: null },
    );
    expect(page.list[0]).toEqual(
      expect.objectContaining({
        lastError: null,
        napcat: expect.objectContaining({
          qqLoginStatus: 'online',
        }),
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
    const service = createAccountServiceWithNapcatRuntime({
      accountRepository,
      bindingRepository: {
        createQueryBuilder: jest.fn(() => ({
          addOrderBy: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([binding]),
          orderBy: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
        })),
      },
      configService: {
        get: jest.fn((key: string) =>
          key === 'QQBOT_ACCOUNT_SECRET_KEY' ? 'unit-secret' : '',
        ),
      },
      containerRepository: {
        createQueryBuilder: jest.fn(() => ({
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([container]),
          where: jest.fn().mockReturnThis(),
        })),
      },
      containerService: napcatContainerService,
      systemNoticePublisher,
      toolsService,
    });

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
    const service = createAccountServiceWithNapcatRuntime({
      accountRepository,
      bindingRepository: {
        createQueryBuilder: jest.fn(() => ({
          addOrderBy: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([binding]),
          orderBy: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
        })),
      },
      configService: {
        get: jest.fn((key: string) =>
          key === 'QQBOT_ACCOUNT_SECRET_KEY' ? 'unit-secret' : '',
        ),
      },
      containerRepository: {
        createQueryBuilder: jest.fn(() => ({
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([container]),
          where: jest.fn().mockReturnThis(),
        })),
      },
      containerService: napcatContainerService,
      systemNoticePublisher,
      toolsService,
    });

    await service.runOfflineWatchdog();

    expect(accountRepository.update).toHaveBeenCalledTimes(1);
    expect(accountRepository.update).toHaveBeenCalledWith(
      { selfId: '1914728559' },
      {
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
    expect(JSON.stringify(accountRepository.update.mock.calls)).not.toContain(
      'NapCat 账号状态变更为离线',
    );
  });
});

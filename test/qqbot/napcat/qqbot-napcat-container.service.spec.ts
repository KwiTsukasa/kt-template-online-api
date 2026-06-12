jest.mock('@/common', () => {
  const actualCommon = jest.requireActual('@/common');
  return {
    FormatDateTime: actualCommon.FormatDateTime,
    ToolsService: actualCommon.ToolsService,
    ensureSnowflakeId: jest.fn(),
    formatKtDateTime: actualCommon.formatKtDateTime,
    setDictDecodeCache: jest.fn(),
    throwVbenError: (message: string) => {
      throw new Error(message);
    },
  };
});

import { ConfigService } from '@nestjs/config';
import { ToolsService } from '@/common';
import { QqbotNapcatContainerService } from '@/qqbot/napcat/qqbot-napcat-container.service';

describe('QqbotNapcatContainerService', () => {
  it('removes previous account containers when binding a new primary container', async () => {
    const bindingRepository = {
      create: jest.fn((input) => input),
      createQueryBuilder: jest.fn(() => ({
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
        where: jest.fn().mockReturnThis(),
      })),
      find: jest.fn().mockResolvedValue([
        {
          accountId: 'account-1',
          containerId: 'container-old',
          id: 'binding-old',
          isDeleted: false,
        },
      ]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(),
      update: jest.fn(),
    };
    const containerRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'container-old',
        isDeleted: false,
        name: 'napcat-old',
      }),
      update: jest.fn(),
    };
    const service = new QqbotNapcatContainerService(
      { get: jest.fn().mockReturnValue('') } as unknown as ConfigService,
      containerRepository as any,
      bindingRepository as any,
      new ToolsService(),
    );
    jest.spyOn(service as any, 'getManagedMode').mockReturnValue('');

    await service.bindAccount('account-1', 'container-new');

    expect(bindingRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account-1',
        bindStatus: 'bound',
        containerId: 'container-new',
        isPrimary: true,
      }),
    );
    expect(containerRepository.update).toHaveBeenCalledWith(
      { id: 'container-old' },
      expect.objectContaining({
        isDeleted: true,
        status: 'stopped',
      }),
    );
    expect(bindingRepository.update).toHaveBeenCalledWith(
      { id: 'binding-old' },
      expect.objectContaining({
        bindStatus: 'disabled',
        isDeleted: true,
        isPrimary: false,
      }),
    );
  });

  it('uses the latest NapCat account status line as runtime offline truth', () => {
    const service = new QqbotNapcatContainerService(
      { get: jest.fn() } as any,
      {} as any,
      {} as any,
      new ToolsService(),
    ) as any;

    expect(
      service.extractLoginState(`
06-11 08:39:19 [info] Mirror | 账号状态变更为离线
06-11 08:41:19 [info] Mirror | 账号状态变更为在线
`).offlineReason,
    ).toBeNull();
  });

  it('treats isOnline false as an offline runtime state', () => {
    const service = new QqbotNapcatContainerService(
      { get: jest.fn() } as any,
      {} as any,
      {} as any,
      new ToolsService(),
    ) as any;

    const result = service.extractLoginState(`
06-11 08:39:19 [info] Mirror | {"isOnline": false}
`);

    expect(result).toEqual({
      offlineReason: 'NapCat 账号状态变更为离线',
      state: 'offline',
    });
  });

  it('clears stale offline error when the latest NapCat account status is online', async () => {
    const containerRepository = {
      update: jest.fn(),
    };
    const service = new QqbotNapcatContainerService(
      {
        get: jest.fn((key: string) => {
          const values: Record<string, string> = {
            QQBOT_NAPCAT_CONTAINER_MODE: 'ssh',
            QQBOT_NAPCAT_SSH_TARGET: 'nas',
          };
          return values[key] || '';
        }),
      } as any,
      containerRepository as any,
      {} as any,
      new ToolsService(),
    ) as any;
    service.runProcess = jest.fn().mockResolvedValue({
      stderr: '',
      stdout: `
06-11 08:39:19 [info] Mirror | 账号状态变更为离线
06-11 08:41:19 [info] Mirror | 账号状态变更为在线
`,
    });

    const reason = await service.detectRuntimeOffline({
      id: 'container-1',
      name: 'kt-qqbot-napcat-1914728559',
    });

    expect(reason).toBeNull();
    expect(containerRepository.update).toHaveBeenCalledWith(
      { id: 'container-1' },
      expect.objectContaining({
        lastCheckedAt: expect.any(Date),
        lastError: null,
      }),
    );
  });

  it('extracts the latest NapCat offline reason from container logs', () => {
    const service = new QqbotNapcatContainerService(
      { get: jest.fn() } as any,
      {} as any,
      {} as any,
      new ToolsService(),
    ) as any;

    expect(
      service.extractLoginState(`
06-11 08:39:19 [info] Mirror | [KickedOffLine] [下线通知] 您的账号已在另一台终端登录
06-11 08:40:49 [info] Mirror | 账号状态变更为离线
`).offlineReason,
    ).toBe('账号状态变更为离线');
  });

  it('uses a short timeout for runtime offline log detection', async () => {
    const containerRepository = {
      update: jest.fn(),
    };
    const service = new QqbotNapcatContainerService(
      {
        get: jest.fn((key: string) => {
          const values: Record<string, string> = {
            QQBOT_NAPCAT_CONTAINER_MODE: 'ssh',
            QQBOT_NAPCAT_RUNTIME_CHECK_TIMEOUT_MS: '5000',
            QQBOT_NAPCAT_SSH_TARGET: 'nas',
          };
          return values[key] || '';
        }),
      } as any,
      containerRepository as any,
      {} as any,
      new ToolsService(),
    ) as any;
    service.runProcess = jest.fn().mockResolvedValue({
      stderr: '',
      stdout: '06-11 08:39:19 [info] Mirror | 账号状态变更为离线',
    });

    const reason = await service.detectRuntimeOffline({
      id: 'container-1',
      name: 'kt-qqbot-napcat-1914728559',
    });

    expect(reason).toBe('账号状态变更为离线');
    expect(service.runProcess).toHaveBeenCalledWith(
      'ssh',
      expect.any(Array),
      expect.any(String),
      undefined,
      5000,
    );
  });

  it('truncates runtime offline reason before writing container lastError', async () => {
    const containerRepository = {
      update: jest.fn(),
    };
    const service = new QqbotNapcatContainerService(
      {
        get: jest.fn((key: string) => {
          const values: Record<string, string> = {
            QQBOT_NAPCAT_CONTAINER_MODE: 'ssh',
            QQBOT_NAPCAT_SSH_TARGET: 'nas',
          };
          return values[key] || '';
        }),
      } as any,
      containerRepository as any,
      {} as any,
      new ToolsService(),
    ) as any;
    service.runProcess = jest.fn().mockResolvedValue({
      stderr: '',
      stdout: `06-11 08:39:19 [info] Mirror | [KickedOffLine] [下线通知] ${'错误'.repeat(300)}`,
    });

    await service.detectRuntimeOffline({
      id: 'container-1',
      name: 'kt-qqbot-napcat-1914728559',
    });

    expect(containerRepository.update).toHaveBeenCalledWith(
      { id: 'container-1' },
      expect.objectContaining({
        lastError: `${'错误'.repeat(248)}错...`,
      }),
    );
  });

  it('truncates runtime check errors before writing container lastError', async () => {
    const containerRepository = {
      update: jest.fn(),
    };
    const service = new QqbotNapcatContainerService(
      {
        get: jest.fn((key: string) => {
          const values: Record<string, string> = {
            QQBOT_NAPCAT_CONTAINER_MODE: 'ssh',
            QQBOT_NAPCAT_SSH_TARGET: 'nas',
          };
          return values[key] || '';
        }),
      } as any,
      containerRepository as any,
      {} as any,
      new ToolsService(),
    ) as any;
    service.runProcess = jest
      .fn()
      .mockRejectedValue(new Error('错误'.repeat(300)));

    await service.detectRuntimeOffline({
      id: 'container-1',
      name: 'kt-qqbot-napcat-1914728559',
    });

    expect(containerRepository.update).toHaveBeenCalledWith(
      { id: 'container-1' },
      expect.objectContaining({
        lastError: `${'错误'.repeat(248)}错...`,
      }),
    );
  });

  it('injects ACCOUNT env (NapCat -q quick login) only when a selfId is provided', () => {
    const service = new QqbotNapcatContainerService(
      { get: jest.fn().mockReturnValue('') } as any,
      {} as any,
      {} as any,
      new ToolsService(),
    ) as any;

    const baseInput = {
      dataDir: '/vol1/docker/kt-qqbot/napcat-instances/kt-qqbot-napcat-test',
      image: 'mlikiowa/napcat-docker:latest',
      name: 'kt-qqbot-napcat-test',
      port: 6100,
      reverseWsUrl: 'ws://127.0.0.1:48085/qqbot/onebot/reverse',
      token: 'token-test',
    };

    const withAccount = service.buildRemoteCreateScript({
      ...baseInput,
      account: '2354598417',
    });
    expect(withAccount).toContain("ACCOUNT='2354598417'");
    expect(withAccount).toContain('-e ACCOUNT="$ACCOUNT"');

    const withoutAccount = service.buildRemoteCreateScript(baseInput);
    expect(withoutAccount).not.toContain('-e ACCOUNT="$ACCOUNT"');
    expect(withoutAccount).not.toMatch(/^ACCOUNT=/m);
  });

  it('skips docker pull when recreating in place for quick login', () => {
    const service = new QqbotNapcatContainerService(
      { get: jest.fn().mockReturnValue('') } as any,
      {} as any,
      {} as any,
      new ToolsService(),
    ) as any;

    const baseInput = {
      dataDir: '/vol1/docker/kt-qqbot/napcat-instances/kt-qqbot-napcat-test',
      image: 'mlikiowa/napcat-docker:latest',
      name: 'kt-qqbot-napcat-test',
      port: 6100,
      reverseWsUrl: 'ws://127.0.0.1:48085/qqbot/onebot/reverse',
      token: 'token-test',
    };

    expect(service.buildRemoteCreateScript(baseInput)).toContain('docker pull');
    expect(
      service.buildRemoteCreateScript({ ...baseInput, skipPull: true }),
    ).not.toContain('docker pull');
  });

  it('skips quick-login recreate when the container already carries ACCOUNT', async () => {
    const containerRepository = {
      createQueryBuilder: jest.fn(() => ({
        addSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({
          dataDir: '/vol1/docker/kt-qqbot/napcat-instances/kt-qqbot-napcat-x',
          id: 'container-1',
          image: 'mlikiowa/napcat-docker:latest',
          name: 'kt-qqbot-napcat-x',
          reverseWsUrl: 'ws://127.0.0.1:48085/qqbot/onebot/reverse',
          webuiPort: 6100,
          webuiToken: 'token-x',
        }),
        where: jest.fn().mockReturnThis(),
      })),
      update: jest.fn(),
    };
    const service = new QqbotNapcatContainerService(
      {
        get: jest.fn((key: string) =>
          key === 'QQBOT_NAPCAT_CONTAINER_MODE' ? 'ssh' : '',
        ),
      } as any,
      containerRepository as any,
      {} as any,
      new ToolsService(),
    ) as any;
    service.runProcess = jest
      .fn()
      .mockResolvedValue({ stderr: '', stdout: 'ACCOUNT=2354598417\nPATH=/x' });

    const recreated = await service.ensureRuntimeQuickLogin(
      { id: 'container-1', name: 'kt-qqbot-napcat-x' },
      '2354598417',
    );

    expect(recreated).toBe(false);
    // 仅做了 inspect 检查，没有触发任何重建（rm/run）。
    expect(service.runProcess).toHaveBeenCalledTimes(1);
    expect(containerRepository.update).not.toHaveBeenCalled();
  });

  it('requires an explicit NapCat image when creating a managed container', async () => {
    const containerRepository = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(),
    };
    const service = new QqbotNapcatContainerService(
      {
        get: jest.fn((key: string) => {
          const values: Record<string, string> = {
            QQBOT_NAPCAT_CONTAINER_MODE: 'ssh',
            QQBOT_NAPCAT_SSH_TARGET: 'nas',
          };
          return values[key] || '';
        }),
      } as any,
      containerRepository as any,
      {} as any,
      new ToolsService(),
    ) as any;

    await expect(service.createManagedContainer('1914728559')).rejects.toThrow(
      'NapCat 镜像未配置，请先设置 QQBOT_NAPCAT_IMAGE',
    );
    expect(containerRepository.save).not.toHaveBeenCalled();
  });
});

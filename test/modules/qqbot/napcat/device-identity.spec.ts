import { getMetadataArgsStorage } from 'typeorm';
import { ToolsService } from '@/common';
import {
  NapcatAccountBinding,
  NapcatContainer,
  NapcatDeviceIdentity,
  NapcatDeviceIdentityService,
  NAPCAT_RUNTIME_DOMAIN_CONTRACT,
  NAPCAT_RUNTIME_ENTITIES,
} from '../../../../src/modules/qqbot/napcat';
import { toNapcatDockerDeviceOptions } from '../../../../src/modules/qqbot/napcat/infrastructure/integration/container/napcat-docker-device-options';
import { QqbotNapcatContainerService } from '../../../../src/modules/qqbot/napcat/infrastructure/integration/container/qqbot-napcat-container.service';
import {
  hasPhysicalOuiMacPrefix,
  isRejectedVirtualMacPrefix,
} from '../../../../src/modules/qqbot/napcat/domain/runtime/napcat-physical-oui-catalog';
import { readRefactorV3SqlSchema } from '../../../helpers/sql-schema.helper';

type EntityClass = new (...args: never[]) => unknown;

/**
 * 查询 NapCat 登录运行态数据。
 * @param entity - entity 输入；驱动 `getMetadataArgsStorage()` 的 NapCat步骤。
 */
const getEntityTableName = (entity: EntityClass) => {
  return getMetadataArgsStorage().tables.find(
    (table) => table.target === entity,
  )?.name;
};

/**
 * 查询 NapCat 登录运行态数据。
 * @param entity - entity 输入；驱动 `getMetadataArgsStorage()` 的 NapCat步骤。
 */
const getEntityColumnNames = (entity: EntityClass) => {
  return getMetadataArgsStorage()
    .columns.filter((column) => column.target === entity)
    .map((column) => `${column.options.name || column.propertyName}`);
};

/**
 * 创建 NapCat 登录运行态对象或配置。
 */
const createIdentityRepository = () => {
  const identities = new Map<string, NapcatDeviceIdentity>();

  return {
    create: jest.fn((input: Partial<NapcatDeviceIdentity>) => ({
      ...input,
    })),
    findOne: jest.fn(
      async ({
        where,
      }: {
        where: { accountId?: string; containerId?: string };
      }) => {
        if (where.accountId) return identities.get(where.accountId) || null;
        if (where.containerId) {
          return (
            [...identities.values()].find(
              (identity) => identity.containerId === where.containerId,
            ) || null
          );
        }
        return null;
      },
    ),
    delete: jest.fn(async ({ id }: { id: string }) => {
      for (const [accountId, identity] of identities.entries()) {
        if (identity.id === id) {
          identities.delete(accountId);
          return { affected: 1 };
        }
      }
      return { affected: 0 };
    }),
    save: jest.fn(async (identity: NapcatDeviceIdentity) => {
      identities.set(identity.accountId, identity);
      return identity;
    }),
    /**
     * Seeds a persisted identity so migration tests can start from legacy Docker-style values.
     * @param identity - In-memory row keyed by account id for the repository fake.
     */
    seedIdentity: jest.fn((identity: NapcatDeviceIdentity) => {
      identities.set(identity.accountId, identity);
    }),
    update: jest.fn(
      async ({ id }: { id: string }, input: Partial<NapcatDeviceIdentity>) => {
        const current = [...identities.values()].find((item) => item.id === id);
        if (current) Object.assign(current, input);
        return { affected: current ? 1 : 0 };
      },
    ),
  };
};

/**
 * 创建 NapCat 登录运行态对象或配置。
 */
const createIdentityConfig = () =>
  ({
    get: jest.fn((key: string, defaultValue?: string) => {
      const values: Record<string, string> = {
        QQBOT_NAPCAT_CONTAINER_PREFIX: 'kt-qqbot-napcat',
        QQBOT_NAPCAT_ROOT: '/vol1/docker/kt-qqbot/napcat-instances',
      };
      return values[key] || defaultValue || '';
    }),
  }) as any;

describe('NapCat device identity persistence', () => {
  const schema = readRefactorV3SqlSchema();

  it('declares Batch 7 NapCat runtime persistence tables', () => {
    expect(NAPCAT_RUNTIME_DOMAIN_CONTRACT.tables).toEqual(
      expect.arrayContaining([
        'napcat_container',
        'napcat_device_identity',
        'napcat_account_binding',
        'napcat_login_session',
        'napcat_login_challenge',
        'napcat_runtime_cleanup',
        'napcat_runtime_profile',
        'napcat_protocol_profile',
        'napcat_session_behavior_profile',
        'napcat_login_event',
        'napcat_risk_mode',
      ]),
    );

    for (const table of NAPCAT_RUNTIME_DOMAIN_CONTRACT.tables) {
      expect(schema.hasTable(table)).toBe(true);
    }
  });

  it('maps the device identity entity to the v3 SQL schema', () => {
    expect(NAPCAT_RUNTIME_ENTITIES).toContain(NapcatDeviceIdentity);

    const tableName = getEntityTableName(NapcatDeviceIdentity);
    const columns = getEntityColumnNames(NapcatDeviceIdentity);

    expect(tableName).toBe('napcat_device_identity');
    schema.expectTableColumns(tableName || '', columns);
    expect(columns).toEqual(
      expect.arrayContaining([
        'account_id',
        'container_id',
        'data_dir',
        'hostname',
        'machine_id_path',
        'mac_address',
        'verification_status',
        'last_login_evidence',
      ]),
    );
  });

  it('maps target container and account binding entities to the v3 SQL schema', () => {
    for (const entity of [NapcatContainer, NapcatAccountBinding]) {
      expect(NAPCAT_RUNTIME_ENTITIES).toContain(entity);

      const tableName = getEntityTableName(entity);
      const columns = getEntityColumnNames(entity);

      expect(tableName).toBeTruthy();
      schema.expectTableColumns(tableName || '', columns);
    }
  });

  it('reuses data dir, hostname, machine-id path, and MAC when rebuilding the same account container', async () => {
    const repository = createIdentityRepository();
    const service = new NapcatDeviceIdentityService(
      repository as any,
      createIdentityConfig(),
    );

    const first = await service.resolveForAccount({
      accountId: 'account-10001',
      containerId: 'container-first',
      selfId: '10001',
    });
    const second = await service.resolveForAccount({
      accountId: 'account-10001',
      containerId: 'container-rebuilt',
      selfId: '10001',
    });

    expect(second.dataDir).toBe(first.dataDir);
    expect(second.hostname).toBe(first.hostname);
    expect(second.machineIdPath).toBe(first.machineIdPath);
    expect(second.macAddress).toBe(first.macAddress);
    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(repository.update).toHaveBeenCalledWith(
      { id: first.id },
      expect.objectContaining({
        containerId: 'container-rebuilt',
      }),
    );
  });

  it('generates a short QQNT-visible hostname without QQBot or container words', async () => {
    const repository = createIdentityRepository();
    const service = new NapcatDeviceIdentityService(
      repository as any,
      createIdentityConfig(),
    );

    const identity = await service.resolveForAccount({
      accountId: 'account-10001',
      containerId: 'container-first',
      selfId: '10001',
    });

    expect(identity.hostname).toMatch(/^pc-[a-f0-9]{8}$/);
    expect(identity.hostname).not.toMatch(/10001|qq|bot|napcat|docker/i);
  });

  it('generates a stable physical-OUI MAC that rejects virtual adapter prefixes', async () => {
    const repository = createIdentityRepository();
    const service = new NapcatDeviceIdentityService(
      repository as any,
      createIdentityConfig(),
    );

    const identity = await service.resolveForAccount({
      accountId: 'account-10001',
      containerId: 'container-first',
      selfId: '10001',
    });

    expect(identity.macAddress).toMatch(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/);
    expect(hasPhysicalOuiMacPrefix(identity.macAddress)).toBe(true);
    expect(isRejectedVirtualMacPrefix(identity.macAddress)).toBe(false);
    expect(identity.macStrategy).toBe('physical-oui-mac-v1');
  });

  it('records regression-repair evidence when an existing identity is realigned for QQNT', async () => {
    const repository = createIdentityRepository();
    repository.seedIdentity({
      accountId: 'account-10001',
      containerId: 'container-first',
      dataDir: '/vol1/docker/kt-qqbot/napcat-instances/kt-qqbot-napcat-10001',
      hostname: 'kt-qqbot-napcat-10001',
      id: 'identity-1',
      lastLoginEvidence: null,
      macAddress: '02:42:aa:bb:cc:dd',
      machineIdPath:
        '/vol1/docker/kt-qqbot/napcat-instances/kt-qqbot-napcat-10001/machine-id',
      verificationStatus: 'pending',
    } as NapcatDeviceIdentity);
    const service = new NapcatDeviceIdentityService(
      repository as any,
      createIdentityConfig(),
    );

    const identity = await service.resolveForAccount({
      accountId: 'account-10001',
      containerId: 'container-rebuilt',
      selfId: '10001',
    });

    expect(hasPhysicalOuiMacPrefix(identity.macAddress)).toBe(true);
    expect(isRejectedVirtualMacPrefix(identity.macAddress)).toBe(false);
    expect(identity.macAddress).not.toBe('02:42:aa:bb:cc:dd');
    expect(identity.hostname).not.toBe('kt-qqbot-napcat-10001');
    expect(identity.lastLoginEvidence).toMatchObject({
      migration: {
        fromMacAddress: '02:42:aa:bb:cc:dd',
        strategy: 'physical-oui-mac-v1',
        trigger: 'qqnt-device-name-regression-repair',
      },
    });
  });

  it('turns a persisted device identity into Docker device options', async () => {
    const repository = createIdentityRepository();
    const service = new NapcatDeviceIdentityService(
      repository as any,
      createIdentityConfig(),
    );

    const identity = await service.resolveForAccount({
      accountId: 'account-10001',
      containerId: 'container-first',
      selfId: '10001',
    });
    const dockerOptions = toNapcatDockerDeviceOptions(identity);

    expect(dockerOptions).toEqual(
      expect.objectContaining({
        dataDir: identity.dataDir,
        deviceEnvPath: `${identity.dataDir}/device.env`,
        hostname: identity.hostname,
        machineIdPath: identity.machineIdPath,
        machineInfoPath: `${identity.dataDir}/QQ/nt_qq/global/nt_data/msf/machine-info`,
        macAddress: identity.macAddress,
        macAddressHyphen: identity.macAddress.replace(/:/g, '-'),
      }),
    );
    expect(dockerOptions.runFlags).toEqual(
      expect.arrayContaining([
        '--hostname "$NAPCAT_HOSTNAME"',
        '--mac-address "$NAPCAT_MAC_ADDRESS"',
        '-v "$MACHINE_ID_PATH:/etc/machine-id:ro"',
      ]),
    );
  });

  it('applies persisted device options to the NapCat docker create script', async () => {
    const repository = createIdentityRepository();
    const service = new NapcatDeviceIdentityService(
      repository as any,
      createIdentityConfig(),
    );
    const identity = await service.resolveForAccount({
      accountId: 'account-10001',
      containerId: 'container-first',
      selfId: '10001',
    });
    const containerService = new QqbotNapcatContainerService(
      { get: jest.fn().mockReturnValue('') } as any,
      {} as any,
      {} as any,
      new ToolsService(),
    ) as any;

    const script = containerService.buildRemoteCreateScript({
      dataDir: identity.dataDir,
      deviceIdentity: toNapcatDockerDeviceOptions(identity),
      image: 'mlikiowa/napcat-docker:latest',
      name: 'kt-qqbot-napcat-10001',
      port: 6100,
      reverseWsUrl: 'ws://127.0.0.1:48085/qqbot/onebot/reverse',
      token: 'token-test',
    });

    expect(script).toContain(`NAPCAT_HOSTNAME='${identity.hostname}'`);
    expect(script).toContain(`NAPCAT_MAC_ADDRESS='${identity.macAddress}'`);
    expect(script).toContain(`MACHINE_ID_PATH='${identity.machineIdPath}'`);
    expect(script).toContain(
      `MACHINE_INFO_PATH='${identity.dataDir}/QQ/nt_qq/global/nt_data/msf/machine-info'`,
    );
    expect(script).toContain(
      `NAPCAT_MAC_HYPHEN='${identity.macAddress.replace(/:/g, '-')}'`,
    );
    expect(script).toContain('cat > "$DEVICE_ENV_PATH" <<EOF');
    expect(script).toContain('MACHINE_INFO_PATH.bak.$(date +%Y%m%d%H%M%S)');
    expect(script).toContain("printf '\\000\\000\\000\\021'");
    expect(script).toContain("tr 'A-Za-z' 'N-ZA-Mn-za-m'");
    expect(script).toContain('--hostname "$NAPCAT_HOSTNAME"');
    expect(script).toContain('--mac-address "$NAPCAT_MAC_ADDRESS"');
    expect(script).toContain('-v "$MACHINE_ID_PATH:/etc/machine-id:ro"');
    expect(script).toContain('-v "$DATA_DIR/runtime:/tmp/runtime-napcat"');
  });

  it('uses persisted device identity when preparing an account managed container', async () => {
    const identityRepository = createIdentityRepository();
    const identityService = new NapcatDeviceIdentityService(
      identityRepository as any,
      createIdentityConfig(),
    );
    const bindingRepository = {
      createQueryBuilder: jest.fn(() => ({
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
        where: jest.fn().mockReturnThis(),
      })),
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    };
    const containerRepository = {
      create: jest.fn((input) => input),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(async (input) => ({
        ...input,
        id: 'container-created',
      })),
      update: jest.fn(),
    };
    const containerService = new QqbotNapcatContainerService(
      {
        get: jest.fn((key: string, defaultValue?: string) => {
          const values: Record<string, string> = {
            QQBOT_NAPCAT_CONTAINER_MODE: 'ssh',
            QQBOT_NAPCAT_CONTAINER_PREFIX: 'kt-qqbot-napcat',
            QQBOT_NAPCAT_IMAGE: 'mlikiowa/napcat-docker:latest',
            QQBOT_NAPCAT_PORT_START: '6100',
            QQBOT_NAPCAT_ROOT: '/vol1/docker/kt-qqbot/napcat-instances',
            QQBOT_NAPCAT_SSH_TARGET: 'nas',
          };
          return values[key] || defaultValue || '';
        }),
      } as any,
      containerRepository as any,
      bindingRepository as any,
      new ToolsService(),
      identityService,
    ) as any;
    containerService.runProcess = jest.fn().mockResolvedValue({
      stderr: '',
      stdout: '',
    });

    const runtime = await containerService.prepareAccountContainer({
      id: 'account-10001',
      selfId: '10001',
    });

    expect(runtime).toEqual(
      expect.objectContaining({
        dataDir: '/vol1/docker/kt-qqbot/napcat-instances/kt-qqbot-napcat-10001',
        id: 'container-created',
        name: 'kt-qqbot-napcat-10001',
      }),
    );
    expect(identityRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: expect.any(String) }),
      expect.objectContaining({ containerId: 'container-created' }),
    );
    expect(containerRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        dataDir: '/vol1/docker/kt-qqbot/napcat-instances/kt-qqbot-napcat-10001',
      }),
    );
    const createScript = containerService.runProcess.mock.calls[0][2];
    expect(bindingRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account-10001',
        containerId: 'container-created',
      }),
      expect.objectContaining({
        deviceIdentityId: expect.any(String),
      }),
    );
    expect(createScript).toContain('--hostname "$NAPCAT_HOSTNAME"');
    expect(createScript).toContain('--mac-address "$NAPCAT_MAC_ADDRESS"');
    expect(createScript).toContain('-v "$MACHINE_ID_PATH:/etc/machine-id:ro"');
    expect(createScript).toContain(
      '-v "$DATA_DIR/runtime:/tmp/runtime-napcat"',
    );
  });

  it('reserves create-login containers with a provisional device identity before remote startup', async () => {
    const identityRepository = createIdentityRepository();
    const identityService = new NapcatDeviceIdentityService(
      identityRepository as any,
      createIdentityConfig(),
    );
    let savedContainer: any;
    const queryBuilder = {
      addSelect: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn(async () => savedContainer),
      where: jest.fn().mockReturnThis(),
    };
    const containerRepository = {
      create: jest.fn((input) => ({ ...input })),
      createQueryBuilder: jest.fn(() => queryBuilder),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(async (input) => {
        savedContainer = { ...input };
        return savedContainer;
      }),
      update: jest.fn(async ({ id }: { id: string }, input) => {
        if (savedContainer?.id === id) Object.assign(savedContainer, input);
        return { affected: savedContainer?.id === id ? 1 : 0 };
      }),
    };
    const bindingRepository = {
      update: jest.fn(),
    };
    const containerService = new QqbotNapcatContainerService(
      {
        get: jest.fn((key: string, defaultValue?: string) => {
          const values: Record<string, string> = {
            QQBOT_NAPCAT_CONTAINER_MODE: 'ssh',
            QQBOT_NAPCAT_CONTAINER_PREFIX: 'kt-qqbot-napcat',
            QQBOT_NAPCAT_IMAGE: 'kt-napcat-desktop-cn@sha256:profiledigest',
            QQBOT_NAPCAT_PORT_START: '6100',
            QQBOT_NAPCAT_ROOT: '/vol1/docker/kt-qqbot/napcat-instances',
            QQBOT_NAPCAT_SSH_TARGET: 'nas',
          };
          return values[key] || defaultValue || '';
        }),
      } as any,
      containerRepository as any,
      bindingRepository as any,
      new ToolsService(),
      identityService,
    ) as any;
    containerService.runProcess = jest.fn().mockResolvedValue({
      stderr: '',
      stdout: '',
    });

    const runtime = await containerService.reserveCreateContainer();

    expect(containerService.runProcess).not.toHaveBeenCalled();
    expect(runtime).toEqual(
      expect.objectContaining({
        dataDir: expect.stringContaining(`kt-qqbot-napcat-${runtime.id}`),
        id: expect.any(String),
        name: expect.stringContaining(`kt-qqbot-napcat-${runtime.id}`),
      }),
    );
    expect(identityRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: runtime.id,
        containerId: runtime.id,
        dataDir: runtime.dataDir,
      }),
    );

    await containerService.startCreateContainer(runtime);

    const createScript = containerService.runProcess.mock.calls[0][2];
    expect(createScript).toContain('--hostname "$NAPCAT_HOSTNAME"');
    expect(createScript).toContain('--mac-address "$NAPCAT_MAC_ADDRESS"');
    expect(createScript).toContain('-v "$MACHINE_ID_PATH:/etc/machine-id:ro"');
    expect(createScript).toContain('-e LANG=zh_CN.UTF-8');
    expect(createScript).toContain('-e LC_ALL=zh_CN.UTF-8');
    expect(createScript).toContain('-e TZ=Asia/Shanghai');
    expect(createScript).toContain('-e XDG_RUNTIME_DIR=/tmp/runtime-napcat');
  });

  it('adopts the provisional create-login identity when binding the scanned account', async () => {
    const identityRepository = createIdentityRepository();
    const identityService = new NapcatDeviceIdentityService(
      identityRepository as any,
      createIdentityConfig(),
    );
    const provisionalIdentity = {
      accountId: 'container-created',
      containerId: 'container-created',
      dataDir:
        '/vol1/docker/kt-qqbot/napcat-instances/kt-qqbot-napcat-container-created',
      hostname: 'pc-a1b2c3d4',
      hostnameStrategy: 'qqnt-visible-hostname-v1',
      id: 'identity-created',
      lastLoginEvidence: null,
      macAddress: '3c:97:0e:aa:bb:cc',
      macStrategy: 'physical-oui-mac-v1',
      machineIdPath:
        '/vol1/docker/kt-qqbot/napcat-instances/kt-qqbot-napcat-container-created/machine-id',
      verificationStatus: 'pending',
    } as NapcatDeviceIdentity;
    identityRepository.seedIdentity(provisionalIdentity);
    const bindingRepository = {
      create: jest.fn((input) => ({ ...input })),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (input) => input),
      update: jest.fn(),
    };
    const containerRepository = {
      update: jest.fn(),
    };
    const containerService = new QqbotNapcatContainerService(
      {
        get: jest.fn((key: string, defaultValue?: string) => {
          const values: Record<string, string> = {
            QQBOT_NAPCAT_CONTAINER_MODE: 'ssh',
            QQBOT_NAPCAT_CONTAINER_PREFIX: 'kt-qqbot-napcat',
            QQBOT_NAPCAT_ROOT: '/vol1/docker/kt-qqbot/napcat-instances',
          };
          return values[key] || defaultValue || '';
        }),
      } as any,
      containerRepository as any,
      bindingRepository as any,
      new ToolsService(),
      identityService,
    );

    await (containerService as any).bindAccount(
      'account-final',
      'container-created',
      '10001',
    );

    expect(identityRepository.update).toHaveBeenCalledWith(
      { id: 'identity-created' },
      expect.objectContaining({
        accountId: 'account-final',
        containerId: 'container-created',
      }),
    );
    expect(bindingRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account-final',
        containerId: 'container-created',
        deviceIdentityId: 'identity-created',
      }),
    );
    expect(identityRepository.save).toHaveBeenCalledTimes(0);
  });

  it('adopts provisional runtime profiles when binding a create-login container', async () => {
    const identityRepository = createIdentityRepository();
    const identityService = new NapcatDeviceIdentityService(
      identityRepository as any,
      createIdentityConfig(),
    );
    identityRepository.seedIdentity({
      accountId: 'container-created',
      containerId: 'container-created',
      dataDir:
        '/vol1/docker/kt-qqbot/napcat-instances/kt-qqbot-napcat-container-created',
      hostname: 'pc-a1b2c3d4',
      hostnameStrategy: 'qqnt-visible-hostname-v1',
      id: 'identity-created',
      lastLoginEvidence: null,
      macAddress: '3c:97:0e:aa:bb:cc',
      macStrategy: 'physical-oui-mac-v1',
      machineIdPath:
        '/vol1/docker/kt-qqbot/napcat-instances/kt-qqbot-napcat-container-created/machine-id',
      verificationStatus: 'pending',
    } as NapcatDeviceIdentity);
    const runtimeProfileService = {
      adoptPlannedProfiles: jest.fn(),
    };
    const containerService = new QqbotNapcatContainerService(
      createIdentityConfig(),
      {
        update: jest.fn(),
      } as any,
      {
        create: jest.fn((input) => ({ ...input })),
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn().mockResolvedValue(null),
        save: jest.fn(async (input) => input),
        update: jest.fn(),
      } as any,
      new ToolsService(),
      identityService,
      runtimeProfileService as any,
    );

    await containerService.bindAccount(
      'account-final',
      'container-created',
      '10001',
    );

    expect(runtimeProfileService.adoptPlannedProfiles).toHaveBeenCalledWith({
      containerId: 'container-created',
      deviceIdentityId: 'identity-created',
      fromAccountId: 'container-created',
      toAccountId: 'account-final',
    });
  });

  it('reuses persisted device identity when rebuilding an existing account container login env', async () => {
    const identityRepository = createIdentityRepository();
    const identityService = new NapcatDeviceIdentityService(
      identityRepository as any,
      createIdentityConfig(),
    );
    const identity = await identityService.resolveForAccount({
      accountId: 'account-10001',
      containerId: 'container-1',
      selfId: '10001',
    });
    const bindingRepository = {
      findOne: jest.fn().mockResolvedValue({
        accountId: 'account-10001',
        containerId: 'container-1',
        isDeleted: false,
        isPrimary: true,
      }),
    };
    const containerRepository = {
      createQueryBuilder: jest.fn(() => ({
        addSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({
          dataDir: identity.dataDir,
          id: 'container-1',
          image: 'mlikiowa/napcat-docker:latest',
          name: 'kt-qqbot-napcat-10001',
          reverseWsUrl: 'ws://127.0.0.1:48085/qqbot/onebot/reverse',
          webuiPort: 6100,
          webuiToken: 'token-x',
        }),
        where: jest.fn().mockReturnThis(),
      })),
      update: jest.fn(),
    };
    const containerService = new QqbotNapcatContainerService(
      {
        get: jest.fn((key: string, defaultValue?: string) => {
          const values: Record<string, string> = {
            QQBOT_NAPCAT_CONTAINER_MODE: 'ssh',
            QQBOT_NAPCAT_CONTAINER_PREFIX: 'kt-qqbot-napcat',
            QQBOT_NAPCAT_IMAGE: 'mlikiowa/napcat-docker:latest',
            QQBOT_NAPCAT_ROOT: '/vol1/docker/kt-qqbot/napcat-instances',
            QQBOT_NAPCAT_SSH_TARGET: 'nas',
          };
          return values[key] || defaultValue || '';
        }),
      } as any,
      containerRepository as any,
      bindingRepository as any,
      new ToolsService(),
      identityService,
    ) as any;
    containerService.runProcess = jest
      .fn()
      .mockResolvedValueOnce({
        stderr: '',
        stdout: 'ACCOUNT=10001\nNAPCAT_QUICK_PASSWORD=old-password\n',
      })
      .mockResolvedValueOnce({ stderr: '', stdout: '' })
      .mockResolvedValueOnce({ stderr: '', stdout: 'ACCOUNT=10001\n' });

    const recreated = await containerService.ensureRuntimeLoginEnv(
      { id: 'container-1', name: 'kt-qqbot-napcat-10001' },
      {
        clearLoginPassword: true,
        selfId: '10001',
      },
    );

    expect(recreated).toEqual({ changed: true, ok: true });
    expect(bindingRepository.findOne).toHaveBeenCalledWith({
      where: {
        bindStatus: 'bound',
        containerId: 'container-1',
        isDeleted: false,
        isPrimary: true,
      },
    });
    const createScript = containerService.runProcess.mock.calls[1][2];
    expect(createScript).toContain(`NAPCAT_HOSTNAME='${identity.hostname}'`);
    expect(createScript).toContain(
      `NAPCAT_MAC_ADDRESS='${identity.macAddress}'`,
    );
    expect(createScript).toContain(
      `MACHINE_ID_PATH='${identity.machineIdPath}'`,
    );
    expect(createScript).toContain('--hostname "$NAPCAT_HOSTNAME"');
    expect(createScript).toContain('--mac-address "$NAPCAT_MAC_ADDRESS"');
    expect(createScript).toContain('-v "$MACHINE_ID_PATH:/etc/machine-id:ro"');
  });
});

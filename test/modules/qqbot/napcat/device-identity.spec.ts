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
import { readRefactorV3SqlSchema } from '../../../helpers/sql-schema.helper';

type EntityClass = new (...args: never[]) => unknown;

const getEntityTableName = (entity: EntityClass) => {
  return getMetadataArgsStorage().tables.find(
    (table) => table.target === entity,
  )?.name;
};

const getEntityColumnNames = (entity: EntityClass) => {
  return getMetadataArgsStorage()
    .columns.filter((column) => column.target === entity)
    .map((column) => `${column.options.name || column.propertyName}`);
};

const createIdentityRepository = () => {
  const identities = new Map<string, NapcatDeviceIdentity>();

  return {
    create: jest.fn((input: Partial<NapcatDeviceIdentity>) => ({
      ...input,
    })),
    findOne: jest.fn(async ({ where }: { where: { accountId: string } }) => {
      return identities.get(where.accountId) || null;
    }),
    save: jest.fn(async (identity: NapcatDeviceIdentity) => {
      identities.set(identity.accountId, identity);
      return identity;
    }),
    update: jest.fn(async ({ id }: { id: string }, input: Partial<NapcatDeviceIdentity>) => {
      const current = [...identities.values()].find((item) => item.id === id);
      if (current) Object.assign(current, input);
      return { affected: current ? 1 : 0 };
    }),
  };
};

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
    expect(NAPCAT_RUNTIME_DOMAIN_CONTRACT.tables).toEqual([
      'napcat_container',
      'napcat_device_identity',
      'napcat_account_binding',
      'napcat_login_session',
      'napcat_login_challenge',
      'napcat_runtime_cleanup',
    ]);

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
        macAddress: identity.macAddress,
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
    expect(script).toContain('cat > "$DEVICE_ENV_PATH" <<EOF');
    expect(script).toContain('--hostname "$NAPCAT_HOSTNAME"');
    expect(script).toContain('--mac-address "$NAPCAT_MAC_ADDRESS"');
    expect(script).toContain('-v "$MACHINE_ID_PATH:/etc/machine-id:ro"');
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
    expect(createScript).toContain('--hostname "$NAPCAT_HOSTNAME"');
    expect(createScript).toContain('--mac-address "$NAPCAT_MAC_ADDRESS"');
    expect(createScript).toContain('-v "$MACHINE_ID_PATH:/etc/machine-id:ro"');
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
    expect(createScript).toContain(`MACHINE_ID_PATH='${identity.machineIdPath}'`);
    expect(createScript).toContain('--hostname "$NAPCAT_HOSTNAME"');
    expect(createScript).toContain('--mac-address "$NAPCAT_MAC_ADDRESS"');
    expect(createScript).toContain('-v "$MACHINE_ID_PATH:/etc/machine-id:ro"');
  });
});

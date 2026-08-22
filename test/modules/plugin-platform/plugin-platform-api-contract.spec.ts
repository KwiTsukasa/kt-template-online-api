import { createHash } from 'crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as request from 'supertest';
import { JwtAuthGuard } from '../../../src/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { PluginPlatformController } from '../../../src/modules/plugin-platform/contract/plugin-platform.controller';
import { PluginPlatformPermissionGuard } from '../../../src/modules/plugin-platform/contract/plugin-platform-permission.guard';
import { PluginPlatformModule } from '../../../src/modules/plugin-platform/plugin-platform.module';
import { PluginPlatformService } from '../../../src/modules/plugin-platform/application/plugin-platform.service';
import { PluginPackageReaderService } from '../../../src/modules/plugin-platform/infrastructure/integration/package/plugin-package-reader.service';
import {
  PLUGIN_PLATFORM_ENTITIES,
  Plugin,
  PluginAsset,
  PluginConfig,
  PluginEventHandler,
  PluginInstallation,
  PluginOperation,
  PluginRuntimeEvent,
  PluginVersion,
} from '../../../src/modules/plugin-platform/infrastructure/persistence';
import {
  collectControllerRoutes,
  routeKey,
} from '../../helpers/controller-route.helper';

const createRepositoryMock = () => ({
  find: jest.fn(async () => []),
  findAndCount: jest.fn(async () => [[], 0]),
  save: jest.fn(async (value) => value),
  update: jest.fn(async () => ({ affected: 1 })),
});

/**
 * 将旧夹具的账号绑定参数槽移除后构造当前无状态插件平台服务。
 * @param args - 历史构造参数列表。
 * @returns 当前插件平台服务。
 */
function createPlatformService(...args: unknown[]) {
  const currentArgs = [...args.slice(0, 5), ...args.slice(6)];
  return new (PluginPlatformService as any)(
    ...currentArgs,
  ) as PluginPlatformService;
}

const createManifest = () => ({
  assets: [],
  configSchema: {
    type: 'object',
  },
  entry: 'src/index.ts',
  events: [],
  minApiSdkVersion: '1.0.0',
  name: 'Demo Plugin',
  operations: [
    {
      handlerName: 'echo',
      key: 'demo-plugin.echo',
      name: 'Echo',
      permissions: ['bot.reply'],
      timeoutMs: 3000,
    },
  ],
  permissions: ['bot.reply'],
  pluginKey: 'demo-plugin',
  runtime: {
    maxConcurrency: 1,
    memoryMb: 128,
    timeoutMs: 5000,
    workerType: 'node-worker',
  },
  version: '0.1.0',
});

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const sha256 = (content: Buffer | string) =>
  createHash('sha256').update(content).digest('hex');

const packageRoot = join(
  process.cwd(),
  '.kt-workspace',
  'plugin-packages',
  'api-contract',
);

const writePluginPackage = (manifest: ReturnType<typeof createManifest>) => {
  mkdirSync(packageRoot, { recursive: true });
  const packageBody = {
    contentHash: '',
    files: [],
    manifest,
  };
  packageBody.contentHash = sha256(
    stableStringify({
      files: packageBody.files,
      manifest: packageBody.manifest,
    }),
  );
  const packagePath = join(
    packageRoot,
    `${manifest.pluginKey}-${manifest.version}.plugin.json`,
  );
  writeFileSync(packagePath, `${JSON.stringify(packageBody, null, 2)}\n`);
  return {
    packageHash: packageBody.contentHash,
    packagePath,
  };
};

describe('plugin platform API contract', () => {
  let app: INestApplication;
  let repositoryMocks: Map<unknown, ReturnType<typeof createRepositoryMock>>;

  beforeEach(async () => {
    repositoryMocks = new Map();
    const moduleRef = await Test.createTestingModule({
      controllers: [PluginPlatformController],
      providers: [
        PluginPlatformService,
        PluginPackageReaderService,
        ...[
          Plugin,
          PluginVersion,
          PluginInstallation,
          PluginOperation,
          PluginEventHandler,
          PluginConfig,
          PluginAsset,
          PluginRuntimeEvent,
        ].map((entity) => ({
          provide: getRepositoryToken(entity),
          useFactory: () => {
            const repository = createRepositoryMock();
            repositoryMocks.set(entity, repository);
            return repository;
          },
        })),
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: () => true,
      })
      .overrideGuard(PluginPlatformPermissionGuard)
      .useValue({
        canActivate: () => true,
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    rmSync(packageRoot, { force: true, recursive: true });
  });

  it('registers plugin-platform as a first-class AppModule import', () => {
    const source = readFileSync(
      join(__dirname, '../../../src/app.module.ts'),
      'utf8',
    );

    expect(source).toContain('PluginPlatformModule');
  });

  it('loads plural entity files into the TypeORM datasource', () => {
    const source = readFileSync(
      join(__dirname, '../../../src/app.module.ts'),
      'utf8',
    );

    expect(source).toContain('*.entities{.ts,.js}');
  });

  it('exposes plugin-platform management routes', () => {
    expect(routeKey).toBeDefined();
    expect(
      collectControllerRoutes([PluginPlatformController]).map(routeKey),
    ).toEqual(
      expect.arrayContaining([
        'GET /plugin-platform/installations',
        'POST /plugin-platform/upload',
        'POST /plugin-platform/validate',
        'POST /plugin-platform/install',
        'POST /plugin-platform/install-local',
        'POST /plugin-platform/enable',
        'POST /plugin-platform/disable',
        'POST /plugin-platform/upgrade',
        'POST /plugin-platform/uninstall',
        'POST /plugin-platform/config',
        'GET /plugin-platform/runtime-events',
        'GET /plugin-platform/capabilities',
        'GET /plugin-platform/operations/list',
        'GET /plugin-platform/operations/page',
        'GET /plugin-platform/event-handlers',
      ]),
    );
  });

  it('validates manifests through the real HTTP wrapper', async () => {
    const response = await request(app.getHttpServer())
      .post('/plugin-platform/validate')
      .send({
        manifest: createManifest(),
      })
      .expect(200);

    expect(response.body).toMatchObject({
      code: 200,
      data: {
        manifest: {
          pluginKey: 'demo-plugin',
          runtime: {
            timeoutMs: 5000,
          },
        },
        valid: true,
      },
    });
  });

  it('validates controlled plugin packages during upload and install', async () => {
    const manifest = createManifest();
    const { packageHash, packagePath } = writePluginPackage(manifest);

    const uploadResponse = await request(app.getHttpServer())
      .post('/plugin-platform/upload')
      .send({ packagePath })
      .expect(200);

    expect(uploadResponse.body).toMatchObject({
      code: 200,
      data: {
        manifest: {
          pluginKey: manifest.pluginKey,
        },
        packageHash,
        packagePath,
        valid: true,
      },
    });

    await request(app.getHttpServer())
      .post('/plugin-platform/install-local')
      .send({ packageHash, packagePath })
      .expect(200);

    expect(repositoryMocks.get(PluginVersion)?.save).toHaveBeenCalledWith(
      expect.objectContaining({
        packageHash,
      }),
    );
    expect(repositoryMocks.get(PluginInstallation)?.save).toHaveBeenCalledWith(
      expect.objectContaining({
        installedPath: packagePath,
      }),
    );

    await request(app.getHttpServer())
      .post('/plugin-platform/install-local')
      .send({ packageHash: 'bad-hash', packagePath })
      .expect(400);
    await request(app.getHttpServer())
      .post('/plugin-platform/install-local')
      .send({ packagePath: join(process.cwd(), 'package.json') })
      .expect(400);
  });

  it('keeps TypeORM entity registration aligned with the persistence contract', () => {
    expect(PluginPlatformModule).toBeDefined();
    expect(PLUGIN_PLATFORM_ENTITIES).toHaveLength(10);
  });

  it('passes runtime-event filters to persistence', async () => {
    await request(app.getHttpServer())
      .get('/plugin-platform/runtime-events')
      .query({
        eventType: 'worker-crash',
        installationId: '2002',
        level: 'error',
        pluginId: '1001',
        startTime: '2026-06-15 00:00:00',
        endTime: '2026-06-15 23:59:59',
      })
      .expect(200);

    expect(repositoryMocks.get(PluginRuntimeEvent)?.find).toHaveBeenCalledWith({
      where: {
        eventType: 'worker-crash',
        installationId: '2002',
        level: 'error',
        pluginId: '1001',
        createTime: expect.any(Object),
      },
    });
  });

  it('serves platform operation pages from active runtime summaries when persistence rows are empty', async () => {
    const manifest = createManifest();
    const installation = {
      id: 'install-demo',
      installedPath: 'D:/plugins/demo',
      pluginId: 'plugin-demo',
      runtimeStatus: 'stopped',
      status: 'installed',
      versionId: 'version-demo',
    };
    const version = {
      id: 'version-demo',
      manifestJson: manifest,
      packageHash: 'hash',
      pluginId: installation.pluginId,
      version: manifest.version,
    };
    const createRepository = (findOneValue?: unknown) => ({
      find: jest.fn(async () => []),
      findAndCount: jest.fn(async () => [[], 0]),
      findOne: jest.fn(async () => findOneValue || null),
      save: jest.fn(async (value) => value),
      update: jest.fn(async () => ({ affected: 1 })),
    });
    const operationRepository = createRepository();
    const worker = {
      activate: jest.fn(async () => ({ ok: true })),
      deactivate: jest.fn(async () => ({ ok: true })),
      dispose: jest.fn(async () => undefined),
      executeOperation: jest.fn(),
      handleEvent: jest.fn(),
      health: jest.fn(async () => ({ ok: true })),
      load: jest.fn(async () => ({ ok: true })),
    };
    const runtimeFactory = {
      create: jest.fn(() => worker),
    };
    const service = createPlatformService(
      createRepository({
        id: installation.pluginId,
        pluginKey: manifest.pluginKey,
      }),
      createRepository(version),
      createRepository(installation),
      operationRepository,
      createRepository(),
      createRepository(),
      createRepository(),
      createRepository(),
      createRepository(),
      undefined,
      runtimeFactory,
    ) as PluginPlatformService;

    await service.enableInstallation({ id: installation.id });
    const page = await service.pageOperations({
      pageNo: 1,
      pageSize: 10,
      triggerMode: 'command',
    } as any);

    expect(operationRepository.findAndCount).not.toHaveBeenCalled();
    expect(page).toMatchObject({
      pageNo: 1,
      pageSize: 10,
      total: 1,
    });
    expect(page.list).toEqual([
      expect.objectContaining({
        key: 'demo-plugin.echo',
        pluginKey: 'demo-plugin',
        triggerMode: 'command',
      }),
    ]);
  });

  it('keeps compatible plugin operation routes delegated to platform service ownership', () => {
    const source = readFileSync(
      join(
        __dirname,
        '../../../src/modules/plugin-platform/contract/plugin-catalog.controller.ts',
      ),
      'utf8',
    );
    const operationRoutes = source.slice(
      source.indexOf("@Get('operation/list')"),
      source.indexOf("@Get('health')"),
    );

    expect(operationRoutes).toContain('this.service.');
    expect(operationRoutes).not.toContain('this.pluginRegistry');
    expect(operationRoutes).not.toContain('this.eventPluginRegistry');
    expect(source).not.toContain('private listOperations(');
  });
});

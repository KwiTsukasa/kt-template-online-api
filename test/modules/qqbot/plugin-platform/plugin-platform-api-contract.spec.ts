import { createHash } from 'crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as request from 'supertest';
import { JwtAuthGuard } from '../../../../src/modules/admin/identity/auth/jwt-auth.guard';
import { QqbotPluginPlatformController } from '../../../../src/modules/qqbot/plugin-platform/contract/plugin-platform.controller';
import { QqbotPluginPlatformModule } from '../../../../src/modules/qqbot/plugin-platform/plugin-platform.module';
import { QqbotPluginPlatformService } from '../../../../src/modules/qqbot/plugin-platform/application/plugin-platform.service';
import { QqbotPluginPackageReaderService } from '../../../../src/modules/qqbot/plugin-platform/infrastructure/integration/package/plugin-package-reader.service';
import {
  QQBOT_PLUGIN_PLATFORM_ENTITIES,
  QqbotPlugin,
  QqbotPluginAccountBinding,
  QqbotPluginAsset,
  QqbotPluginConfig,
  QqbotPluginEventHandler,
  QqbotPluginInstallation,
  QqbotPluginOperation,
  QqbotPluginRuntimeEvent,
  QqbotPluginVersion,
} from '../../../../src/modules/qqbot/plugin-platform/infrastructure/persistence';
import {
  collectControllerRoutes,
  routeKey,
} from '../../../helpers/controller-route.helper';

/**
 * 创建 QQBot 插件平台对象或配置。
 */
const createRepositoryMock = () => ({
  find: jest.fn(async () => []),
  findAndCount: jest.fn(async () => [[], 0]),
  save: jest.fn(async (value) => value),
  update: jest.fn(async () => ({ affected: 1 })),
});

/**
 * 创建 QQBot 插件平台对象或配置。
 */
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
      permissions: ['qqbot.send'],
      timeoutMs: 3000,
    },
  ],
  permissions: ['qqbot.send'],
  pluginKey: 'demo-plugin',
  runtime: {
    maxConcurrency: 1,
    memoryMb: 128,
    timeoutMs: 5000,
    workerType: 'node-worker',
  },
  version: '0.1.0',
});

/**
 * 执行 QQBot 插件平台流程。
 * @param value - 待稳定序列化的值；转换 插件平台列表项。
 * @returns QQBot 插件平台渲染后的图片、画布或文本。
 */
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

/**
 * 执行 QQBot 插件平台流程。
 * @param content - 待处理内容；驱动 `createHash()` 的 插件平台步骤。
 */
const sha256 = (content: Buffer | string) =>
  createHash('sha256').update(content).digest('hex');

const packageRoot = join(
  process.cwd(),
  '.kt-workspace',
  'qqbot-plugin-packages',
  'api-contract',
);

/**
 * 执行 QQBot 插件平台流程。
 * @param manifest - manifest 输入；使用 `pluginKey`、`version` 字段生成结果。
 */
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
    `${manifest.pluginKey}-${manifest.version}.qqbot-plugin.json`,
  );
  writeFileSync(packagePath, `${JSON.stringify(packageBody, null, 2)}\n`);
  return {
    packageHash: packageBody.contentHash,
    packagePath,
  };
};

describe('QQBot plugin platform API contract', () => {
  let app: INestApplication;
  let repositoryMocks: Map<unknown, ReturnType<typeof createRepositoryMock>>;

  beforeEach(async () => {
    repositoryMocks = new Map();
    const moduleRef = await Test.createTestingModule({
      controllers: [QqbotPluginPlatformController],
      providers: [
        QqbotPluginPlatformService,
        QqbotPluginPackageReaderService,
        ...[
          QqbotPlugin,
          QqbotPluginVersion,
          QqbotPluginInstallation,
          QqbotPluginOperation,
          QqbotPluginEventHandler,
          QqbotPluginAccountBinding,
          QqbotPluginConfig,
          QqbotPluginAsset,
          QqbotPluginRuntimeEvent,
        ].map((entity) => ({
          provide: getRepositoryToken(entity),
          /**
           * 创建 插件平台依赖注入工厂产物。
           */
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
        /**
         * 判断 插件平台回调条件。
         */
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
      join(__dirname, '../../../../src/app.module.ts'),
      'utf8',
    );

    expect(source).toContain('QqbotPluginPlatformModule');
  });

  it('loads plural entity files into the TypeORM datasource', () => {
    const source = readFileSync(
      join(__dirname, '../../../../src/app.module.ts'),
      'utf8',
    );

    expect(source).toContain('*.entities{.ts,.js}');
  });

  it('exposes plugin-platform management routes', () => {
    expect(routeKey).toBeDefined();
    expect(
      collectControllerRoutes([QqbotPluginPlatformController]).map(routeKey),
    ).toEqual(
      expect.arrayContaining([
        'GET /qqbot/plugin-platform/installations',
        'POST /qqbot/plugin-platform/upload',
        'POST /qqbot/plugin-platform/validate',
        'POST /qqbot/plugin-platform/install',
        'POST /qqbot/plugin-platform/install-local',
        'POST /qqbot/plugin-platform/enable',
        'POST /qqbot/plugin-platform/disable',
        'POST /qqbot/plugin-platform/upgrade',
        'POST /qqbot/plugin-platform/uninstall',
        'POST /qqbot/plugin-platform/config',
        'GET /qqbot/plugin-platform/runtime-events',
        'GET /qqbot/plugin-platform/account-bindings',
        'GET /qqbot/plugin-platform/capabilities',
        'GET /qqbot/plugin-platform/operations/list',
        'GET /qqbot/plugin-platform/operations/page',
        'GET /qqbot/plugin-platform/event-handlers',
      ]),
    );
  });

  it('validates manifests through the real HTTP wrapper', async () => {
    const response = await request(app.getHttpServer())
      .post('/qqbot/plugin-platform/validate')
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
      .post('/qqbot/plugin-platform/upload')
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
      .post('/qqbot/plugin-platform/install-local')
      .send({ packageHash, packagePath })
      .expect(200);

    expect(repositoryMocks.get(QqbotPluginVersion)?.save).toHaveBeenCalledWith(
      expect.objectContaining({
        packageHash,
      }),
    );
    expect(
      repositoryMocks.get(QqbotPluginInstallation)?.save,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        installedPath: packagePath,
      }),
    );

    await request(app.getHttpServer())
      .post('/qqbot/plugin-platform/install-local')
      .send({ packageHash: 'bad-hash', packagePath })
      .expect(400);
    await request(app.getHttpServer())
      .post('/qqbot/plugin-platform/install-local')
      .send({ packagePath: join(process.cwd(), 'package.json') })
      .expect(400);
  });

  it('keeps TypeORM entity registration aligned with the persistence contract', () => {
    expect(QqbotPluginPlatformModule).toBeDefined();
    expect(QQBOT_PLUGIN_PLATFORM_ENTITIES).toHaveLength(11);
  });

  it('passes runtime-event filters to persistence', async () => {
    await request(app.getHttpServer())
      .get('/qqbot/plugin-platform/runtime-events')
      .query({
        eventType: 'worker-crash',
        installationId: '2002',
        level: 'error',
        pluginId: '1001',
        startTime: '2026-06-15 00:00:00',
        endTime: '2026-06-15 23:59:59',
      })
      .expect(200);

    expect(
      repositoryMocks.get(QqbotPluginRuntimeEvent)?.find,
    ).toHaveBeenCalledWith({
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
    /**
     * 创建 仓库 mock。
     * @param findOneValue - findOneValue 输入；构造 Jest mock 返回值。
     */
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
    const service = new (QqbotPluginPlatformService as any)(
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
    ) as QqbotPluginPlatformService;

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
        '../../../../src/modules/qqbot/plugin-platform/contract/qqbot-plugin.controller.ts',
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

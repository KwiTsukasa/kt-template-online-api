import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { PLUGIN_RUNTIME_FACTORY } from '../../../src/modules/plugin-platform/application/plugin-platform.service';
import { PluginPlatformService } from '../../../src/modules/plugin-platform/application/plugin-platform.service';
import { PluginEventRegistryService } from '../../../src/modules/plugin-platform/application/registry/plugin-event-registry.service';
import { PluginRegistryService } from '../../../src/modules/plugin-platform/application/registry/plugin-registry.service';
import { PluginPlatformModule } from '../../../src/modules/plugin-platform/plugin-platform.module';
import { PluginPackageSourceService } from '../../../src/modules/plugin-platform/infrastructure/integration/package/plugin-package-source.service';
import { PluginHostBridgeService } from '../../../src/modules/plugin-platform/infrastructure/integration/runtime/plugin-host-bridge.service';
import { PluginWorkerRuntimeFactoryService } from '../../../src/modules/plugin-platform/infrastructure/integration/runtime';

const repoRoot = join(__dirname, '../../..');

const readSource = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), 'utf8');

const collectSourceFiles = (relativePath: string): string[] => {
  const absolutePath = join(repoRoot, relativePath);
  if (!existsSync(absolutePath)) return [];
  const stat = statSync(absolutePath);
  if (stat.isFile()) return [absolutePath];
  return readdirSync(absolutePath, { withFileTypes: true }).flatMap((entry) =>
    collectSourceFiles(join(relativePath, entry.name)),
  );
};

const createPackageSource = (
  manifest: Record<string, unknown>,
  packageRoot = 'D:/plugins/demo-plugin',
) => ({
  discoverPackages: jest.fn(async () => [
    {
      entry: manifest.entry as string,
      entryFile: `${packageRoot}/src/index.ts`,
      manifest,
      packageRoot,
      pluginKey: manifest.pluginKey as string,
    },
  ]),
});

/**
 * 将旧测试夹具中的已删除账号绑定槽移除后构造无状态插件平台服务。
 * @param args - 历史夹具参数列表，第六项是已退役账号绑定服务。
 * @returns 使用当前构造参数顺序创建的插件平台服务。
 */
function createPlatformService(...args: unknown[]) {
  const currentArgs = [...args.slice(0, 5), ...args.slice(6)];
  return new (PluginPlatformService as any)(
    ...currentArgs
  ) as PluginPlatformService;
}

describe('QQBot plugin platform lifecycle runtime contract', () => {
  it('registers the default worker runtime factory in the Nest module', () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      PluginPlatformModule,
    ) as unknown[];

    expect(providers).toEqual(
      expect.arrayContaining([
        PluginWorkerRuntimeFactoryService,
        expect.objectContaining({
          provide: PLUGIN_RUNTIME_FACTORY,
          useExisting: PluginWorkerRuntimeFactoryService,
        }),
      ]),
    );
  });

  it('keeps the generic worker runtime factory dependency visible to Nest DI', () => {
    const dependencies = Reflect.getMetadata(
      'design:paramtypes',
      PluginWorkerRuntimeFactoryService,
    );

    expect(dependencies?.[0]).toBe(ConfigService);
    expect(dependencies?.[1]).toBe(PluginPackageSourceService);
    expect(dependencies?.[2]).toBe(PluginHostBridgeService);
  });

  it('keeps the generic worker runtime descriptor-based and plugin-agnostic', () => {
    const source = [
      readSource(
        'src/modules/plugin-platform/infrastructure/integration/runtime/plugin-worker-runtime.factory.ts',
      ),
      readSource(
        'src/modules/plugin-platform/infrastructure/integration/runtime/plugin-worker.thread.ts',
      ),
    ].join('\n');

    expect(source).toContain('node:worker_threads');
    expect(source).toContain('descriptor');
    expect(source).not.toContain(`Bot${'Builtin'}PluginPackageLoaderService`);
    expect(source).not.toMatch(
      new RegExp(
        [
          `@/modules/qqbot/${'plugins'}`,
          ['src', 'modules', 'plugins'].join('/'),
          `create${'BangDream'}Plugin`,
          `create${'Ff14Market'}Plugin`,
          `create${'Fflogs'}Plugin`,
          `create${'Repeater'}Plugin`,
          String.raw`pluginKey\s*===`,
          String.raw`case\s+['"]`,
        ].join('|'),
      ),
    );
  });

  it('uses a real worker-thread boundary for descriptor plugin runtimes', () => {
    const source = readSource(
      'src/modules/plugin-platform/infrastructure/integration/runtime/plugin-worker-runtime.factory.ts',
    );

    expect(source).toContain('node:worker_threads');
    expect(source).toContain('PluginWorkerThreadDriver');
    expect(source).not.toContain(`Bot${'Builtin'}PluginWorkerThreadDriver`);
    expect(source).not.toContain(`new Bot${'Builtin'}PluginWorkerDriver`);
  });

  it('uses BullMQ queues to serialize plugin worker requests instead of ad hoc in-memory chaining', () => {
    const source = [
      readSource('src/modules/plugin-platform/plugin-platform.module.ts'),
      readSource(
        'src/modules/plugin-platform/infrastructure/integration/runtime/bullmq-plugin-worker-request.queue.ts',
      ),
      readSource(
        'src/modules/plugin-platform/infrastructure/integration/runtime/plugin-worker-runtime.factory.ts',
      ),
    ].join('\n');

    expect(source).toContain('@nestjs/bullmq');
    expect(source).toContain("from 'bullmq'");
    expect(source).toContain('new Queue(');
    expect(source).toContain('new Worker(');
    expect(source).toContain('new QueueEvents(');
    expect(source).toContain('concurrency: 1');
    expect(source).toContain('installation.id');
    expect(source).toContain('options.installationId');
    expect(source).toContain("this.queue.on('error'");
    expect(source).toContain("this.queueEvents.on('error'");
    expect(source).toContain("this.worker.on('error'");
    expect(source).toContain('expiresAt');
    expect(source).toContain('workerInstanceId');
    expect(source).toContain('worker-request-expired');
    expect(source).not.toContain('previous.catch(() => undefined).then');
  });

  it('keeps API deployment as a single plugin queue consumer during releases', () => {
    const source = readSource('k8s/prod/api.yaml');

    expect(source).toContain('replicas: 1');
    expect(source).toContain('type: Recreate');
    expect(source).not.toContain('maxSurge: 1');
    expect(source).not.toContain('maxUnavailable: 0');
  });

  it('pulls the plugin Redis runtime image from the local registry', () => {
    const source = readSource('k8s/prod/api.yaml');

    expect(source).toContain(
      'image: k3d-kt-registry.localhost:5000/redis:7.4-alpine',
    );
    expect(source).not.toContain('image: redis:7.4-alpine');
  });

  it('uses dedicated lifecycle use cases instead of direct status flips', () => {
    const controller = readSource(
      'src/modules/plugin-platform/contract/plugin-platform.controller.ts',
    );
    const service = readSource(
      'src/modules/plugin-platform/application/plugin-platform.service.ts',
    );

    const bannedDirectStatusFlips = [
      controller.includes('setInstallationStatus')
        ? 'controller.setInstallationStatus'
        : '',
      service.includes('setInstallationStatus')
        ? 'service.setInstallationStatus'
        : '',
    ].filter(Boolean);
    const missingLifecycleMethods = [
      'enableInstallation',
      'disableInstallation',
      'upgradeInstallation',
      'uninstallInstallation',
    ].filter((methodName) => !service.includes(methodName));

    expect(bannedDirectStatusFlips).toEqual([]);
    expect(missingLifecycleMethods).toEqual([]);
  });

  it('activates workers and refreshes active registries during lifecycle transitions', () => {
    const source = [
      readSource(
        'src/modules/plugin-platform/application/plugin-platform.service.ts',
      ),
      readSource(
        'src/modules/plugin-platform/infrastructure/integration/runtime/worker-runtime.ts',
      ),
    ].join('\n');

    const missingRuntimeSignals = [
      'PluginWorkerRuntime',
      'activate',
      'deactivate',
      'dispose',
      'refreshActive',
      'activeOperation',
      'activeEvent',
    ].filter((signal) => !source.includes(signal));

    expect(missingRuntimeSignals).toEqual([]);
  });

  it('exposes operation executor and event dispatcher through the platform', () => {
    const source = readSource(
      'src/modules/plugin-platform/application/plugin-platform.service.ts',
    );

    const missingExecutorSignals = [
      'executeOperation',
      'dispatchEvent',
      'runtimeEventRepository',
      'command log',
    ].filter((signal) => !source.includes(signal));

    expect(missingExecutorSignals).toEqual([]);
  });

  it('keeps event plugin metadata generic instead of hard-coding repeater', () => {
    const source = readSource(
      'src/modules/plugin-platform/application/registry/plugin-event-registry.service.ts',
    );

    expect(source).toContain('registerRuntimeEvents');
    expect(source).not.toMatch(/pluginKey\s*===\s*['"]repeater['"]/);
    expect(source).not.toContain('getRepeaterPlugin');
  });

  it('keeps plugin-specific argument parsing inside plugin packages', () => {
    const sources = collectSourceFiles(
      'src/modules/plugin-platform/application/argument',
    )
      .concat(
        collectSourceFiles(
          'src/modules/plugin-platform/infrastructure/integration/argument',
        ),
      )
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');

    expect(sources).not.toMatch(/DictService/);
    expect(sources).not.toMatch(/modules\/qqbot\/plugins\/ff14-market/);
    expect(sources).not.toMatch(/modules\/qqbot\/plugins\/fflogs/);
    expect(sources).not.toMatch(
      new RegExp([`parseBot${'Ff14'}`, `parseBot${'Fflogs'}`].join('|')),
    );
  });

  it('loads, activates, health-checks, refreshes, and disposes workers during lifecycle transitions', async () => {
    const manifest = {
      assets: [],
      configSchema: {},
      entry: 'src/index.ts',
      events: [],
      legacyAliases: [],
      migrations: [],
      minApiSdkVersion: '1.0.0',
      name: 'Demo Plugin',
      operations: [],
      permissions: [],
      pluginKey: 'demo-plugin',
      runtime: {
        maxConcurrency: 1,
        memoryMb: 128,
        timeoutMs: 5000,
        workerType: 'node-worker',
      },
      version: '0.1.0',
    };
    const installation = {
      id: 'installation-1',
      installedPath: 'D:/plugins/demo-plugin',
      pluginId: '2060000000000000002',
      runtimeStatus: 'stopped',
      status: 'installed',
      versionId: 'version-1',
    };
    const version = {
      id: 'version-1',
      manifestJson: manifest,
      packageHash: 'hash',
      pluginId: 'plugin-1',
      version: '0.1.0',
    };
    const createRepository = (findOneValue?: unknown) => ({
      find: jest.fn(async () => []),
      findAndCount: jest.fn(async () => [[], 0]),
      findOne: jest.fn(async () => findOneValue),
      save: jest.fn(async (value) => value),
      update: jest.fn(async () => ({ affected: 1 })),
    });
    const pluginRepository = createRepository({
      id: installation.pluginId,
      pluginKey: 'demo-plugin',
    });
    const versionRepository = createRepository(version);
    const installationRepository = createRepository(installation);
    const operationRepository = createRepository();
    const eventHandlerRepository = createRepository();
    const accountBindingRepository = createRepository();
    const configRepository = createRepository();
    const assetRepository = createRepository();
    const runtimeEventRepository = createRepository();
    const runtimeEventBatches = [
      [],
      [
        {
          eventType: 'worker-dispose-finished',
          level: 'info',
          pluginKey: 'demo-plugin',
          safeSummary: {
            phase: 'dispose',
          },
        },
      ],
    ];
    const worker = {
      activate: jest.fn(async () => ({ ok: true })),
      deactivate: jest.fn(async () => ({ ok: true })),
      dispose: jest.fn(async () => undefined),
      drainRuntimeEvents: jest.fn(() => runtimeEventBatches.shift() || []),
      health: jest.fn(async () => ({ ok: true })),
      load: jest.fn(async () => ({ ok: true })),
    };
    const runtimeFactory = {
      create: jest.fn(() => worker),
    };
    const pluginRegistry = {
      setPluginActive: jest.fn(),
    };
    const eventPluginRegistry = {
      registerRuntimeEvents: jest.fn(),
      setPluginActive: jest.fn(),
      unregisterRuntimeEvents: jest.fn(),
    };
    const service = createPlatformService(
      pluginRepository,
      versionRepository,
      installationRepository,
      operationRepository,
      eventHandlerRepository,
      accountBindingRepository,
      configRepository,
      assetRepository,
      runtimeEventRepository,
      undefined,
      runtimeFactory,
      pluginRegistry,
      eventPluginRegistry,
    ) as PluginPlatformService;

    await expect(
      service.enableInstallation({ id: installation.id }),
    ).resolves.toMatchObject({
      id: installation.id,
      runtimeStatus: 'healthy',
      status: 'enabled',
    });
    expect(runtimeFactory.create).toHaveBeenCalledWith(installation, version);
    expect(worker.load).toHaveBeenCalledWith(manifest);
    expect(worker.activate).toHaveBeenCalled();
    expect(worker.health).toHaveBeenCalled();
    expect(operationRepository.update).toHaveBeenCalledWith(
      { pluginId: installation.pluginId },
      { enabled: true },
    );
    expect(eventHandlerRepository.update).toHaveBeenCalledWith(
      { pluginId: installation.pluginId },
      { enabled: true },
    );
    expect(pluginRegistry.setPluginActive).toHaveBeenCalledWith(
      'demo-plugin',
      true,
    );
    expect(eventPluginRegistry.setPluginActive).toHaveBeenCalledWith(
      'demo-plugin',
      true,
    );
    expect(runtimeEventRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'enable-finished',
        installationId: installation.id,
        pluginId: installation.pluginId,
      }),
    );

    await service.disableInstallation({ id: installation.id });
    expect(pluginRegistry.setPluginActive).toHaveBeenLastCalledWith(
      'demo-plugin',
      false,
    );
    expect(eventPluginRegistry.setPluginActive).toHaveBeenLastCalledWith(
      'demo-plugin',
      false,
    );
    expect(worker.deactivate).toHaveBeenCalled();
    expect(worker.dispose).toHaveBeenCalled();
    expect(runtimeEventRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'worker-dispose-finished',
        installationId: installation.id,
        pluginId: installation.pluginId,
      }),
    );
  });

  it('keeps worker cleanup best-effort when stop runtime event persistence fails', async () => {
    const manifest = {
      assets: [],
      configSchema: {},
      entry: 'src/index.ts',
      events: [],
      legacyAliases: [],
      migrations: [],
      minApiSdkVersion: '1.0.0',
      name: 'Demo Plugin',
      operations: [],
      permissions: [],
      pluginKey: 'demo-plugin',
      runtime: {
        maxConcurrency: 1,
        memoryMb: 128,
        timeoutMs: 5000,
        workerType: 'node-worker',
      },
      version: '0.1.0',
    };
    const installation = {
      id: 'installation-cleanup',
      installedPath: 'D:/plugins/demo-plugin',
      pluginId: '2060000000000000003',
      runtimeStatus: 'stopped',
      status: 'installed',
      versionId: 'version-cleanup',
    };
    const version = {
      id: 'version-cleanup',
      manifestJson: manifest,
      packageHash: 'hash',
      pluginId: installation.pluginId,
      version: '0.1.0',
    };
    const createRepository = (findOneValue?: unknown) => ({
      find: jest.fn(async () => []),
      findAndCount: jest.fn(async () => [[], 0]),
      findOne: jest.fn(async () => findOneValue),
      save: jest.fn(async (value) => value),
      update: jest.fn(async () => ({ affected: 1 })),
    });
    const runtimeEventRepository = createRepository();
    runtimeEventRepository.save = jest.fn(async (value) => {
      if (
        value &&
        typeof value === 'object' &&
        (value as { eventType?: string }).eventType ===
          'worker-dispose-finished'
      ) {
        throw new Error('runtime event db unavailable');
      }
      return value;
    });
    const runtimeEventBatches = [
      [],
      [
        {
          eventType: 'worker-dispose-finished',
          level: 'info',
          pluginKey: 'demo-plugin',
          safeSummary: {
            phase: 'dispose',
          },
        },
      ],
    ];
    const worker = {
      activate: jest.fn(async () => ({ ok: true })),
      deactivate: jest.fn(async () => ({ ok: true })),
      dispose: jest.fn(async () => undefined),
      drainRuntimeEvents: jest.fn(() => runtimeEventBatches.shift() || []),
      health: jest.fn(async () => ({ ok: true })),
      load: jest.fn(async () => ({ ok: true })),
    };
    const service = createPlatformService(
      createRepository({
        id: installation.pluginId,
        pluginKey: 'demo-plugin',
      }),
      createRepository(version),
      createRepository(installation),
      createRepository(),
      createRepository(),
      { listBoundPluginKeys: jest.fn(async () => ['demo-plugin']) },
      createRepository(),
      createRepository(),
      runtimeEventRepository,
      undefined,
      {
        create: jest.fn(() => worker),
      },
      {
        setPluginActive: jest.fn(),
      },
      {
        registerRuntimeEvents: jest.fn(),
        setPluginActive: jest.fn(),
        unregisterRuntimeEvents: jest.fn(),
      },
    ) as PluginPlatformService;

    await service.enableInstallation({ id: installation.id });
    await expect(
      service.disableInstallation({ id: installation.id }),
    ).resolves.toMatchObject({
      id: installation.id,
      runtimeStatus: 'stopped',
      status: 'disabled',
    });

    expect(worker.dispose).toHaveBeenCalled();
    expect((service as any).activeWorkers.has(installation.id)).toBe(false);
    expect((service as any).activeWorkerContexts.has(installation.id)).toBe(
      false,
    );
  });

  it('routes enabled command and message executions through active worker runtimes', async () => {
    const manifest = {
      assets: [],
      configSchema: {},
      entry: 'src/index.ts',
      events: [
        {
          eventName: 'message',
          handlerName: 'handleMessage',
          key: 'demo-plugin.message',
          name: '消息事件',
        },
      ],
      legacyAliases: ['demoLegacy'],
      migrations: [],
      minApiSdkVersion: '1.0.0',
      name: 'Demo Plugin',
      operations: [
        {
          handlerName: 'echo',
          key: 'demo-plugin.echo',
          name: 'Echo',
          permissions: ['bot.reply'],
          timeoutMs: 123,
        },
      ],
      permissions: ['bot.reply', 'bot.event.receive'],
      pluginKey: 'demo-plugin',
      runtime: {
        maxConcurrency: 1,
        memoryMb: 128,
        timeoutMs: 456,
        workerType: 'node-worker',
      },
      version: '0.1.0',
    };
    const installation = {
      id: 'installation-execute',
      installedPath: 'D:/plugins/demo-plugin',
      pluginId: '2060000000000000001',
      runtimeStatus: 'stopped',
      status: 'installed',
      versionId: 'version-execute',
    };
    const version = {
      id: 'version-execute',
      manifestJson: manifest,
      packageHash: 'hash',
      pluginId: installation.pluginId,
      version: manifest.version,
    };
    const createRepository = (findOneValue?: unknown) => ({
      find: jest.fn(async () => []),
      findAndCount: jest.fn(async () => [[], 0]),
      findOne: jest.fn(async () => findOneValue),
      save: jest.fn(async (value) => value),
      update: jest.fn(async () => ({ affected: 1 })),
    });
    const runtimeEventRepository = createRepository();
    const runtimeEventBatches = [
      [
        {
          eventType: 'worker-recovered',
          level: 'info',
          pluginKey: 'demo-plugin',
          safeSummary: {
            status: 'active',
          },
        },
      ],
      [],
    ];
    const worker = {
      activate: jest.fn(async () => ({ ok: true })),
      deactivate: jest.fn(async () => ({ ok: true })),
      dispose: jest.fn(async () => undefined),
      drainRuntimeEvents: jest.fn(() => runtimeEventBatches.shift() || []),
      executeOperation: jest.fn(async () => ({ replyText: 'worker-ok' })),
      handleEvent: jest.fn(async () => true),
      health: jest.fn(async () => ({ ok: true })),
      load: jest.fn(async () => ({ ok: true })),
    };
    const runtimeFactory = {
      create: jest.fn(() => worker),
    };
    const argumentParser = {
      normalizeInput: jest.fn(async () => ({ text: 'normalized' })),
    };
    const fallbackCommandRegistry = {
      execute: jest.fn(),
      listOperations: jest.fn(() => [
        {
          key: 'demo-plugin.echo',
          name: 'Echo',
          pluginKey: 'demo-plugin',
          triggerMode: 'command',
        },
      ]),
      setPluginActive: jest.fn(),
    };
    const fallbackEventRegistry = {
      dispatchMessage: jest.fn(),
      listOperations: jest.fn(() => [
        {
          key: 'message',
          name: '消息事件',
          pluginKey: 'demo-plugin',
          triggerMode: 'event',
        },
      ]),
      registerRuntimeEvents: jest.fn(),
      setPluginActive: jest.fn(),
      unregisterRuntimeEvents: jest.fn(),
    };
    const listBoundPluginKeys = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue(['demo-plugin']);
    const service = createPlatformService(
      createRepository({ id: installation.pluginId, pluginKey: 'demo-plugin' }),
      createRepository(version),
      createRepository(installation),
      createRepository(),
      createRepository(),
      { listBoundPluginKeys },
      createRepository(),
      createRepository(),
      runtimeEventRepository,
      argumentParser,
      runtimeFactory,
      fallbackCommandRegistry,
      fallbackEventRegistry,
    ) as PluginPlatformService;

    await service.enableInstallation({ id: installation.id });

    await expect(
      service.executeOperation({
        input: { text: 'raw' },
        operationKey: 'demo-plugin.echo',
        pluginKey: 'demoLegacy',
      }),
    ).resolves.toEqual({ replyText: 'worker-ok' });
    await expect(
      service.dispatchEvent({
        event: {
          conversationKey: 'conversation-unbound',
          eventId: 'msg-unbound',
          isSelf: false,
          links: [],
          metadata: {},
          rawText: 'unbound',
          scope: 'group',
          senderKey: 'sender-unbound',
          text: 'unbound',
        },
        eventKey: 'message',
        pluginKeys: [],
      }),
    ).resolves.toEqual({ handled: false, replies: [] });
    expect(worker.handleEvent).not.toHaveBeenCalled();
    await expect(
      service.dispatchEvent({
        event: {
          conversationKey: 'conversation-1',
          eventId: 'msg-1',
          isSelf: false,
          links: [],
          metadata: {},
          rawText: 'hello',
          scope: 'group',
          senderKey: 'sender-1',
          text: 'hello',
        },
        eventKey: 'message',
        pluginKeys: ['demo-plugin'],
      }),
    ).resolves.toEqual({ handled: true, replies: [] });

    expect(worker.executeOperation).toHaveBeenCalledWith({
      input: { text: 'normalized' },
      operationId: 'demo-plugin.echo',
      operationKey: 'demo-plugin.echo',
      timeoutMs: 123,
    });
    expect(worker.handleEvent).toHaveBeenCalledWith({
      event: expect.objectContaining({
        eventId: 'msg-1',
      }),
      eventKey: 'message',
      timeoutMs: 456,
    });
    expect(argumentParser.normalizeInput).toHaveBeenCalledWith(
      expect.objectContaining({
        operationKey: 'demo-plugin.echo',
        pluginKey: 'demoLegacy',
      }),
    );
    expect(fallbackCommandRegistry.execute).not.toHaveBeenCalled();
    expect(fallbackEventRegistry.dispatchMessage).not.toHaveBeenCalled();
    expect(runtimeEventRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'worker-recovered',
        installationId: installation.id,
        level: 'info',
        pluginId: installation.pluginId,
        safeSummary: {
          status: 'active',
        },
      }),
    );
  });

  it('does not execute workers for persisted disabled built-in plugins', async () => {
    const manifest = {
      assets: [],
      configSchema: {},
      entry: 'src/index.ts',
      events: [],
      legacyAliases: ['demoLegacy'],
      migrations: [],
      minApiSdkVersion: '1.0.0',
      name: 'Demo Plugin',
      operations: [
        {
          handlerName: 'echo',
          key: 'demo-plugin.echo',
          name: 'Echo',
          permissions: ['bot.reply'],
          timeoutMs: 123,
        },
      ],
      permissions: ['bot.reply'],
      pluginKey: 'demo-plugin',
      runtime: {
        maxConcurrency: 1,
        memoryMb: 128,
        timeoutMs: 456,
        workerType: 'node-worker',
      },
      version: '0.1.0',
    };
    const plugin = {
      id: 'plugin-disabled',
      pluginKey: 'demo-plugin',
    };
    const disabledInstallation = {
      id: 'installation-disabled',
      installedPath: 'D:/plugins/demo-plugin',
      pluginId: plugin.id,
      runtimeStatus: 'stopped',
      status: 'disabled',
      versionId: 'version-disabled',
    };
    const createRepository = (
      rows: unknown[] = [],
      findOneValue?: unknown,
    ) => ({
      find: jest.fn(async () => rows),
      findAndCount: jest.fn(async () => [rows, rows.length]),
      findOne: jest.fn(async () => findOneValue || null),
      save: jest.fn(async (value) => value),
      update: jest.fn(async () => ({ affected: 1 })),
    });
    const worker = {
      activate: jest.fn(async () => ({ ok: true })),
      deactivate: jest.fn(async () => ({ ok: true })),
      dispose: jest.fn(async () => undefined),
      executeOperation: jest.fn(async () => ({ replyText: 'should-not-run' })),
      handleEvent: jest.fn(async () => true),
      health: jest.fn(async () => ({ ok: true })),
      load: jest.fn(async () => ({ ok: true })),
    };
    const runtimeFactory = {
      create: jest.fn(() => worker),
    };
    const service = createPlatformService(
      createRepository([plugin], plugin),
      createRepository(),
      createRepository([disabledInstallation], disabledInstallation),
      createRepository(),
      createRepository(),
      { listBoundPluginKeys: jest.fn(async () => ['demo-plugin']) },
      createRepository(),
      createRepository(),
      createRepository(),
      undefined,
      runtimeFactory,
      undefined,
      undefined,
      undefined,
      createPackageSource(manifest),
    ) as PluginPlatformService;

    await service.onModuleInit();

    expect(runtimeFactory.create).not.toHaveBeenCalled();
    expect(await service.listActiveOperations()).toEqual([]);
    await expect(
      service.executeOperation({
        input: { text: 'raw' },
        operationKey: 'demo-plugin.echo',
        pluginKey: 'demoLegacy',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        msg: 'Bot 插件运行时未启用：demoLegacy',
      }),
    });
    expect(worker.executeOperation).not.toHaveBeenCalled();
  });

  it('continues starting other built-in workers when one worker health check fails', async () => {
    const createManifest = (pluginKey: string) => ({
      assets: [],
      configSchema: {},
      entry: 'src/index.ts',
      events: [],
      legacyAliases: [],
      migrations: [],
      minApiSdkVersion: '1.0.0',
      name: pluginKey,
      operations: [
        {
          handlerName: 'echo',
          key: `${pluginKey}.echo`,
          name: 'Echo',
          permissions: [],
          timeoutMs: 123,
        },
      ],
      permissions: [],
      pluginKey,
      runtime: {
        maxConcurrency: 1,
        memoryMb: 128,
        timeoutMs: 456,
        workerType: 'node-worker',
      },
      version: '0.1.0',
    });
    const failingManifest = createManifest('failing-plugin');
    const healthyManifest = createManifest('healthy-plugin');
    const savedPlugins: any[] = [];
    const savedVersions: any[] = [];
    const savedInstallations: any[] = [];
    const runtimeEvents: any[] = [];
    const pluginRepository = {
      find: jest.fn(async () => savedPlugins),
      findAndCount: jest.fn(async () => [savedPlugins, savedPlugins.length]),
      findOne: jest.fn(async ({ where }: any) =>
        savedPlugins.find((plugin) => plugin.id === where?.id),
      ),
      save: jest.fn(async (value) => {
        const row = { id: `plugin-${value.pluginKey}`, ...value };
        savedPlugins.push(row);
        return row;
      }),
      update: jest.fn(async () => ({ affected: 1 })),
    };
    const versionRepository = {
      findOne: jest.fn(async ({ where }: any) =>
        savedVersions.find((version) => version.id === where?.id),
      ),
      save: jest.fn(async (value) => {
        const row = { id: `version-${value.pluginId}`, ...value };
        savedVersions.push(row);
        return row;
      }),
      update: jest.fn(async () => ({ affected: 1 })),
    };
    const installationRepository = {
      find: jest.fn(async () => savedInstallations),
      findAndCount: jest.fn(async () => [
        savedInstallations,
        savedInstallations.length,
      ]),
      findOne: jest.fn(async ({ where }: any) =>
        savedInstallations.find(
          (installation) => installation.id === where?.id,
        ),
      ),
      save: jest.fn(async (value) => {
        const row = { id: `installation-${value.pluginId}`, ...value };
        savedInstallations.push(row);
        return row;
      }),
      update: jest.fn(async () => ({ affected: 1 })),
    };
    const runtimeEventRepository = {
      save: jest.fn(async (value) => {
        runtimeEvents.push(value);
        return value;
      }),
    };
    const failingWorker = {
      activate: jest.fn(async () => ({ ok: true })),
      deactivate: jest.fn(async () => ({ ok: true })),
      dispose: jest.fn(async () => undefined),
      drainRuntimeEvents: jest.fn(() => []),
      executeOperation: jest.fn(),
      handleEvent: jest.fn(),
      health: jest.fn(async () => {
        throw new Error('Bestdori unavailable');
      }),
      load: jest.fn(async () => ({ ok: true })),
    };
    const healthyWorker = {
      activate: jest.fn(async () => ({ ok: true })),
      deactivate: jest.fn(async () => ({ ok: true })),
      dispose: jest.fn(async () => undefined),
      drainRuntimeEvents: jest.fn(() => []),
      executeOperation: jest.fn(async () => ({ replyText: 'ok' })),
      handleEvent: jest.fn(async () => true),
      health: jest.fn(async () => ({ ok: true })),
      load: jest.fn(async () => ({ ok: true })),
    };
    const runtimeFactory = {
      create: jest.fn((_installation, version) =>
        version.manifestJson.pluginKey === 'failing-plugin'
          ? failingWorker
          : healthyWorker,
      ),
    };
    const packageSource = {
      discoverPackages: jest.fn(async () =>
        [failingManifest, healthyManifest].map((manifest) => ({
          entry: manifest.entry,
          entryFile: `D:/plugins/${manifest.pluginKey}/src/index.ts`,
          manifest,
          packageRoot: `D:/plugins/${manifest.pluginKey}`,
          pluginKey: manifest.pluginKey,
        })),
      ),
    };
    const service = createPlatformService(
      pluginRepository,
      versionRepository,
      installationRepository,
      { update: jest.fn(async () => ({ affected: 1 })) },
      { update: jest.fn(async () => ({ affected: 1 })) },
      { find: jest.fn(async () => []) },
      {},
      {},
      runtimeEventRepository,
      undefined,
      runtimeFactory,
      undefined,
      undefined,
      undefined,
      packageSource,
    ) as PluginPlatformService;

    await expect(service.onModuleInit()).resolves.toBeUndefined();

    expect(failingWorker.dispose).toHaveBeenCalled();
    expect(healthyWorker.health).toHaveBeenCalled();
    await expect(
      service.executeOperation({
        input: {},
        operationKey: 'healthy-plugin.echo',
        pluginKey: 'healthy-plugin',
      }),
    ).resolves.toEqual({ replyText: 'ok' });
    expect(runtimeEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'builtin-start-failed',
          level: 'error',
          safeSummary: expect.objectContaining({
            message: 'Bestdori unavailable',
          }),
        }),
      ]),
    );
  });

  it('persists built-in installations before syncing manifest tasks', async () => {
    const manifest = {
      assets: [],
      configSchema: {},
      entry: 'src/index.ts',
      events: [],
      legacyAliases: [],
      migrations: [],
      minApiSdkVersion: '1.0.0',
      name: 'Demo Plugin',
      operations: [],
      permissions: ['runtime.http'],
      pluginKey: 'demo-plugin',
      runtime: {
        maxConcurrency: 1,
        memoryMb: 128,
        timeoutMs: 456,
        workerType: 'node-worker',
      },
      tasks: [
        {
          defaultCron: '0 */6 * * *',
          enabled: true,
          handlerName: 'syncDemo',
          key: 'demo-plugin.sync',
          name: '同步 Demo',
          permissions: ['runtime.http'],
          timeoutMs: 120000,
        },
      ],
      version: '0.1.0',
    };
    const createRepository = (ids: string[]) => {
      const rows: any[] = [];
      return {
        find: jest.fn(async () => rows),
        findAndCount: jest.fn(async () => [rows, rows.length]),
        findOne: jest.fn(
          async ({ where }: any) =>
            rows.find((row) =>
              Object.entries(where || {}).every(
                ([key, value]) => row[key] === value,
              ),
            ) || null,
        ),
        save: jest.fn(async (value: any) => {
          const saved = { id: value.id || ids.shift(), ...value };
          rows.push(saved);
          return saved;
        }),
        update: jest.fn(async () => ({ affected: 1 })),
      };
    };
    const pluginRepository = createRepository(['2041700000000200001']);
    const versionRepository = createRepository(['2041700000000200002']);
    const installationRepository = createRepository(['2041700000000200003']);
    const worker = {
      activate: jest.fn(async () => ({ ok: true })),
      deactivate: jest.fn(async () => ({ ok: true })),
      dispose: jest.fn(async () => undefined),
      drainRuntimeEvents: jest.fn(() => []),
      health: jest.fn(async () => ({ ok: true })),
      load: jest.fn(async () => ({ ok: true })),
    };
    const taskSynchronizer = {
      syncManifestTasks: jest.fn(async () => []),
    };
    const service = createPlatformService(
      pluginRepository,
      versionRepository,
      installationRepository,
      createRepository([]),
      createRepository([]),
      createRepository([]),
      createRepository([]),
      createRepository([]),
      createRepository([]),
      undefined,
      {
        create: jest.fn(() => worker),
      },
      undefined,
      undefined,
      undefined,
      createPackageSource(manifest),
      taskSynchronizer,
      {
        syncTaskScheduler: jest.fn(),
      },
    ) as PluginPlatformService;

    await service.onModuleInit();

    expect(pluginRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginKey: 'demo-plugin',
        status: 'installed',
      }),
    );
    expect(versionRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: '2041700000000200001',
        version: '0.1.0',
      }),
    );
    expect(installationRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: '2041700000000200001',
        status: 'enabled',
        versionId: '2041700000000200002',
      }),
    );
    expect(taskSynchronizer.syncManifestTasks).toHaveBeenCalledWith({
      installationId: '2041700000000200003',
      manifestTasks: manifest.tasks,
      pluginId: '2041700000000200001',
    });
  });

  it('clears built-in worker contexts when a persisted installation disables the same plugin', async () => {
    const manifest = {
      assets: [],
      configSchema: {},
      entry: 'src/index.ts',
      events: [],
      legacyAliases: ['demoLegacy'],
      migrations: [],
      minApiSdkVersion: '1.0.0',
      name: 'Demo Plugin',
      operations: [
        {
          handlerName: 'echo',
          key: 'demo-plugin.echo',
          name: 'Echo',
          permissions: ['bot.reply'],
          timeoutMs: 123,
        },
      ],
      permissions: ['bot.reply'],
      pluginKey: 'demo-plugin',
      runtime: {
        maxConcurrency: 1,
        memoryMb: 128,
        timeoutMs: 456,
        workerType: 'node-worker',
      },
      version: '0.1.0',
    };
    const plugin = {
      id: 'plugin-enabled',
      pluginKey: 'demo-plugin',
    };
    const installation = {
      id: 'installation-enabled',
      installedPath: 'D:/plugins/demo-plugin',
      pluginId: plugin.id,
      runtimeStatus: 'healthy',
      status: 'enabled',
      versionId: 'version-enabled',
    };
    const createRepository = (
      rows: unknown[] = [],
      findOneValue?: unknown,
    ) => ({
      find: jest.fn(async () => rows),
      findAndCount: jest.fn(async () => [rows, rows.length]),
      findOne: jest.fn(async () => findOneValue || null),
      save: jest.fn(async (value) => value),
      update: jest.fn(async () => ({ affected: 1 })),
    });
    const descriptorWorker = {
      activate: jest.fn(async () => ({ ok: true })),
      deactivate: jest.fn(async () => ({ ok: true })),
      dispose: jest.fn(async () => undefined),
      executeOperation: jest.fn(async () => ({ replyText: 'descriptor' })),
      handleEvent: jest.fn(async () => true),
      health: jest.fn(async () => ({ ok: true })),
      load: jest.fn(async () => ({ ok: true })),
    };
    const runtimeFactory = {
      create: jest.fn(() => descriptorWorker),
    };
    const service = createPlatformService(
      createRepository([plugin], plugin),
      createRepository(),
      createRepository([installation], installation),
      createRepository(),
      createRepository(),
      { listBoundPluginKeys: jest.fn(async () => ['demo-plugin']) },
      createRepository(),
      createRepository(),
      createRepository(),
      undefined,
      runtimeFactory,
      undefined,
      undefined,
      undefined,
      createPackageSource(manifest),
    ) as PluginPlatformService;

    await service.onModuleInit();
    await expect(
      service.executeOperation({
        input: { text: 'raw' },
        operationKey: 'demo-plugin.echo',
        pluginKey: 'demoLegacy',
      }),
    ).resolves.toEqual({ replyText: 'descriptor' });

    await service.disableInstallation({ id: installation.id });

    await expect(
      service.executeOperation({
        input: { text: 'raw' },
        operationKey: 'demo-plugin.echo',
        pluginKey: 'demoLegacy',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        msg: 'Bot 插件运行时未启用：demoLegacy',
      }),
    });
    expect(descriptorWorker.deactivate).toHaveBeenCalled();
    expect(descriptorWorker.dispose).toHaveBeenCalled();
    expect(descriptorWorker.executeOperation).toHaveBeenCalledTimes(1);
  });

  it('replaces the descriptor-discovered worker when a real installation is enabled later', async () => {
    const manifest = {
      assets: [],
      configSchema: {},
      entry: 'src/index.ts',
      events: [
        {
          eventName: 'message',
          handlerName: 'handleMessage',
          key: 'demo-plugin.message',
          name: '消息事件',
        },
      ],
      legacyAliases: ['demoLegacy'],
      migrations: [],
      minApiSdkVersion: '1.0.0',
      name: 'Demo Plugin',
      operations: [
        {
          handlerName: 'echo',
          key: 'demo-plugin.echo',
          name: 'Echo',
          permissions: ['bot.reply'],
          timeoutMs: 123,
        },
      ],
      permissions: ['bot.reply', 'bot.event.receive'],
      pluginKey: 'demo-plugin',
      runtime: {
        maxConcurrency: 1,
        memoryMb: 128,
        timeoutMs: 456,
        workerType: 'node-worker',
      },
      version: '0.1.0',
    };
    const plugin = {
      id: 'plugin-late',
      pluginKey: 'demo-plugin',
    };
    const installation = {
      id: 'installation-late',
      installedPath: 'D:/plugins/demo-plugin',
      pluginId: plugin.id,
      runtimeStatus: 'stopped',
      status: 'installed',
      versionId: 'version-late',
    };
    const version = {
      id: 'version-late',
      manifestJson: manifest,
      packageHash: 'hash',
      pluginId: plugin.id,
      version: manifest.version,
    };
    const createRepository = (
      rows: unknown[] = [],
      findOneValue?: unknown,
    ) => ({
      find: jest.fn(async () => rows),
      findAndCount: jest.fn(async () => [rows, rows.length]),
      findOne: jest.fn(async () => findOneValue || null),
      save: jest.fn(async (value) => value),
      update: jest.fn(async () => ({ affected: 1 })),
    });
    const defaultWorker = {
      activate: jest.fn(async () => ({ ok: true })),
      deactivate: jest.fn(async () => ({ ok: true })),
      dispose: jest.fn(async () => undefined),
      executeOperation: jest.fn(async () => ({ replyText: 'default' })),
      handleEvent: jest.fn(async () => true),
      health: jest.fn(async () => ({ ok: true })),
      load: jest.fn(async () => ({ ok: true })),
    };
    const realWorker = {
      activate: jest.fn(async () => ({ ok: true })),
      deactivate: jest.fn(async () => ({ ok: true })),
      dispose: jest.fn(async () => undefined),
      executeOperation: jest.fn(async () => ({ replyText: 'real' })),
      handleEvent: jest.fn(async () => true),
      health: jest.fn(async () => ({ ok: true })),
      load: jest.fn(async () => ({ ok: true })),
    };
    const runtimeFactory = {
      create: jest
        .fn()
        .mockReturnValueOnce(defaultWorker)
        .mockReturnValueOnce(realWorker),
    };
    const service = createPlatformService(
      createRepository([plugin], plugin),
      createRepository([], version),
      createRepository([], installation),
      createRepository(),
      createRepository(),
      { listBoundPluginKeys: jest.fn(async () => ['demo-plugin']) },
      createRepository(),
      createRepository(),
      createRepository(),
      undefined,
      runtimeFactory,
      undefined,
      undefined,
      undefined,
      createPackageSource(manifest),
    ) as PluginPlatformService;

    await service.onModuleInit();
    await expect(
      service.executeOperation({
        input: { text: 'raw' },
        operationKey: 'demo-plugin.echo',
        pluginKey: 'demoLegacy',
      }),
    ).resolves.toEqual({ replyText: 'default' });

    await service.enableInstallation({ id: installation.id });
    await expect(
      service.executeOperation({
        input: { text: 'raw' },
        operationKey: 'demo-plugin.echo',
        pluginKey: 'demoLegacy',
      }),
    ).resolves.toEqual({ replyText: 'real' });

    expect(defaultWorker.deactivate).toHaveBeenCalled();
    expect(defaultWorker.dispose).toHaveBeenCalled();
    expect(realWorker.executeOperation).toHaveBeenCalledTimes(1);

    const operations = await service.listActiveOperations();
    expect(
      operations.filter((operation) => operation.pluginKey === 'demo-plugin'),
    ).toHaveLength(2);

    await service.dispatchEvent({
      event: {
        conversationKey: 'conversation-late',
        eventId: 'msg-late',
        isSelf: false,
        links: [],
        metadata: {},
        rawText: 'hello',
        scope: 'group',
        senderKey: 'sender-late',
        text: 'hello',
      },
      eventKey: 'message',
      pluginKeys: ['demo-plugin'],
    });
    expect(defaultWorker.handleEvent).not.toHaveBeenCalled();
    expect(realWorker.handleEvent).toHaveBeenCalledTimes(1);

    await service.disableInstallation({ id: installation.id });
    expect(await service.listActiveOperations()).toEqual([]);
  });

  it('filters active operation pages by legacy plugin aliases', async () => {
    const manifest = {
      assets: [],
      configSchema: {},
      entry: 'src/index.ts',
      events: [],
      legacyAliases: ['demoLegacy'],
      migrations: [],
      minApiSdkVersion: '1.0.0',
      name: 'Demo Plugin',
      operations: [
        {
          handlerName: 'echo',
          key: 'demo-plugin.echo',
          name: 'Echo',
          permissions: ['bot.reply'],
          timeoutMs: 123,
        },
      ],
      permissions: ['bot.reply'],
      pluginKey: 'demo-plugin',
      runtime: {
        maxConcurrency: 1,
        memoryMb: 128,
        timeoutMs: 456,
        workerType: 'node-worker',
      },
      version: '0.1.0',
    };
    const createRepository = (findOneValue?: unknown) => ({
      find: jest.fn(async () => []),
      findAndCount: jest.fn(async () => [[], 0]),
      findOne: jest.fn(async () => findOneValue || null),
      save: jest.fn(async (value) => value),
      update: jest.fn(async () => ({ affected: 1 })),
    });
    const worker = {
      activate: jest.fn(async () => ({ ok: true })),
      deactivate: jest.fn(async () => ({ ok: true })),
      dispose: jest.fn(async () => undefined),
      executeOperation: jest.fn(),
      handleEvent: jest.fn(),
      health: jest.fn(async () => ({ ok: true })),
      load: jest.fn(async () => ({ ok: true })),
    };
    const service = createPlatformService(
      createRepository({ id: 'plugin-alias', pluginKey: 'demo-plugin' }),
      createRepository({
        id: 'version-alias',
        manifestJson: manifest,
        packageHash: 'hash',
        pluginId: 'plugin-alias',
        version: manifest.version,
      }),
      createRepository({
        id: 'installation-alias',
        installedPath: 'D:/plugins/demo-plugin',
        pluginId: 'plugin-alias',
        runtimeStatus: 'stopped',
        status: 'installed',
        versionId: 'version-alias',
      }),
      createRepository(),
      createRepository(),
      createRepository(),
      createRepository(),
      createRepository(),
      createRepository(),
      undefined,
      {
        create: jest.fn(() => worker),
      },
    ) as PluginPlatformService;

    await service.enableInstallation({ id: 'installation-alias' });

    await expect(service.listPluginSummaries('demoLegacy')).resolves.toEqual([
      expect.objectContaining({
        key: 'demo-plugin',
        name: 'Demo Plugin',
        operationCount: 1,
        triggerMode: 'command',
      }),
    ]);
    await expect(service.listPluginHealth('demoLegacy')).resolves.toEqual([
      expect.objectContaining({
        name: 'Demo Plugin',
        pluginKey: 'demo-plugin',
        status: 'healthy',
        triggerMode: 'command',
      }),
    ]);
    await expect(
      service.listOperationSummaries({ pluginKey: 'demoLegacy' }),
    ).resolves.toEqual([
      expect.objectContaining({
        key: 'demo-plugin.echo',
        pluginKey: 'demo-plugin',
      }),
    ]);
    await expect(
      service.pageOperationSummaries({
        pageNo: 1,
        pageSize: 10,
        pluginKey: 'demoLegacy',
      }),
    ).resolves.toMatchObject({
      total: 1,
    });
  });

  it('disposes the previous worker after a successful upgrade on the same installation', async () => {
    const manifest = {
      assets: [],
      configSchema: {},
      entry: 'src/index.ts',
      events: [],
      legacyAliases: ['demoLegacy'],
      migrations: [],
      minApiSdkVersion: '1.0.0',
      name: 'Demo Plugin',
      operations: [
        {
          handlerName: 'echo',
          key: 'demo-plugin.echo',
          name: 'Echo',
          permissions: ['bot.reply'],
          timeoutMs: 123,
        },
      ],
      permissions: ['bot.reply'],
      pluginKey: 'demo-plugin',
      runtime: {
        maxConcurrency: 1,
        memoryMb: 128,
        timeoutMs: 456,
        workerType: 'node-worker',
      },
      version: '0.1.0',
    };
    const installation = {
      id: 'installation-upgrade-success',
      installedPath: 'D:/plugins/demo-plugin',
      pluginId: 'plugin-upgrade-success',
      runtimeStatus: 'stopped',
      status: 'installed',
      versionId: 'version-upgrade-success',
    };
    const version = {
      id: 'version-upgrade-success',
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
    const oldWorker = {
      activate: jest.fn(async () => ({ ok: true })),
      deactivate: jest.fn(async () => ({ ok: true })),
      dispose: jest.fn(async () => undefined),
      executeOperation: jest.fn(async () => ({ replyText: 'old' })),
      handleEvent: jest.fn(async () => true),
      health: jest.fn(async () => ({ ok: true })),
      load: jest.fn(async () => ({ ok: true })),
    };
    const newWorker = {
      activate: jest.fn(async () => ({ ok: true })),
      deactivate: jest.fn(async () => ({ ok: true })),
      dispose: jest.fn(async () => undefined),
      executeOperation: jest.fn(async () => ({ replyText: 'new' })),
      handleEvent: jest.fn(async () => true),
      health: jest.fn(async () => ({ ok: true })),
      load: jest.fn(async () => ({ ok: true })),
    };
    const runtimeFactory = {
      create: jest
        .fn()
        .mockReturnValueOnce(oldWorker)
        .mockReturnValueOnce(newWorker),
    };
    const service = createPlatformService(
      createRepository({ id: installation.pluginId, pluginKey: 'demo-plugin' }),
      createRepository(version),
      createRepository(installation),
      createRepository(),
      createRepository(),
      createRepository(),
      createRepository(),
      createRepository(),
      createRepository(),
      undefined,
      runtimeFactory,
    ) as PluginPlatformService;

    await service.enableInstallation({ id: installation.id });
    await expect(
      service.executeOperation({
        input: { text: 'raw' },
        operationKey: 'demo-plugin.echo',
        pluginKey: 'demoLegacy',
      }),
    ).resolves.toEqual({ replyText: 'old' });

    await service.upgradeInstallation({ id: installation.id });

    expect(oldWorker.deactivate).toHaveBeenCalled();
    expect(oldWorker.dispose).toHaveBeenCalled();
    await expect(
      service.executeOperation({
        input: { text: 'raw' },
        operationKey: 'demo-plugin.echo',
        pluginKey: 'demoLegacy',
      }),
    ).resolves.toEqual({ replyText: 'new' });
    expect(oldWorker.executeOperation).toHaveBeenCalledTimes(1);
    expect(newWorker.executeOperation).toHaveBeenCalledTimes(1);
  });

  it('blocks command execution and event dispatch for inactive plugins', async () => {
    const commandPlugin = {
      key: 'demo-plugin',
      name: 'Demo Plugin',
      operations: [
        {
          execute: jest.fn(async () => ({ replyText: 'ok' })),
          key: 'demo.echo',
          name: 'echo',
        },
      ],
      version: '0.1.0',
    };
    const commandRegistry = new PluginRegistryService();
    commandRegistry.register(commandPlugin);
    await commandRegistry.onModuleInit();

    await expect(
      commandRegistry.execute('demo-plugin', 'demo.echo', {}, {}),
    ).resolves.toEqual({ replyText: 'ok' });

    commandRegistry.setPluginActive('demo-plugin', false);

    expect(commandRegistry.listOperations('demo-plugin')).toEqual([]);
    await expect(
      commandRegistry.execute('demo-plugin', 'demo.echo', {}, {}),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        msg: 'Bot 插件未启用：demo-plugin',
      }),
    });
    expect(commandPlugin.operations[0].execute).toHaveBeenCalledTimes(1);

    const eventRegistry = new PluginEventRegistryService();
    eventRegistry.registerRuntimeEvents('repeater', [
      {
        description: 'repeat messages',
        key: 'repeater',
        name: 'Repeater',
        triggerType: 'message',
        version: '0.1.0',
      },
    ]);

    expect(eventRegistry.listOperations('repeater')).toHaveLength(1);

    eventRegistry.setPluginActive('repeater', false);

    expect(eventRegistry.listOperations('repeater')).toEqual([]);
  });

  it('hydrates inactive command and event plugin keys from persisted installation state on startup', async () => {
    const commandPlugin = {
      key: 'demo-plugin',
      name: 'Demo Plugin',
      operations: [
        {
          execute: jest.fn(async () => ({ replyText: 'ok' })),
          key: 'demo.echo',
          name: 'echo',
        },
      ],
      version: '0.1.0',
    };
    const createRepository = (rows: unknown[] = []) => ({
      find: jest.fn(async () => rows),
    });
    const pluginRepository = createRepository([
      { id: 'plugin-command', pluginKey: 'demo-plugin' },
      { id: 'plugin-event', pluginKey: 'repeater' },
    ]);
    const installationRepository = createRepository([
      { pluginId: 'plugin-command', status: 'disabled' },
      { pluginId: 'plugin-event', status: 'disabled' },
    ]);
    const commandRegistry = new PluginRegistryService(
      pluginRepository as any,
      installationRepository as any,
    );
    commandRegistry.register(commandPlugin);

    await commandRegistry.onModuleInit();

    expect(commandRegistry.listOperations('demo-plugin')).toEqual([]);
    await expect(
      commandRegistry.execute('demo-plugin', 'demo.echo', {}, {}),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        msg: 'Bot 插件未启用：demo-plugin',
      }),
    });

    const eventRegistry = new (PluginEventRegistryService as any)(
      pluginRepository,
      installationRepository,
    ) as PluginEventRegistryService;
    eventRegistry.registerRuntimeEvents('repeater', [
      {
        description: 'repeat messages',
        key: 'repeater',
        name: 'Repeater',
        triggerType: 'message',
        version: '0.1.0',
      },
    ]);

    await eventRegistry.onModuleInit();

    expect(eventRegistry.listOperations('repeater')).toEqual([]);
  });

  it('does not activate legacy command plugins that are persisted inactive on startup', async () => {
    const commandPlugin = {
      activate: jest.fn(async () => undefined),
      key: 'demo-plugin',
      name: 'Demo Plugin',
      operations: [
        {
          execute: jest.fn(async () => ({ replyText: 'ok' })),
          key: 'demo.echo',
          name: 'echo',
        },
      ],
      version: '0.1.0',
    };
    const createRepository = (rows: unknown[] = []) => ({
      find: jest.fn(async () => rows),
    });
    const commandRegistry = new PluginRegistryService(
      createRepository([
        { id: 'plugin-command', pluginKey: 'demo-plugin' },
      ]) as any,
      createRepository([
        { pluginId: 'plugin-command', status: 'disabled' },
      ]) as any,
    );
    commandRegistry.register(commandPlugin);

    await commandRegistry.onModuleInit();

    expect(commandPlugin.activate).not.toHaveBeenCalled();
    expect(commandRegistry.listOperations('demo-plugin')).toEqual([]);
  });

  it('keeps the previous active worker when upgrade health check fails', async () => {
    const installation = {
      id: 'installation-upgrade',
      installedPath: 'D:/plugins/demo-plugin',
      pluginId: 'plugin-upgrade',
      runtimeStatus: 'healthy',
      status: 'enabled',
      versionId: 'version-upgrade',
    };
    const version = {
      id: 'version-upgrade',
      manifestJson: {
        assets: [],
        configSchema: {},
        entry: 'src/index.ts',
        events: [],
        legacyAliases: [],
        migrations: [],
        minApiSdkVersion: '1.0.0',
        name: 'Demo Plugin',
        operations: [],
        permissions: [],
        pluginKey: 'demo-plugin',
        runtime: {
          maxConcurrency: 1,
          memoryMb: 128,
          timeoutMs: 5000,
          workerType: 'node-worker',
        },
        version: '0.2.0',
      },
      packageHash: 'hash',
      pluginId: installation.pluginId,
      version: '0.2.0',
    };
    const createRepository = (findOneValue?: unknown) => ({
      find: jest.fn(async () => []),
      findAndCount: jest.fn(async () => [[], 0]),
      findOne: jest.fn(async () => findOneValue),
      save: jest.fn(async (value) => value),
      update: jest.fn(async () => ({ affected: 1 })),
    });
    const installationRepository = createRepository(installation);
    const versionRepository = createRepository(version);
    const activeWorker = {
      activate: jest.fn(async () => ({ ok: true })),
      deactivate: jest.fn(async () => ({ ok: true })),
      dispose: jest.fn(async () => undefined),
      health: jest.fn(async () => ({ ok: true })),
      load: jest.fn(async () => ({ ok: true })),
    };
    const failingWorker = {
      activate: jest.fn(async () => ({ ok: true })),
      deactivate: jest.fn(async () => ({ ok: true })),
      dispose: jest.fn(async () => undefined),
      health: jest.fn(async () => {
        throw new Error('health failed');
      }),
      load: jest.fn(async () => ({ ok: true })),
    };
    const runtimeFactory = {
      create: jest
        .fn()
        .mockReturnValueOnce(activeWorker)
        .mockReturnValueOnce(failingWorker),
    };
    const service = createPlatformService(
      createRepository(),
      versionRepository,
      installationRepository,
      createRepository(),
      createRepository(),
      createRepository(),
      createRepository(),
      createRepository(),
      createRepository(),
      undefined,
      runtimeFactory,
    ) as PluginPlatformService;

    await service.enableInstallation({ id: installation.id });
    await expect(
      service.upgradeInstallation({ id: installation.id }),
    ).rejects.toThrow('health failed');

    expect(activeWorker.deactivate).not.toHaveBeenCalled();
    expect(activeWorker.dispose).not.toHaveBeenCalled();
    expect(failingWorker.dispose).toHaveBeenCalled();
    expect(installationRepository.update).toHaveBeenLastCalledWith(
      { id: installation.id },
      { runtimeStatus: 'healthy', status: 'enabled' },
    );
  });
});

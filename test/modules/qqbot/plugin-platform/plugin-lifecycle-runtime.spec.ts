import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { MODULE_METADATA } from '@nestjs/common/constants';
import {
  QQBOT_PLUGIN_RUNTIME_FACTORY,
} from '../../../../src/modules/qqbot/plugin-platform/application/plugin-platform.service';
import { QqbotPluginPlatformService } from '../../../../src/modules/qqbot/plugin-platform/application/plugin-platform.service';
import { QqbotEventPluginRegistryService } from '../../../../src/modules/qqbot/plugin-platform/application/registry/qqbot-event-plugin-registry.service';
import { QqbotPluginRegistryService } from '../../../../src/modules/qqbot/plugin-platform/application/registry/qqbot-plugin-registry.service';
import { QqbotPluginPlatformModule } from '../../../../src/modules/qqbot/plugin-platform/plugin-platform.module';
import { QqbotBuiltinPluginPackageLoaderService } from '../../../../src/modules/qqbot/plugin-platform/infrastructure/integration/package/builtin-plugin-package-loader.service';
import { QqbotBuiltinPluginWorkerRuntimeFactoryService } from '../../../../src/modules/qqbot/plugin-platform/infrastructure/integration/runtime';

const repoRoot = join(__dirname, '../../../..');

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

describe('QQBot plugin platform lifecycle runtime contract', () => {
  it('registers the default worker runtime factory in the Nest module', () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      QqbotPluginPlatformModule,
    ) as unknown[];

    expect(providers).toEqual(
      expect.arrayContaining([
        QqbotBuiltinPluginWorkerRuntimeFactoryService,
        expect.objectContaining({
          provide: QQBOT_PLUGIN_RUNTIME_FACTORY,
          useExisting: QqbotBuiltinPluginWorkerRuntimeFactoryService,
        }),
      ]),
    );
  });

  it('keeps the default worker runtime factory dependency visible to Nest DI', () => {
    const dependencies = Reflect.getMetadata(
      'design:paramtypes',
      QqbotBuiltinPluginWorkerRuntimeFactoryService,
    );

    expect(dependencies?.[0]).toBe(QqbotBuiltinPluginPackageLoaderService);
  });

  it('uses dedicated lifecycle use cases instead of direct status flips', () => {
    const controller = readSource(
      'src/modules/qqbot/plugin-platform/contract/plugin-platform.controller.ts',
    );
    const service = readSource(
      'src/modules/qqbot/plugin-platform/application/plugin-platform.service.ts',
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
      readSource('src/modules/qqbot/plugin-platform/application/plugin-platform.service.ts'),
      readSource('src/modules/qqbot/plugin-platform/infrastructure/integration/runtime/worker-runtime.ts'),
    ].join('\n');

    const missingRuntimeSignals = [
      'QqbotPluginWorkerRuntime',
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
      'src/modules/qqbot/plugin-platform/application/plugin-platform.service.ts',
    );

    const missingExecutorSignals = [
      'executeOperation',
      'dispatchEvent',
      'runtimeEventRepository',
      'command log',
    ].filter((signal) => !source.includes(signal));

    expect(missingExecutorSignals).toEqual([]);
  });

  it('keeps event plugin dispatch generic instead of hard-coding repeater', () => {
    const source = readSource(
      'src/modules/qqbot/plugin-platform/application/registry/qqbot-event-plugin-registry.service.ts',
    );

    expect(source).toContain('registerEventPlugin');
    expect(source).not.toMatch(/pluginKey\s*===\s*['"]repeater['"]/);
    expect(source).not.toContain('getRepeaterPlugin');
  });

  it('keeps plugin-specific argument parsing inside plugin packages', () => {
    const sources = collectSourceFiles(
      'src/modules/qqbot/plugin-platform/application/argument',
    )
      .concat(
        collectSourceFiles(
          'src/modules/qqbot/plugin-platform/infrastructure/integration/argument',
        ),
      )
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');

    expect(sources).not.toMatch(/DictService/);
    expect(sources).not.toMatch(/modules\/qqbot\/plugins\/ff14-market/);
    expect(sources).not.toMatch(/modules\/qqbot\/plugins\/fflogs/);
    expect(sources).not.toMatch(
      new RegExp([`parseQqbot${'Ff14'}`, `parseQqbot${'Fflogs'}`].join('|')),
    );
  });

  it('loads, activates, health-checks, refreshes, and disposes workers during lifecycle transitions', async () => {
    const manifest = {
      entry: 'src/index.ts',
      pluginKey: 'demo-plugin',
      version: '0.1.0',
    };
    const installation = {
      id: 'installation-1',
      installedPath: 'D:/plugins/demo-plugin',
      pluginId: 'plugin-1',
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
    const worker = {
      activate: jest.fn(async () => ({ ok: true })),
      deactivate: jest.fn(async () => ({ ok: true })),
      dispose: jest.fn(async () => undefined),
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
      setPluginActive: jest.fn(),
    };
    const service = new (QqbotPluginPlatformService as any)(
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
    ) as QqbotPluginPlatformService;

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
    const commandRegistry = new QqbotPluginRegistryService({
      loadCommandPlugins: () => [commandPlugin],
    } as any);
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
        msg: 'QQBot 插件未启用：demo-plugin',
      }),
    });
    expect(commandPlugin.operations[0].execute).toHaveBeenCalledTimes(1);

    const repeaterPlugin = {
      bind: jest.fn(async () => true),
      getDefinition: () => ({
        description: 'repeat messages',
        key: 'repeater',
        name: 'Repeater',
        triggerType: 'message',
        version: '0.1.0',
      }),
      getSummary: jest.fn(),
      handleMessage: jest.fn(async () => true),
      unbind: jest.fn(async () => true),
    };
    const eventRegistry = new QqbotEventPluginRegistryService(
      {
        allEnabled: jest.fn(async () => []),
        findBySelfId: jest.fn(),
      } as any,
      {
        loadEventPlugins: () => [repeaterPlugin],
      } as any,
    );

    await expect(
      eventRegistry.dispatchMessage({ messageType: 'group' } as any),
    ).resolves.toBe(true);

    eventRegistry.setPluginActive('repeater', false);

    expect(eventRegistry.listOperations('repeater')).toEqual([]);
    await expect(
      eventRegistry.dispatchMessage({ messageType: 'group' } as any),
    ).resolves.toBe(false);
    await expect(eventRegistry.bind('repeater', '10000')).rejects.toMatchObject(
      {
        response: expect.objectContaining({
          msg: 'QQBot 事件插件未启用：repeater',
        }),
      },
    );
    expect(repeaterPlugin.handleMessage).toHaveBeenCalledTimes(1);
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
    const commandRegistry = new (QqbotPluginRegistryService as any)(
      {
        loadCommandPlugins: () => [commandPlugin],
      },
      pluginRepository,
      installationRepository,
    ) as QqbotPluginRegistryService;

    await commandRegistry.onModuleInit();

    expect(commandRegistry.listOperations('demo-plugin')).toEqual([]);
    await expect(
      commandRegistry.execute('demo-plugin', 'demo.echo', {}, {}),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        msg: 'QQBot 插件未启用：demo-plugin',
      }),
    });

    const repeaterPlugin = {
      bind: jest.fn(async () => true),
      getDefinition: () => ({
        description: 'repeat messages',
        key: 'repeater',
        name: 'Repeater',
        triggerType: 'message',
        version: '0.1.0',
      }),
      getSummary: jest.fn(),
      handleMessage: jest.fn(async () => true),
      unbind: jest.fn(async () => true),
    };
    const eventRegistry = new (QqbotEventPluginRegistryService as any)(
      {
        allEnabled: jest.fn(async () => []),
        findBySelfId: jest.fn(),
      },
      {
        loadEventPlugins: () => [repeaterPlugin],
      },
      pluginRepository,
      installationRepository,
    ) as QqbotEventPluginRegistryService;

    await eventRegistry.onModuleInit();

    expect(eventRegistry.listOperations('repeater')).toEqual([]);
    await expect(
      eventRegistry.dispatchMessage({ messageType: 'group' } as any),
    ).resolves.toBe(false);
    await expect(eventRegistry.bind('repeater', '10000')).rejects.toMatchObject(
      {
        response: expect.objectContaining({
          msg: 'QQBot 事件插件未启用：repeater',
        }),
      },
    );
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
        entry: 'src/index.ts',
        pluginKey: 'demo-plugin',
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
    const service = new (QqbotPluginPlatformService as any)(
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
    ) as QqbotPluginPlatformService;

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

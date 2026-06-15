import { readFileSync } from 'fs';
import { join } from 'path';
import { QqbotPluginPlatformService } from '../../../../src/modules/qqbot/plugin-platform/application/plugin-platform.service';

const repoRoot = join(__dirname, '../../../..');

const readSource = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), 'utf8');

describe('QQBot plugin platform lifecycle runtime contract', () => {
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
    const pluginRepository = createRepository();
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
    expect(runtimeEventRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'enable-finished',
        installationId: installation.id,
        pluginId: installation.pluginId,
      }),
    );

    await service.disableInstallation({ id: installation.id });
    expect(worker.deactivate).toHaveBeenCalled();
    expect(worker.dispose).toHaveBeenCalled();
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

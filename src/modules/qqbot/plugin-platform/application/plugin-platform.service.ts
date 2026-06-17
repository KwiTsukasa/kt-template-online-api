import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { throwVbenError } from '@/common';
import {
  type QqbotPluginEventDispatchInput,
  type QqbotPluginExecutionInput,
  type QqbotPluginExecutionPort,
  type QqbotPluginOperationLookup,
} from '@/modules/qqbot/core/domain/plugin-execution.port';
import type {
  QqbotPluginOperationSummary,
  QqbotPluginTriggerMode,
} from '@/modules/qqbot/core/contract/qqbot.types';
import {
  parseQqbotPluginManifest,
  type QqbotPluginManifest,
} from '../domain/manifest';
import type {
  QqbotPluginRuntimeEvent as QqbotPluginWorkerRuntimeEvent,
  QqbotPluginWorkerRuntime,
} from '../infrastructure/integration/runtime';
import { QqbotPluginTaskManifestSynchronizer } from './task/qqbot-plugin-task-manifest.synchronizer';
import { QqbotPluginTaskSchedulerService } from './task/qqbot-plugin-task-scheduler.service';
import type { QqbotPluginTaskTriggerType } from './task/qqbot-plugin-task.types';
import { QqbotPluginArgumentParserService } from './argument/qqbot-plugin-argument-parser.service';
import { QqbotBuiltinPluginPackageLoaderService } from '../infrastructure/integration/package/builtin-plugin-package-loader.service';
import { QqbotPluginPackageReaderService } from '../infrastructure/integration/package/plugin-package-reader.service';
import { QqbotEventPluginRegistryService } from './registry/qqbot-event-plugin-registry.service';
import { resolveInactivePluginKeys } from './registry/plugin-installation-state';
import { QqbotPluginRegistryService } from './registry/qqbot-plugin-registry.service';
import {
  QqbotPlugin,
  QqbotPluginAccountBinding,
  QqbotPluginAsset,
  QqbotPluginConfig,
  QqbotPluginEventHandler,
  QqbotPluginInstallation,
  QqbotPluginOperation,
  QqbotPluginRuntimeEvent,
  QqbotPluginVersion,
  type QqbotPluginInstallStatus,
  type QqbotPluginRuntimeEventLevel,
  type QqbotPluginRuntimeStatus,
} from '../infrastructure/persistence';

export const QQBOT_PLUGIN_RUNTIME_FACTORY = Symbol(
  'QQBOT_PLUGIN_RUNTIME_FACTORY',
);

export type QqbotPluginRuntimeFactory = {
  create(
    installation: QqbotPluginInstallation,
    version: QqbotPluginVersion,
  ): Pick<
    QqbotPluginWorkerRuntime,
    | 'activate'
    | 'deactivate'
    | 'dispose'
    | 'drainRuntimeEvents'
    | 'executeOperation'
    | 'executeTask'
    | 'handleEvent'
    | 'health'
    | 'load'
  >;
};

type ValidateManifestBody = {
  manifest?: unknown;
};

type InstallLocalBody = {
  manifest?: unknown;
  packageHash?: string;
  packagePath?: string;
};

type InstallationActionBody = {
  id?: string;
};

type ListOperationsQuery = {
  pageNo?: number | string;
  pageSize?: number | string;
  pluginId?: string;
  pluginKey?: string;
  triggerMode?: QqbotPluginTriggerMode;
};

type RuntimeEventQuery = {
  endTime?: string;
  eventType?: string;
  installationId?: string;
  level?: QqbotPluginRuntimeEventLevel;
  pluginId?: string;
  startTime?: string;
};

type UpdateConfigBody = {
  configKey?: string;
  pluginId?: string;
  value?: unknown;
};

type ActiveWorkerContext = {
  installationId: string;
  manifest: QqbotPluginManifest;
  pluginId: string;
  pluginKey: string;
  worker: QqbotPluginWorkerRuntime;
};

type PersistedPluginRuntimeState = {
  enabledInstallationsByPluginKey: Map<string, QqbotPluginInstallation>;
  inactivePluginKeys: Set<string>;
};

@Injectable()
export class QqbotPluginPlatformService
  implements OnModuleInit, QqbotPluginExecutionPort
{
  private readonly activeWorkers = new Map<string, QqbotPluginWorkerRuntime>();
  private readonly activeWorkerContexts = new Map<
    string,
    ActiveWorkerContext
  >();
  private readonly activeWorkersByPluginKey = new Map<
    string,
    ActiveWorkerContext
  >();
  private readonly activeWorkerPluginAliases = new Map<string, string>();

  constructor(
    @InjectRepository(QqbotPlugin)
    private readonly pluginRepository: Repository<QqbotPlugin>,
    @InjectRepository(QqbotPluginVersion)
    private readonly versionRepository: Repository<QqbotPluginVersion>,
    @InjectRepository(QqbotPluginInstallation)
    private readonly installationRepository: Repository<QqbotPluginInstallation>,
    @InjectRepository(QqbotPluginOperation)
    private readonly operationRepository: Repository<QqbotPluginOperation>,
    @InjectRepository(QqbotPluginEventHandler)
    private readonly eventHandlerRepository: Repository<QqbotPluginEventHandler>,
    @InjectRepository(QqbotPluginAccountBinding)
    private readonly accountBindingRepository: Repository<QqbotPluginAccountBinding>,
    @InjectRepository(QqbotPluginConfig)
    private readonly configRepository: Repository<QqbotPluginConfig>,
    @InjectRepository(QqbotPluginAsset)
    private readonly assetRepository: Repository<QqbotPluginAsset>,
    @InjectRepository(QqbotPluginRuntimeEvent)
    private readonly runtimeEventRepository: Repository<QqbotPluginRuntimeEvent>,
    @Optional()
    private readonly argumentParser?: QqbotPluginArgumentParserService,
    @Optional()
    @Inject(QQBOT_PLUGIN_RUNTIME_FACTORY)
    private readonly runtimeFactory?: QqbotPluginRuntimeFactory,
    @Optional()
    private readonly pluginRegistry?: QqbotPluginRegistryService,
    @Optional()
    private readonly eventPluginRegistry?: QqbotEventPluginRegistryService,
    @Optional()
    private readonly packageReader?: QqbotPluginPackageReaderService,
    @Optional()
    private readonly builtinPluginLoader?: QqbotBuiltinPluginPackageLoaderService,
    @Optional()
    private readonly taskSynchronizer?: QqbotPluginTaskManifestSynchronizer,
    @Optional()
    private readonly taskScheduler?: QqbotPluginTaskSchedulerService,
  ) {}

  async onModuleInit() {
    await this.startBuiltinWorkers();
  }

  async listInstallations() {
    return this.installationRepository.find();
  }

  async listCapabilities(pluginId?: string) {
    const where = pluginId ? { pluginId } : undefined;
    const [operations, eventHandlers] = await Promise.all([
      this.operationRepository.find({ where }),
      this.eventHandlerRepository.find({ where }),
    ]);
    return {
      eventHandlers,
      operations,
    };
  }

  async listOperations(pluginId?: string) {
    return this.listOperationSummaries({ pluginId });
  }

  async pageOperations(query: ListOperationsQuery) {
    return this.pageOperationSummaries(query);
  }

  async listOperationSummaries(query: ListOperationsQuery = {}) {
    const pluginKey = await this.resolveOperationPluginKeyFilter(query);
    const operations = await this.resolveActiveOperationSummaries();
    return operations.filter(
      (operation) =>
        (!pluginKey || operation.pluginKey === pluginKey) &&
        (!query.triggerMode || operation.triggerMode === query.triggerMode),
    );
  }

  async pageOperationSummaries(query: ListOperationsQuery) {
    const pageNo = Number(query.pageNo || 1);
    const pageSize = Number(query.pageSize || 10);
    const safePageNo = Number.isFinite(pageNo) && pageNo > 0 ? pageNo : 1;
    const safePageSize =
      Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 10;
    const operations = await this.listOperationSummaries(query);
    const skip = (safePageNo - 1) * safePageSize;

    return {
      list: operations.slice(skip, skip + safePageSize),
      pageNo: safePageNo,
      pageSize: safePageSize,
      total: operations.length,
    };
  }

  async listEventHandlers(pluginId?: string) {
    return this.eventHandlerRepository.find({
      where: pluginId ? { pluginId } : undefined,
    });
  }

  validateManifest(body: ValidateManifestBody) {
    return {
      manifest: parseQqbotPluginManifest(body.manifest),
      valid: true,
    };
  }

  uploadPackage(body: InstallLocalBody) {
    return {
      ...this.requirePackageReader().readPackage(body),
      valid: true,
    };
  }

  async installLocal(body: InstallLocalBody) {
    const pluginPackage = this.requirePackageReader().readPackage(body);
    const manifest = pluginPackage.manifest;
    const plugin = await this.pluginRepository.save({
      pluginKey: manifest.pluginKey,
      pluginName: manifest.name,
      description: manifest.description || null,
      status: 'installed',
    });
    const version = await this.versionRepository.save({
      manifestJson: manifest,
      packageHash: pluginPackage.packageHash,
      pluginId: plugin.id,
      version: manifest.version,
    });

    await this.persistManifestCapabilities(plugin.id, manifest);

    const installation = await this.installationRepository.save({
      installedPath: pluginPackage.packagePath,
      pluginId: plugin.id,
      runtimeStatus: 'stopped',
      status: 'installed',
      versionId: version.id,
    });
    await this.syncManifestTasksForInstallation(installation, manifest, false);
    return installation;
  }

  async enableInstallation(body: InstallationActionBody) {
    const installation = await this.requireInstallation(body);
    await this.updateInstallationRuntime(installation, 'enabled', 'starting');
    await this.recordRuntimeEvent(installation, 'enable-started');
    await this.startWorker(installation);
    await this.refreshActiveRegistries(installation, true);
    await this.updateInstallationRuntime(installation, 'enabled', 'healthy');
    await this.recordRuntimeEvent(installation, 'enable-finished');
    return {
      id: installation.id,
      runtimeStatus: 'healthy' as QqbotPluginRuntimeStatus,
      status: 'enabled' as QqbotPluginInstallStatus,
    };
  }

  async disableInstallation(body: InstallationActionBody) {
    const installation = await this.requireInstallation(body);
    await this.stopWorkersForInstallation(installation);
    await this.taskScheduler?.removeSchedulersForInstallation(installation.id);
    await this.refreshActiveRegistries(installation, false);
    await this.updateInstallationRuntime(installation, 'disabled', 'stopped');
    await this.recordRuntimeEvent(installation, 'disable-finished');
    return {
      id: installation.id,
      runtimeStatus: 'stopped' as QqbotPluginRuntimeStatus,
      status: 'disabled' as QqbotPluginInstallStatus,
    };
  }

  async upgradeInstallation(body: InstallationActionBody) {
    const installation = await this.requireInstallation(body);
    const previousWorker = this.activeWorkers.get(installation.id);
    await this.updateInstallationRuntime(installation, 'upgrading', 'starting');
    await this.recordRuntimeEvent(installation, 'upgrade-started');
    try {
      await this.startWorker(installation);
    } catch (error) {
      if (previousWorker) {
        this.activeWorkers.set(installation.id, previousWorker);
        await this.updateInstallationRuntime(
          installation,
          'enabled',
          'healthy',
        );
      }
      await this.recordRuntimeEvent(installation, 'upgrade-failed', 'error', {
        message: error instanceof Error ? error.message : `${error}`,
      });
      throw error;
    }
    await this.refreshActiveRegistries(installation, true);
    await this.updateInstallationRuntime(installation, 'enabled', 'healthy');
    await this.recordRuntimeEvent(installation, 'upgrade-finished');
    return {
      id: installation.id,
      runtimeStatus: 'healthy' as QqbotPluginRuntimeStatus,
      status: 'enabled' as QqbotPluginInstallStatus,
    };
  }

  async uninstallInstallation(body: InstallationActionBody) {
    const installation = await this.requireInstallation(body);
    if (installation.status === 'enabled') {
      throwVbenError('请先禁用插件后再卸载');
    }

    await this.refreshActiveRegistries(installation, false);
    await this.taskScheduler?.removeSchedulersForInstallation(installation.id);
    await this.updateInstallationRuntime(
      installation,
      'uninstalled',
      'stopped',
    );
    await this.recordRuntimeEvent(installation, 'uninstall-finished');
    return {
      id: installation.id,
      runtimeStatus: 'stopped' as QqbotPluginRuntimeStatus,
      status: 'uninstalled' as QqbotPluginInstallStatus,
    };
  }

  async executeOperation(input: QqbotPluginExecutionInput) {
    const normalizedInput =
      (await this.argumentParser?.normalizeInput(input)) || input.input;
    const workerContext = this.requireActiveWorker(input.pluginKey);
    const operation = workerContext.manifest.operations.find(
      (item) => item.key === input.operationKey,
    );
    if (!operation) {
      throwVbenError(
        `QQBot 插件能力不存在：${input.pluginKey}.${input.operationKey}`,
      );
    }

    try {
      const output = await workerContext.worker.executeOperation({
        input: normalizedInput,
        operationId: operation.key,
        operationKey: operation.key,
        timeoutMs: operation.timeoutMs,
      });
      const pluginId = this.getPluginIdFromContext(input.context);
      if (pluginId) {
        await this.runtimeEventRepository.save({
          eventType: 'command log mapped',
          installationId: null,
          level: 'info',
          pluginId,
          safeSummary: {
            operationKey: input.operationKey,
            outputKeys:
              output && typeof output === 'object'
                ? Object.keys(output as Record<string, unknown>).sort()
                : [],
            pluginKey: input.pluginKey,
          },
        });
      }
      return output;
    } finally {
      await this.flushWorkerRuntimeEvents(workerContext);
    }
  }

  async dispatchEvent(input: QqbotPluginEventDispatchInput) {
    let handled = false;
    for (const workerContext of this.activeWorkerContexts.values()) {
      for (const event of workerContext.manifest.events) {
        if (
          event.eventName !== input.eventKey &&
          event.key !== input.eventKey
        ) {
          continue;
        }
        try {
          const result = await workerContext.worker.handleEvent({
            event: input.message,
            eventKey: event.eventName || input.eventKey,
            timeoutMs: workerContext.manifest.runtime.timeoutMs,
          });
          handled = Boolean(result) || handled;
        } finally {
          await this.flushWorkerRuntimeEvents(workerContext);
        }
      }
    }
    return handled;
  }

  async executeTask(input: {
    input: Record<string, unknown>;
    installationId: string;
    pluginId: string;
    taskHandlerName: string;
    taskId: string;
    taskKey: string;
    timeoutMs: number;
    triggerType: QqbotPluginTaskTriggerType;
  }) {
    const workerContext = this.activeWorkerContexts.get(input.installationId);
    if (!workerContext) {
      throwVbenError('插件运行时未启用');
    }
    try {
      return await workerContext.worker.executeTask({
        input: input.input,
        taskHandlerName: input.taskHandlerName,
        taskId: input.taskId,
        taskKey: input.taskKey,
        timeoutMs: input.timeoutMs,
        triggerType: input.triggerType,
      });
    } finally {
      await this.flushWorkerRuntimeEvents(workerContext);
    }
  }

  async listActiveOperations() {
    const workerOperations = this.listActiveWorkerOperations();
    if (workerOperations.length > 0) return workerOperations;
    return [
      ...(this.pluginRegistry?.listOperations() || []),
      ...(this.eventPluginRegistry?.listOperations() || []),
    ];
  }

  async getOperationByCommand(command: QqbotPluginOperationLookup) {
    if (!command.pluginKey || !command.operationKey) return null;
    return (
      (await this.listActiveOperations()).find(
        (operation) =>
          operation.pluginKey ===
            this.resolveActivePluginKey(command.pluginKey) &&
          operation.key === command.operationKey,
      ) || null
    );
  }

  async updateConfig(body: UpdateConfigBody) {
    if (!body.pluginId || !body.configKey) {
      throwVbenError('请选择插件和配置项');
    }

    return this.configRepository.save({
      configKey: body.configKey,
      configValue: body.value === undefined ? null : { value: body.value },
      pluginId: body.pluginId,
    });
  }

  async listRuntimeEvents(query?: RuntimeEventQuery | string) {
    const normalizedQuery =
      typeof query === 'string' ? { pluginId: query } : query || {};
    const where = {
      ...(normalizedQuery.eventType
        ? { eventType: normalizedQuery.eventType }
        : {}),
      ...(normalizedQuery.installationId
        ? { installationId: normalizedQuery.installationId }
        : {}),
      ...(normalizedQuery.level ? { level: normalizedQuery.level } : {}),
      ...(normalizedQuery.pluginId
        ? { pluginId: normalizedQuery.pluginId }
        : {}),
      ...this.buildRuntimeEventTimeFilter(normalizedQuery),
    };

    return this.runtimeEventRepository.find({
      where: Object.keys(where).length ? (where as any) : undefined,
    });
  }

  async listAccountBindings(pluginId?: string) {
    return this.accountBindingRepository.find({
      where: pluginId ? { pluginId } : undefined,
    });
  }

  private async persistManifestCapabilities(
    pluginId: string,
    manifest: QqbotPluginManifest,
  ) {
    await Promise.all([
      ...manifest.operations.map((operation) =>
        this.operationRepository.save({
          enabled: true,
          handlerName: operation.handlerName,
          operationKey: operation.key,
          operationName: operation.name,
          pluginId,
        }),
      ),
      ...manifest.events.map((event) =>
        this.eventHandlerRepository.save({
          enabled: true,
          eventKey: event.key,
          handlerName: event.handlerName,
          pluginId,
        }),
      ),
      ...manifest.assets.map((asset) =>
        this.assetRepository.save({
          assetKey: asset.key,
          assetPath: asset.path,
          contentHash: asset.contentHash || '',
          pluginId,
        }),
      ),
    ]);
  }

  private async resolveActiveOperationSummaries() {
    const operations = await this.listActiveOperations();
    return operations.map((operation) =>
      this.toPlatformOperationSummary(operation),
    );
  }

  private toPlatformOperationSummary(operation: QqbotPluginOperationSummary) {
    return {
      ...operation,
      enabled: true,
      operationKey: operation.key,
      operationName: operation.name,
      pluginId: operation.pluginKey,
    };
  }

  private async resolveOperationPluginKeyFilter(query: ListOperationsQuery) {
    if (query.pluginKey) return this.resolveActivePluginKey(query.pluginKey);
    if (!query.pluginId) return undefined;

    const findOne = this.pluginRepository.findOne?.bind(this.pluginRepository);
    const plugin = findOne
      ? await findOne({ where: { id: query.pluginId } })
      : null;
    return plugin?.pluginKey || query.pluginId;
  }

  private async requireInstallation(body: InstallationActionBody) {
    if (!body.id) throwVbenError('请选择插件安装记录');

    const findOne = this.installationRepository.findOne?.bind(
      this.installationRepository,
    );
    const installation = findOne
      ? await findOne({ where: { id: body.id } })
      : null;

    return (
      installation ||
      ({
        id: body.id,
        installedPath: '',
        pluginId: body.id,
        runtimeStatus: 'stopped',
        status: 'installed',
        versionId: '',
      } as QqbotPluginInstallation)
    );
  }

  private async updateInstallationRuntime(
    installation: QqbotPluginInstallation,
    status: QqbotPluginInstallStatus,
    runtimeStatus: QqbotPluginRuntimeStatus,
  ) {
    await this.installationRepository.update(
      { id: installation.id },
      { runtimeStatus, status },
    );
    installation.runtimeStatus = runtimeStatus;
    installation.status = status;
  }

  private async refreshActiveRegistries(
    installation: QqbotPluginInstallation,
    enabled: boolean,
  ) {
    const activeOperation = enabled;
    const activeEvent = enabled;
    const pluginKey = await this.getPluginKey(installation.pluginId);
    await Promise.all([
      this.operationRepository.update(
        { pluginId: installation.pluginId },
        { enabled: activeOperation },
      ),
      this.eventHandlerRepository.update(
        { pluginId: installation.pluginId },
        { enabled: activeEvent },
      ),
    ]);
    this.pluginRegistry?.setPluginActive(pluginKey, enabled);
    this.eventPluginRegistry?.setPluginActive(pluginKey, enabled);
  }

  private async startBuiltinWorkers() {
    if (!this.runtimeFactory || !this.builtinPluginLoader) return;

    const persistedState = await this.resolvePersistedPluginRuntimeState();
    for (const manifest of this.builtinPluginLoader.loadBuiltinManifests()) {
      if (persistedState.inactivePluginKeys.has(manifest.pluginKey)) continue;
      if (this.activeWorkersByPluginKey.has(manifest.pluginKey)) continue;

      const persistedInstallation =
        persistedState.enabledInstallationsByPluginKey.get(manifest.pluginKey);
      const installation =
        persistedInstallation ||
        ({
          id: `builtin-${manifest.pluginKey}`,
          installedPath: `builtin://${manifest.pluginKey}`,
          pluginId: manifest.pluginKey,
          runtimeStatus: 'stopped',
          status: 'installed',
          versionId: `builtin-${manifest.pluginKey}-${manifest.version}`,
        } as QqbotPluginInstallation);

      await this.startWorker(installation, {
        id: `builtin-${manifest.pluginKey}-${manifest.version}`,
        manifestJson: manifest as unknown as Record<string, unknown>,
        packageHash: `builtin-${manifest.pluginKey}`,
        pluginId: manifest.pluginKey,
        version: manifest.version,
      } as QqbotPluginVersion);
    }
  }

  private async resolvePersistedPluginRuntimeState(): Promise<PersistedPluginRuntimeState> {
    const [plugins, installations] = await Promise.all([
      this.pluginRepository.find(),
      this.installationRepository.find(),
    ]);
    const pluginsById = new Map(
      plugins.map((plugin) => [plugin.id, plugin] as const),
    );
    const enabledInstallationsByPluginKey = new Map<
      string,
      QqbotPluginInstallation
    >();

    for (const installation of installations) {
      if (installation.status !== 'enabled') continue;
      const plugin = pluginsById.get(installation.pluginId);
      if (!plugin?.pluginKey) continue;
      enabledInstallationsByPluginKey.set(plugin.pluginKey, installation);
    }

    return {
      enabledInstallationsByPluginKey,
      inactivePluginKeys: new Set(
        resolveInactivePluginKeys(plugins, installations),
      ),
    };
  }

  private requireActiveWorker(pluginKey: string) {
    const resolvedPluginKey = this.resolveActivePluginKey(pluginKey);
    const workerContext = this.activeWorkersByPluginKey.get(resolvedPluginKey);
    if (!workerContext) {
      throwVbenError(`QQBot 插件运行时未启用：${pluginKey}`);
    }
    return workerContext;
  }

  private resolveActivePluginKey(pluginKey: string) {
    return this.activeWorkerPluginAliases.get(pluginKey) || pluginKey;
  }

  private listActiveWorkerOperations(): QqbotPluginOperationSummary[] {
    return [...this.activeWorkerContexts.values()].flatMap((workerContext) => [
      ...workerContext.manifest.operations.map((operation) => ({
        aliases: operation.aliases,
        description: operation.description,
        inputSchema: operation.inputSchema,
        key: operation.key,
        name: operation.name,
        outputSchema: operation.outputSchema,
        pluginKey: workerContext.pluginKey,
        timeoutMs: operation.timeoutMs,
        triggerMode: 'command' as const,
      })),
      ...workerContext.manifest.events.map((event) => ({
        description: event.description,
        inputSchema: {
          triggerType: event.eventName,
        },
        key: event.eventName || event.key,
        name: event.name,
        pluginKey: workerContext.pluginKey,
        triggerMode: 'event' as const,
      })),
    ]);
  }

  private async registerActiveWorker(
    installation: QqbotPluginInstallation,
    version: QqbotPluginVersion,
    worker: QqbotPluginWorkerRuntime,
  ) {
    const manifest = parseQqbotPluginManifest(version.manifestJson);
    await this.stopExistingWorkersForManifest(manifest);
    const workerContext: ActiveWorkerContext = {
      installationId: installation.id,
      manifest,
      pluginId: installation.pluginId,
      pluginKey: manifest.pluginKey,
      worker,
    };
    this.activeWorkers.set(installation.id, worker);
    this.activeWorkerContexts.set(installation.id, workerContext);
    this.activeWorkersByPluginKey.set(manifest.pluginKey, workerContext);
    for (const alias of manifest.legacyAliases) {
      this.activeWorkerPluginAliases.set(alias, manifest.pluginKey);
      this.activeWorkersByPluginKey.set(alias, workerContext);
    }
    await this.syncManifestTasksForInstallation(installation, manifest, true);
  }

  private async syncManifestTasksForInstallation(
    installation: QqbotPluginInstallation,
    manifest: QqbotPluginManifest,
    scheduleEnabledTasks: boolean,
  ) {
    if (!this.taskSynchronizer || !manifest.tasks.length) return [];

    const tasks = await this.taskSynchronizer.syncManifestTasks({
      installationId: installation.id,
      manifestTasks: manifest.tasks,
      pluginId: installation.pluginId,
    });
    if (scheduleEnabledTasks && this.taskScheduler) {
      for (const task of tasks) {
        await this.taskScheduler.syncTaskScheduler(task);
      }
    }
    return tasks;
  }

  private async stopExistingWorkersForManifest(manifest: QqbotPluginManifest) {
    const installationIds = new Set<string>();
    for (const pluginKey of [manifest.pluginKey, ...manifest.legacyAliases]) {
      const workerContext = this.activeWorkersByPluginKey.get(pluginKey);
      if (!workerContext) {
        continue;
      }
      installationIds.add(workerContext.installationId);
    }

    for (const installationId of installationIds) {
      await this.stopWorker(installationId);
    }
  }

  private unregisterActiveWorker(installationId: string) {
    const workerContext = this.activeWorkerContexts.get(installationId);
    this.activeWorkers.delete(installationId);
    this.activeWorkerContexts.delete(installationId);
    if (!workerContext) return;

    for (const pluginKey of [
      workerContext.pluginKey,
      ...workerContext.manifest.legacyAliases,
    ]) {
      if (this.activeWorkersByPluginKey.get(pluginKey) === workerContext) {
        this.activeWorkersByPluginKey.delete(pluginKey);
      }
    }
    for (const alias of workerContext.manifest.legacyAliases) {
      if (
        this.activeWorkerPluginAliases.get(alias) === workerContext.pluginKey
      ) {
        this.activeWorkerPluginAliases.delete(alias);
      }
    }
  }

  private async getPluginKey(pluginId: string) {
    const findOne = this.pluginRepository.findOne?.bind(this.pluginRepository);
    const plugin = findOne ? await findOne({ where: { id: pluginId } }) : null;
    return plugin?.pluginKey || pluginId;
  }

  private async stopWorker(installationId: string) {
    const worker = this.activeWorkers.get(installationId);
    if (!worker) return;
    const workerContext = this.activeWorkerContexts.get(installationId);
    try {
      try {
        await worker.deactivate();
      } finally {
        await this.flushWorkerRuntimeEventsBestEffort(workerContext);
      }
    } finally {
      try {
        await worker.dispose();
      } finally {
        await this.flushWorkerRuntimeEventsBestEffort(workerContext);
        this.unregisterActiveWorker(installationId);
      }
    }
  }

  private async stopWorkersForInstallation(
    installation: QqbotPluginInstallation,
  ) {
    const pluginKey = await this.getPluginKey(installation.pluginId);
    const installationIds = new Set([installation.id]);
    const pluginWorkerContext = this.activeWorkersByPluginKey.get(pluginKey);
    if (pluginWorkerContext) {
      installationIds.add(pluginWorkerContext.installationId);
    }

    for (const installationId of installationIds) {
      await this.stopWorker(installationId);
    }
  }

  private async startWorker(
    installation: QqbotPluginInstallation,
    versionOverride?: QqbotPluginVersion,
  ) {
    if (!this.runtimeFactory) return;

    const version =
      versionOverride ||
      (await this.versionRepository.findOne({
        where: { id: installation.versionId },
      }));
    if (!version) {
      throwVbenError('插件版本不存在，无法启动运行时');
    }

    const worker = this.runtimeFactory.create(installation, version);
    try {
      await worker.load(version.manifestJson);
      await worker.activate();
      await worker.health();
      await this.flushRuntimeEvents(
        installation.id,
        installation.pluginId,
        worker,
      );
      await this.registerActiveWorker(
        installation,
        version,
        worker as QqbotPluginWorkerRuntime,
      );
    } catch (error) {
      await this.flushRuntimeEvents(
        installation.id,
        installation.pluginId,
        worker,
      );
      try {
        await worker.dispose();
      } finally {
        await this.flushRuntimeEvents(
          installation.id,
          installation.pluginId,
          worker,
        );
      }
      throw error;
    }
  }

  private async flushWorkerRuntimeEvents(workerContext: ActiveWorkerContext) {
    await this.flushRuntimeEvents(
      workerContext.installationId,
      workerContext.pluginId,
      workerContext.worker,
    );
  }

  private async flushWorkerRuntimeEventsBestEffort(
    workerContext?: ActiveWorkerContext,
  ) {
    if (!workerContext) return;
    try {
      await this.flushWorkerRuntimeEvents(workerContext);
    } catch {
      // Runtime event persistence must not block worker cleanup.
    }
  }

  private async flushRuntimeEvents(
    installationId: string,
    pluginId: string,
    worker: Pick<QqbotPluginWorkerRuntime, 'drainRuntimeEvents'>,
  ) {
    const events = worker.drainRuntimeEvents?.() || [];
    if (!events.length || !this.isPersistablePluginId(pluginId)) return;

    await Promise.all(
      events.map((event: QqbotPluginWorkerRuntimeEvent) =>
        this.runtimeEventRepository.save({
          eventType: event.eventType,
          installationId,
          level: event.level,
          pluginId,
          safeSummary: event.safeSummary,
        }),
      ),
    );
  }

  private isPersistablePluginId(pluginId: string) {
    return /^\d+$/.test(pluginId);
  }

  private async recordRuntimeEvent(
    installation: QqbotPluginInstallation,
    eventType: string,
    level: QqbotPluginRuntimeEventLevel = 'info',
    safeSummary: Record<string, unknown> = {},
  ) {
    return this.runtimeEventRepository.save({
      eventType,
      installationId: installation.id,
      level,
      pluginId: installation.pluginId,
      safeSummary,
    });
  }

  private getPluginIdFromContext(context?: Record<string, any>) {
    return typeof context?.pluginId === 'string' && context.pluginId
      ? context.pluginId
      : null;
  }

  private buildRuntimeEventTimeFilter(query: RuntimeEventQuery) {
    if (query.startTime && query.endTime) {
      return {
        createTime: Between(query.startTime, query.endTime),
      };
    }
    if (query.startTime) {
      return {
        createTime: MoreThanOrEqual(query.startTime),
      };
    }
    if (query.endTime) {
      return {
        createTime: LessThanOrEqual(query.endTime),
      };
    }
    return {};
  }

  private requirePackageReader() {
    if (!this.packageReader) {
      throwVbenError('插件包读取器未初始化');
    }
    return this.packageReader;
  }
}

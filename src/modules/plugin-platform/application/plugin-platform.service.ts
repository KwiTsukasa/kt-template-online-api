import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { formatKtDateTime, throwVbenError } from '@/common';
import {
  type BotPluginEventDispatchInput,
  type BotPluginEventResult,
  type BotEventPluginDefinition as PluginEventDefinition,
  type BotPluginHealth as PluginHealth,
  type BotPluginOperationInput,
  type BotPluginOperationLookup,
  type BotPluginOperationSummary as PluginOperationSummary,
  type BotPluginProtocol,
  type BotPluginSummary as PluginSummary,
  type BotPluginTriggerMode as PluginTriggerMode,
} from '@/modules/plugin-platform/contract/plugin-protocol';
import {
  parsePluginManifest,
  type PluginManifest,
} from '../domain/manifest';
import type {
  PluginRuntimeEvent as PluginWorkerRuntimeEvent,
  PluginWorkerRuntime,
} from '../infrastructure/integration/runtime';
import { PluginTaskManifestSynchronizer } from './task/plugin-task-manifest.synchronizer';
import { PluginTaskSchedulerService } from './task/plugin-task-scheduler.service';
import type { PluginTaskTriggerType } from './task/plugin-task.types';
import { PluginArgumentParserService } from './argument/plugin-argument-parser.service';
import { PluginPackageReaderService } from '../infrastructure/integration/package/plugin-package-reader.service';
import { PluginPackageSourceService } from '../infrastructure/integration/package/plugin-package-source.service';
import type { PluginPackageDescriptor } from '../infrastructure/integration/package/plugin-package.types';
import { PluginEventRegistryService } from './registry/plugin-event-registry.service';
import { resolveInactivePluginKeys } from './registry/plugin-installation-state';
import { PluginRegistryService } from './registry/plugin-registry.service';
import {
  Plugin,
  PluginAsset,
  PluginConfig,
  PluginEventHandler,
  PluginInstallation,
  PluginOperation,
  PluginRuntimeEvent,
  PluginVersion,
  type PluginInstallStatus,
  type PluginRuntimeEventLevel,
  type PluginRuntimeStatus,
} from '../infrastructure/persistence';

export const PLUGIN_RUNTIME_FACTORY = Symbol(
  'PLUGIN_RUNTIME_FACTORY',
);

export type PluginRuntimeFactory = {
  create(
    installation: PluginInstallation,
    version: PluginVersion,
  ): Pick<
    PluginWorkerRuntime,
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
  triggerMode?: PluginTriggerMode;
};

type RuntimeEventQuery = {
  endTime?: string;
  eventType?: string;
  installationId?: string;
  level?: PluginRuntimeEventLevel;
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
  manifest: PluginManifest;
  pluginId: string;
  pluginKey: string;
  worker: PluginWorkerRuntime;
};

type PersistedPluginRuntimeState = {
  enabledInstallationsByPluginKey: Map<string, PluginInstallation>;
  inactivePluginKeys: Set<string>;
};

@Injectable()
export class PluginPlatformService
  implements OnModuleInit, BotPluginProtocol
{
  private readonly activeWorkers = new Map<string, PluginWorkerRuntime>();
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
    @InjectRepository(Plugin)
    private readonly pluginRepository: Repository<Plugin>,
    @InjectRepository(PluginVersion)
    private readonly versionRepository: Repository<PluginVersion>,
    @InjectRepository(PluginInstallation)
    private readonly installationRepository: Repository<PluginInstallation>,
    @InjectRepository(PluginOperation)
    private readonly operationRepository: Repository<PluginOperation>,
    @InjectRepository(PluginEventHandler)
    private readonly eventHandlerRepository: Repository<PluginEventHandler>,
    @InjectRepository(PluginConfig)
    private readonly configRepository: Repository<PluginConfig>,
    @InjectRepository(PluginAsset)
    private readonly assetRepository: Repository<PluginAsset>,
    @InjectRepository(PluginRuntimeEvent)
    private readonly runtimeEventRepository: Repository<PluginRuntimeEvent>,
    @Optional()
    private readonly argumentParser?: PluginArgumentParserService,
    @Optional()
    @Inject(PLUGIN_RUNTIME_FACTORY)
    private readonly runtimeFactory?: PluginRuntimeFactory,
    @Optional()
    private readonly pluginRegistry?: PluginRegistryService,
    @Optional()
    private readonly eventPluginRegistry?: PluginEventRegistryService,
    @Optional()
    private readonly packageReader?: PluginPackageReaderService,
    @Optional()
    private readonly packageSource?: PluginPackageSourceService,
    @Optional()
    private readonly taskSynchronizer?: PluginTaskManifestSynchronizer,
    @Optional()
    private readonly taskScheduler?: PluginTaskSchedulerService,
  ) {}

  async onModuleInit() {
    await this.startBuiltinWorkers();
  }

  /**
   * 按当前运行态读取安装记录列表。
   * @returns 安装记录列表。
   */
  async listInstallations() {
    return this.installationRepository.find();
  }

  /**
   * 读取指定插件安装清单声明的能力，并按稳定顺序转换为管理端能力列表。
   * @param pluginId - 用于精确定位插件的标识；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 包含 `eventHandlers`、`operations` 字段的能力列表。
   */
  async listCapabilities(pluginId?: string) {
    const where = (() => {
      if (pluginId) {
        return { pluginId };
      }
      return undefined;
    })();
    const [operations, eventHandlers] = await Promise.all([
      this.operationRepository.find({ where }),
      this.eventHandlerRepository.find({ where }),
    ]);
    return {
      eventHandlers,
      operations,
    };
  }

  /**
   * 按`pluginId`读取操作集合；从 `listOperationSummaries` 读取操作集合。
   * @param pluginId - 用于精确定位插件的标识；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 操作集合。
   */
  async listOperations(pluginId?: string) {
    return this.listOperationSummaries({ pluginId });
  }

  /**
   * 按`pluginKey`读取插件摘要；当 `workerSummaries.length > 0 || this.activeWorkerContexts.size…` 成立时返回 `workerSummaries`。
   * @param pluginKey - 用于读取或更新插件摘要的稳定键；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 按输入顺序得到的插件摘要列表；没有匹配项时为空数组。
   */
  async listPluginSummaries(pluginKey?: string): Promise<PluginSummary[]> {
    const workerSummaries = this.listActiveWorkerPluginSummaries(pluginKey);
    if (workerSummaries.length > 0 || this.activeWorkerContexts.size > 0) {
      return workerSummaries;
    }

    return (this.pluginRegistry?.listPlugins() || []).filter(
      (plugin) => !pluginKey || plugin.key === pluginKey,
    );
  }

  /**
   * 返回协议调用方可绑定的全部启用插件，并把纯事件插件补入命令插件目录且按稳定键去重。
   * @returns 平台无关的插件摘要列表。
   */
  async listPlugins(): Promise<PluginSummary[]> {
    const summaries = await this.listPluginSummaries();
    const seen = new Set(summaries.map((summary) => summary.key));
    for (const definition of this.eventPluginRegistry?.listDefinitions() || []) {
      if (seen.has(definition.key)) continue;
      summaries.push({
        description: definition.description,
        key: definition.key,
        name: definition.name,
        operationCount: 1,
        triggerMode: 'event',
        version: definition.version,
      });
      seen.add(definition.key);
    }
    return summaries;
  }

  /**
   * 按`pluginKey`读取插件健康状态；当 `workerContexts.length <= 0 && this.activeWorkerContexts.size…` 成立时返回 `this.pluginRegistry?.health(pluginKey) || []`。
   * @param pluginKey - 用于读取或更新插件健康状态的稳定键；为空时采用 `[]` 作为兜底。
   * @returns 按输入顺序得到的插件健康状态列表；没有匹配项时为空数组。
   */
  async listPluginHealth(pluginKey?: string): Promise<PluginHealth[]> {
    const workerContexts = this.listActiveWorkerCommandContexts(pluginKey);
    if (workerContexts.length <= 0 && this.activeWorkerContexts.size <= 0) {
      return this.pluginRegistry?.health(pluginKey) || [];
    }

    return Promise.all(
      workerContexts.map(async (workerContext) => {
        try {
          return this.toWorkerPluginHealth(
            workerContext,
            await workerContext.worker.health(),
          );
        } finally {
          await this.flushWorkerRuntimeEvents(workerContext);
        }
      }),
    );
  }

  /**
   * 按`query`读取分页结果操作集合。
   * @param query - 限定分页结果操作集合筛选、排序与分页范围的查询条件。
   * @returns 分页结果操作集合。
   */
  async pageOperations(query: ListOperationsQuery) {
    return this.pageOperationSummaries(query);
  }

  /**
   * 按查询条件汇总插件操作定义，并返回供管理端浏览的操作摘要列表。
   * @param query - 限定操作Summaries筛选、排序与分页范围的查询条件，包含 `triggerMode` 字段；省略时默认采用 `{}`。
   * @returns 操作Summaries。
   */
  async listOperationSummaries(query: ListOperationsQuery = {}) {
    const pluginKey = await this.resolveOperationPluginKeyFilter(query);
    const operations = await this.resolveActiveOperationSummaries();
    return operations.filter(
      (operation) =>
        (!pluginKey || operation.pluginKey === pluginKey) &&
        (!query.triggerMode || operation.triggerMode === query.triggerMode),
    );
  }

  /**
   * 按`query`读取分页结果操作Summaries；从 `listOperationSummaries` 读取分页结果操作Summaries。
   * @param query - 限定分页结果操作Summaries筛选、排序与分页范围的查询条件，包含 `pageNo`、`pageSize` 字段。
   * @returns 包含 `list`、`pageNo`、`pageSize`、`total` 字段的分页结果操作Summaries。
   */
  async pageOperationSummaries(query: ListOperationsQuery) {
    const pageNo = Number(query.pageNo || 1);
    const pageSize = Number(query.pageSize || 10);
    const safePageNo = (() => {
      if (Number.isFinite(pageNo) && pageNo > 0) {
        return pageNo;
      }
      return 1;
    })();
    const safePageSize = (() => {
      if (Number.isFinite(pageSize) && pageSize > 0) {
        return pageSize;
      }
      return 10;
    })();
    const operations = await this.listOperationSummaries(query);
    const skip = (safePageNo - 1) * safePageSize;

    return {
      list: operations.slice(skip, skip + safePageSize),
      pageNo: safePageNo,
      pageSize: safePageSize,
      total: operations.length,
    };
  }

  /**
   * 按`pluginId`读取事件处理器列表。
   * @param pluginId - 用于精确定位插件的标识；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 事件处理器列表。
   */
  async listEventHandlers(pluginId?: string) {
    return this.eventHandlerRepository.find({
      where: (() => {
        if (pluginId) {
          return { pluginId };
        }
        return undefined;
      })(),
    });
  }

  /**
   * 解析并校验 Bot 插件清单，解析成功后返回清单与固定的 `valid: true` 标志。
   * @param body - 用于清单的结构化输入，包含 `manifest` 字段。
   * @returns 包含 `manifest`、`valid` 字段的清单。
   */
  validateManifest(body: ValidateManifestBody) {
    return {
      manifest: parsePluginManifest(body.manifest),
      valid: true,
    };
  }

  /**
   * 根据`body`处理upload插件包；先通过 `requirePackageReader` 校验输入边界。
   * @param body - 用于upload插件包的结构化输入。
   * @returns 包含 `valid` 字段的upload插件包。
   */
  uploadPackage(body: InstallLocalBody) {
    return {
      ...this.requirePackageReader().readPackage(body),
      valid: true,
    };
  }

  /**
   * 根据`body`处理install本地事件；把变更持久化到当前存储（`pluginRepository.save`）。
   * @param body - 用于install本地事件的结构化输入。
   * @returns install本地事件。
   */
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

  /**
   * 通过 `requireInstallation` 强制满足前置条件。
   * @param body - 用于安装记录的结构化输入。
   * @returns 包含 `id`、`runtimeStatus`、`status` 字段的安装记录。
   */
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
      runtimeStatus: 'healthy' as PluginRuntimeStatus,
      status: 'enabled' as PluginInstallStatus,
    };
  }

  /**
   * 通过 `requireInstallation` 强制满足前置条件。
   * @param body - 用于安装记录的结构化输入。
   * @returns 包含 `id`、`runtimeStatus`、`status` 字段的安装记录。
   */
  async disableInstallation(body: InstallationActionBody) {
    const installation = await this.requireInstallation(body);
    await this.stopWorkersForInstallation(installation);
    await this.taskScheduler?.removeSchedulersForInstallation(installation.id);
    await this.refreshActiveRegistries(installation, false);
    await this.updateInstallationRuntime(installation, 'disabled', 'stopped');
    await this.recordRuntimeEvent(installation, 'disable-finished');
    return {
      id: installation.id,
      runtimeStatus: 'stopped' as PluginRuntimeStatus,
      status: 'disabled' as PluginInstallStatus,
    };
  }

  /**
   * 通过 `requireInstallation` 强制满足前置条件。
   * @param body - 用于upgrade安装记录的结构化输入。
   * @returns 包含 `id`、`runtimeStatus`、`status` 字段的upgrade安装记录。
   * @throws 当 `startWorker` 调用失败时重新抛出该入口捕获且决定公开的原异常。
   */
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
        message: (() => {
          if (error instanceof Error) {
            return error.message;
          }
          return `${error}`;
        })(),
      });
      throw error;
    }
    await this.refreshActiveRegistries(installation, true);
    await this.updateInstallationRuntime(installation, 'enabled', 'healthy');
    await this.recordRuntimeEvent(installation, 'upgrade-finished');
    return {
      id: installation.id,
      runtimeStatus: 'healthy' as PluginRuntimeStatus,
      status: 'enabled' as PluginInstallStatus,
    };
  }

  /**
   * 根据`body`处理uninstall安装记录；先通过 `requireInstallation` 校验输入边界。
   * @param body - 用于uninstall安装记录的结构化输入。
   * @returns 包含 `id`、`runtimeStatus`、`status` 字段的uninstall安装记录。
   */
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
      runtimeStatus: 'stopped' as PluginRuntimeStatus,
      status: 'uninstalled' as PluginInstallStatus,
    };
  }

  /**
   * 根据`input`处理操作；把变更持久化到当前存储（`runtimeEventRepository.save`）。
   * @param input - 用于操作的结构化输入，包含 `input`、`pluginKey`、`operationKey`、`context` 字段。
   * @returns 操作。
   */
  async executeOperation(input: BotPluginOperationInput) {
    const normalizedInput =
      (await this.argumentParser?.normalizeInput(input)) || input.input;
    const workerContext = this.requireActiveWorker(input.pluginKey);
    const operation = workerContext.manifest.operations.find(
      (item) => item.key === input.operationKey,
    );
    if (!operation) {
      throwVbenError(
        `Bot 插件能力不存在：${input.pluginKey}.${input.operationKey}`,
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
            outputKeys: (() => {
              if (output && typeof output === 'object') {
                return Object.keys(output as Record<string, unknown>).sort();
              }
              return [];
            })(),
            pluginKey: input.pluginKey,
          },
        });
      }
      return output;
    } finally {
      await this.flushWorkerRuntimeEvents(workerContext);
    }
  }

  /**
   * 通过 `activeWorkerContexts.values` 遍历或定位集合元素。
   * @param input - 用于事件的结构化输入，包含 `eventKey`、`message` 字段。
   * @returns 事件。
   */
  async dispatchEvent(
    input: BotPluginEventDispatchInput,
  ): Promise<BotPluginEventResult> {
    let handled = false;
    const replies: BotPluginEventResult['replies'] = [];
    const allowedPluginKeys = new Set(input.pluginKeys);
    for (const workerContext of this.activeWorkerContexts.values()) {
      if (!allowedPluginKeys.has(workerContext.pluginKey)) continue;
      for (const event of workerContext.manifest.events) {
        if (
          event.eventName !== input.eventKey &&
          event.key !== input.eventKey
        ) {
          continue;
        }
        try {
          const result = await workerContext.worker.handleEvent({
            event: input.event,
            eventKey: event.eventName || input.eventKey,
            timeoutMs: workerContext.manifest.runtime.timeoutMs,
          });
          const normalized = this.normalizeEventResult(result);
          handled = normalized.handled || handled;
          replies.push(...normalized.replies);
        } finally {
          await this.flushWorkerRuntimeEvents(workerContext);
        }
      }
    }
    return { handled, replies };
  }

  /**
   * 将插件事件返回值收敛为平台无关的 handled 与回复意图，兼容旧插件布尔返回但拒绝未知副作用结构。
   * @param result - 插件工作线程返回的未知事件结果。
   * @returns 可由任意 Bot 适配器消费的标准事件结果。
   */
  private normalizeEventResult(result: unknown): BotPluginEventResult {
    if (result === true) return { handled: true, replies: [] };
    if (!result || typeof result !== 'object') {
      return { handled: false, replies: [] };
    }
    const record = result as Record<string, unknown>;
    const replies: BotPluginEventResult['replies'] = [];
    if (Array.isArray(record.replies)) {
      record.replies.forEach((candidate) => {
        if (!candidate || typeof candidate !== 'object') return;
        const reply = candidate as Record<string, unknown>;
        if (reply.kind !== 'text' || typeof reply.content !== 'string') return;
        replies.push({ content: reply.content, kind: 'text' });
      });
    }
    return {
      handled: record.handled === true || replies.length > 0,
      replies,
    };
  }

  /**
   * 根据`input`处理任务；从 `activeWorkerContexts.get` 读取任务。
   * @param input - 用于任务的结构化输入，包含 `installationId`、`input`、`taskHandlerName`、`taskId` 字段。
   * @returns 任务。
   */
  async executeTask(input: {
    input: Record<string, unknown>;
    installationId: string;
    pluginId: string;
    taskHandlerName: string;
    taskId: string;
    taskKey: string;
    timeoutMs: number;
    triggerType: PluginTaskTriggerType;
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

  /**
   * 按当前运行态读取启用状态操作集合；从 `listActiveWorkerOperations` 读取启用状态操作集合。
   * @returns 按输入顺序得到的启用状态操作集合列表；没有匹配项时为空数组。
   */
  async listActiveOperations() {
    const workerOperations = this.listActiveWorkerOperations();
    if (workerOperations.length > 0) return workerOperations;
    return [
      ...(this.pluginRegistry?.listOperations() || []),
      ...(this.eventPluginRegistry?.listOperations() || []),
    ];
  }

  /**
   * 按`command`读取操作命令；从 `listActiveOperations` 读取操作命令。
   * @param command - 用于操作命令的领域对象，包含 `pluginKey`、`operationKey` 字段。
   * @returns 规范化后的操作命令；主值为空时采用 `null` 兜底；无法解析或未命中时为 `null`。
   */
  async getOperationByCommand(command: BotPluginOperationLookup) {
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

  /**
   * 根据`body`更新配置；把变更持久化到当前存储（`configRepository.save`）。
   * @param body - 用于配置的结构化输入，包含 `pluginId`、`configKey`、`value` 字段。
   * @returns 配置。
   */
  async updateConfig(body: UpdateConfigBody) {
    if (!body.pluginId || !body.configKey) {
      throwVbenError('请选择插件和配置项');
    }

    return this.configRepository.save({
      configKey: body.configKey,
      configValue: (() => {
        if (body.value === undefined) {
          return null;
        }
        return { value: body.value };
      })(),
      pluginId: body.pluginId,
    });
  }

  /**
   * 按`query`读取运行态事件流。
   * @param query - 限定运行态事件流筛选、排序与分页范围的查询条件；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 运行态事件流。
   */
  async listRuntimeEvents(query?: RuntimeEventQuery | string) {
    const normalizedQuery = (() => {
      if (typeof query === 'string') {
        return { pluginId: query };
      }
      return query || {};
    })();
    const where = {
      ...(() => {
        if (normalizedQuery.eventType) {
          return { eventType: normalizedQuery.eventType };
        }
        return {};
      })(),
      ...(() => {
        if (normalizedQuery.installationId) {
          return { installationId: normalizedQuery.installationId };
        }
        return {};
      })(),
      ...(() => {
        if (normalizedQuery.level) {
          return { level: normalizedQuery.level };
        }
        return {};
      })(),
      ...(() => {
        if (normalizedQuery.pluginId) {
          return { pluginId: normalizedQuery.pluginId };
        }
        return {};
      })(),
      ...this.buildRuntimeEventTimeFilter(normalizedQuery),
    };

    return this.runtimeEventRepository.find({
      where: (() => {
        if (Object.keys(where).length) {
          return where as any;
        }
        return undefined;
      })(),
    });
  }

  /**
   * 根据`pluginId`、`manifest`更新persist清单能力列表。
   * @param pluginId - 用于精确定位插件的标识。
   * @param manifest - 用于persist清单能力列表的领域对象，包含 `operations`、`events`、`assets` 字段。
   */
  private async persistManifestCapabilities(
    pluginId: string,
    manifest: PluginManifest,
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

  /**
   * 从当前运行态解析启用状态操作Summaries；从 `listActiveOperations` 读取启用状态操作Summaries。
   * @returns 启用状态操作Summaries。
   */
  private async resolveActiveOperationSummaries() {
    const operations = await this.listActiveOperations();
    return operations.map((operation) =>
      this.toPlatformOperationSummary(operation),
    );
  }

  /**
   * 将`operation`转换为Platform操作摘要。
   * @param operation - 在当前锁、事务或错误边界内执行的受控回调。
   * @returns 包含 `enabled`、`operationKey`、`operationName`、`pluginId` 字段的Platform操作摘要。
   */
  private toPlatformOperationSummary(operation: PluginOperationSummary) {
    return {
      ...operation,
      enabled: true,
      operationKey: operation.key,
      operationName: operation.name,
      pluginId: operation.pluginKey,
    };
  }

  /**
   * 通过 `resolveActivePluginKey` 生成稳定标识。
   * @param query - 限定操作插件键筛选、排序与分页范围的查询条件，包含 `pluginKey`、`pluginId` 字段。
   * @returns 规范化后的操作插件键；主值为空时采用 `query.pluginId` 兜底；没有可用结果或提前结束时为 `undefined`。
   */
  private async resolveOperationPluginKeyFilter(query: ListOperationsQuery) {
    if (query.pluginKey) return this.resolveActivePluginKey(query.pluginKey);
    if (!query.pluginId) return undefined;

    const findOne = this.pluginRepository.findOne?.bind(this.pluginRepository);
    const plugin = await (async () => {
      if (findOne) {
        return await findOne({ where: { id: query.pluginId } });
      }
      return null;
    })();
    return plugin?.pluginKey || query.pluginId;
  }

  /**
   * 校验`body`是否满足安装记录约束，并拒绝不合法输入；从 `installationRepository.findOne.bind` 读取安装记录。
   * @param body - 用于安装记录的结构化输入，包含 `id` 字段。
   * @returns 规范化后的安装记录；主值为空时采用 `({ id: body.id, installedPath: '', pluginId: body.i…` 兜底。
   */
  private async requireInstallation(body: InstallationActionBody) {
    if (!body.id) throwVbenError('请选择插件安装记录');

    const findOne = this.installationRepository.findOne?.bind(
      this.installationRepository,
    );
    const installation = await (async () => {
      if (findOne) {
        return await findOne({ where: { id: body.id } });
      }
      return null;
    })();

    return (
      installation ||
      ({
        id: body.id,
        installedPath: '',
        pluginId: body.id,
        runtimeStatus: 'stopped',
        status: 'installed',
        versionId: '',
      } as PluginInstallation)
    );
  }

  /**
   * 根据`installation`、`status`、`runtimeStatus`更新安装记录运行态；把变更持久化到当前存储（`installationRepository.update`）。
   * @param installation - 用于安装记录运行态的领域对象，包含 `id`、`runtimeStatus`、`status` 字段。
   * @param status - 决定安装记录运行态内容、边界或目标的 `status` 值。
   * @param runtimeStatus - 决定安装记录运行态内容、边界或目标的 `runtimeStatus` 值。
   */
  private async updateInstallationRuntime(
    installation: PluginInstallation,
    status: PluginInstallStatus,
    runtimeStatus: PluginRuntimeStatus,
  ) {
    await this.installationRepository.update(
      { id: installation.id },
      { runtimeStatus, status },
    );
    installation.runtimeStatus = runtimeStatus;
    installation.status = status;
  }

  /**
   * 根据`installation`、`enabled`处理刷新结果启用状态Registries；把变更持久化到当前存储（`operationRepository.update`）。
   * @param installation - 用于刷新结果启用状态Registries的领域对象，包含 `pluginId` 字段。
   * @param enabled - 决定刷新结果启用状态Registries内容、边界或目标的 `enabled` 值。
   */
  private async refreshActiveRegistries(
    installation: PluginInstallation,
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

  /**
   * 按当前运行态启动内置的工作进程；从 `persistedState.enabledInstallationsByPluginKey.get` 读取内置的工作进程。
   * @returns 当前状态对应的内置的工作进程，取值为 `0`。
   */
  async startBuiltinWorkers(): Promise<number> {
    if (!this.runtimeFactory || !this.packageSource) return 0;

    const persistedState = await this.resolvePersistedPluginRuntimeState();
    const descriptors = await this.packageSource.discoverPackages();
    let startedCount = 0;

    for (const descriptor of descriptors) {
      if (persistedState.inactivePluginKeys.has(descriptor.pluginKey)) {
        continue;
      }
      if (this.activeWorkersByPluginKey.has(descriptor.pluginKey)) {
        continue;
      }

      const persistedInstallation =
        persistedState.enabledInstallationsByPluginKey.get(
          descriptor.pluginKey,
        );
      const { installation, version } =
        await this.ensureBuiltinRuntimePersistence(
          descriptor,
          persistedInstallation,
        );

      try {
        await this.startWorker(installation, version);
        startedCount += 1;
      } catch (error) {
        await this.recordBuiltinWorkerStartFailure(installation, error);
      }
    }

    return startedCount;
  }

  /**
   * 记录内置的工作进程启动失败。
   * @param installation - 决定记录内置的工作进程启动失败内容、边界或目标的 `installation` 值。
   * @param error - 待转换为稳定业务错误或日志文本的未知异常。
   */
  private async recordBuiltinWorkerStartFailure(
    installation: PluginInstallation,
    error: unknown,
  ) {
    const message = (() => {
      if (error instanceof Error) {
        return error.message;
      }
      return `${error}`;
    })();
    await this.updateInstallationRuntime(installation, 'enabled', 'unhealthy');
    await this.recordRuntimeEvent(
      installation,
      'builtin-start-failed',
      'error',
      {
        message,
      },
    );
  }

  /**
   * 确保内置的运行态持久化存在且保持一致；缺失时根据`descriptor`、`persistedInstallation`补齐对应状态。
   * @param descriptor - 用于内置的运行态持久化的领域对象，包含 `packageRoot` 字段。
   * @param persistedInstallation - 决定内置的运行态持久化内容、边界或目标的 `persistedInstallation` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 包含 `installation`、`version` 字段的内置的运行态持久化。
   */
  private async ensureBuiltinRuntimePersistence(
    descriptor: PluginPackageDescriptor,
    persistedInstallation?: PluginInstallation,
  ) {
    const plugin = await this.ensureBuiltinPlugin(descriptor);
    const version = await this.ensureBuiltinPluginVersion(
      plugin.id,
      descriptor,
    );
    const installation = await (async () => {
      if (persistedInstallation) {
        return await this.alignBuiltinInstallation(
          persistedInstallation,
          version,
          descriptor,
        );
      }
      return await this.installationRepository.save({
        installedPath: descriptor.packageRoot,
        pluginId: plugin.id,
        runtimeStatus: 'stopped',
        status: 'enabled',
        versionId: version.id,
      });
    })();

    return { installation, version };
  }

  /**
   * 确保内置的插件存在且保持一致；缺失时根据`descriptor`补齐对应状态；把变更持久化到当前存储（`pluginRepository.save`）。
   * @param descriptor - 用于内置的插件的领域对象，包含 `pluginKey`、`manifest` 字段。
   * @returns 内置的插件；无法解析或未命中时为 `null`。
   */
  private async ensureBuiltinPlugin(descriptor: PluginPackageDescriptor) {
    const existing = await this.pluginRepository.findOne({
      where: { pluginKey: descriptor.pluginKey },
    });
    if (existing) return existing;

    return this.pluginRepository.save({
      description: descriptor.manifest.description || null,
      pluginKey: descriptor.pluginKey,
      pluginName: descriptor.manifest.name,
      status: 'installed',
    });
  }

  /**
   * 确保内置的插件版本存在且保持一致；缺失时根据`pluginId`、`descriptor`补齐对应状态；当 `existing` 成立时返回 `existing`。
   * @param pluginId - 用于精确定位插件的标识。
   * @param descriptor - 用于内置的插件版本的领域对象，包含 `manifest`、`pluginKey` 字段。
   * @returns 内置的插件版本。
   */
  private async ensureBuiltinPluginVersion(
    pluginId: string,
    descriptor: PluginPackageDescriptor,
  ) {
    const manifestJson = descriptor.manifest as unknown as Record<
      string,
      unknown
    >;
    const packageHash = `${descriptor.pluginKey}:${descriptor.manifest.version}`;
    const existing = await this.versionRepository.findOne({
      where: {
        pluginId,
        version: descriptor.manifest.version,
      },
    });
    if (existing) {
      const shouldUpdateSnapshot =
        existing.packageHash !== packageHash ||
        JSON.stringify(existing.manifestJson) !== JSON.stringify(manifestJson);
      if (shouldUpdateSnapshot) {
        await this.versionRepository.update(
          { id: existing.id },
          {
            manifestJson,
            packageHash,
          },
        );
        existing.manifestJson = manifestJson;
        existing.packageHash = packageHash;
      }
      return existing;
    }

    return this.versionRepository.save({
      manifestJson,
      packageHash,
      pluginId,
      version: descriptor.manifest.version,
    });
  }

  /**
   * 从输入或当前状态提取对齐内置的安装。
   * @param installation - 用于alignBuiltin安装记录的领域对象，包含 `installedPath`、`versionId`、`id` 字段。
   * @param version - 用于alignBuiltin安装记录的领域对象，包含 `id` 字段。
   * @param descriptor - 用于alignBuiltin安装记录的领域对象，包含 `packageRoot` 字段。
   * @returns alignBuiltin安装记录。
   */
  private async alignBuiltinInstallation(
    installation: PluginInstallation,
    version: PluginVersion,
    descriptor: PluginPackageDescriptor,
  ) {
    const desiredPath = descriptor.packageRoot;
    const patch: Partial<PluginInstallation> = {};
    if (installation.installedPath !== desiredPath) {
      patch.installedPath = desiredPath;
    }
    if (installation.versionId !== version.id) {
      patch.versionId = version.id;
    }
    if (Object.keys(patch).length) {
      await this.installationRepository.update({ id: installation.id }, patch);
      Object.assign(installation, patch);
    }
    return installation;
  }

  /**
   * 从当前运行态解析Persisted插件运行态状态；从 `pluginsById.get` 读取Persisted插件运行态状态。
   * @returns 包含 `enabledInstallationsByPluginKey`、`inactivePluginKeys` 字段的Persisted插件运行态状态。
   */
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
      PluginInstallation
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

  /**
   * 校验`pluginKey`是否满足启用状态工作进程约束，并拒绝不合法输入；从 `activeWorkersByPluginKey.get` 读取启用状态工作进程。
   * @param pluginKey - 用于读取或更新启用状态工作进程的稳定键。
   * @returns 启用状态工作进程。
   */
  private requireActiveWorker(pluginKey: string) {
    const resolvedPluginKey = this.resolveActivePluginKey(pluginKey);
    const workerContext = this.activeWorkersByPluginKey.get(resolvedPluginKey);
    if (!workerContext) {
      throwVbenError(`Bot 插件运行时未启用：${pluginKey}`);
    }
    return workerContext;
  }

  /**
   * 从`pluginKey`解析启用状态插件键；从 `activeWorkerPluginAliases.get` 读取启用状态插件键。
   * @param pluginKey - 用于读取或更新启用状态插件键的稳定键。
   * @returns 规范化后的启用状态插件键；主值为空时采用 `pluginKey` 兜底。
   */
  private resolveActivePluginKey(pluginKey: string) {
    return this.activeWorkerPluginAliases.get(pluginKey) || pluginKey;
  }

  /**
   * 按`pluginKey`读取启用的工作进程命令上下文。
   * @param pluginKey - 用于读取或更新启用的工作进程命令上下文的稳定键；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 按输入顺序得到的启用的工作进程命令上下文列表；没有匹配项时为空数组。
   */
  private listActiveWorkerCommandContexts(
    pluginKey?: string,
  ): ActiveWorkerContext[] {
    const resolvedPluginKey = (() => {
      if (pluginKey) {
        return this.resolveActivePluginKey(pluginKey);
      }
      return undefined;
    })();
    return [...this.activeWorkerContexts.values()].filter(
      (workerContext) =>
        workerContext.manifest.operations.length > 0 &&
        (!resolvedPluginKey || workerContext.pluginKey === resolvedPluginKey),
    );
  }

  /**
   * 按`pluginKey`读取启用的工作进程插件摘要；从 `listActiveWorkerCommandContexts` 读取启用的工作进程插件摘要。
   * @param pluginKey - 用于读取或更新启用的工作进程插件摘要的稳定键；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 按输入顺序得到的启用的工作进程插件摘要列表；没有匹配项时为空数组。
   */
  private listActiveWorkerPluginSummaries(
    pluginKey?: string,
  ): PluginSummary[] {
    return this.listActiveWorkerCommandContexts(pluginKey).map(
      (workerContext) => ({
        description: workerContext.manifest.description,
        key: workerContext.pluginKey,
        name: workerContext.manifest.name,
        operationCount: workerContext.manifest.operations.length,
        triggerMode: 'command',
        version: workerContext.manifest.version,
      }),
    );
  }

  /**
   * 将输入收敛并投影为工作进程插件健康状态。
   * @param workerContext - 用于工作进程插件健康状态的领域对象，包含 `manifest`、`pluginKey` 字段。
   * @param healthPayload - 待按当前协议校验并路由的事件载荷。
   * @returns 包含 `checkedAt`、`message`、`name`、`pluginKey`、`status` 字段的工作进程插件健康状态。
   */
  private toWorkerPluginHealth(
    workerContext: ActiveWorkerContext,
    healthPayload: unknown,
  ): PluginHealth {
    const health = (() => {
      if (healthPayload && typeof healthPayload === 'object') {
        return healthPayload as Record<string, unknown>;
      }
      return {};
    })();
    return {
      checkedAt: (() => {
        if (typeof health.checkedAt === 'string') {
          return health.checkedAt;
        }
        return formatKtDateTime(new Date());
      })(),
      message: (() => {
        if (typeof health.message === 'string') {
          return health.message;
        }
        return undefined;
      })(),
      name: (() => {
        if (typeof health.name === 'string') {
          return health.name;
        }
        return workerContext.manifest.name;
      })(),
      pluginKey: workerContext.pluginKey,
      status: this.normalizePluginHealthStatus(health.status),
      triggerMode: 'command',
    };
  }

  /**
   * 将`status`规范为插件健康状态，使等价输入得到一致表示；当 `status === 'degraded' || status === 'offline' || status === '…` 成立时返回 `status`。
   * @param status - 决定插件健康状态内容、边界或目标的 `status` 值。
   * @returns 当前状态对应的插件健康状态，取值为 `'healthy'`。
   */
  private normalizePluginHealthStatus(
    status: unknown,
  ): PluginHealth['status'] {
    if (status === 'degraded' || status === 'offline' || status === 'healthy') {
      return status;
    }
    return 'healthy';
  }

  /**
   * 通过 `flatMap` 遍历或定位集合元素。
   * @returns 按输入顺序得到的启用状态工作进程操作集合列表；没有匹配项时为空数组。
   */
  private listActiveWorkerOperations(): PluginOperationSummary[] {
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

  /**
   * 根据`installation`、`version`、`worker`处理register启用状态工作进程。
   * @param installation - 用于register启用状态工作进程的领域对象，包含 `id`、`pluginId` 字段。
   * @param version - 用于register启用状态工作进程的领域对象，包含 `manifestJson` 字段。
   * @param worker - 决定register启用状态工作进程内容、边界或目标的 `worker` 值。
   */
  private async registerActiveWorker(
    installation: PluginInstallation,
    version: PluginVersion,
    worker: PluginWorkerRuntime,
  ) {
    const manifest = parsePluginManifest(version.manifestJson);
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
    this.eventPluginRegistry?.registerRuntimeEvents(
      manifest.pluginKey,
      this.buildRuntimeEventDefinitions(manifest),
    );
    await this.syncManifestTasksForInstallation(installation, manifest, true);
  }

  /**
   * 根据`manifest`构造运行态事件定义。
   * @param manifest - 用于运行态事件定义的领域对象，包含 `events`、`pluginKey`、`name`、`version` 字段。
   * @returns 按输入顺序得到的运行态事件定义列表；没有匹配项时为空数组。
   */
  private buildRuntimeEventDefinitions(
    manifest: PluginManifest,
  ): PluginEventDefinition[] {
    return manifest.events.map((event) => ({
      description: event.description,
      key: manifest.pluginKey,
      name: event.name || manifest.name,
      remark: event.key,
      triggerType: 'message',
      version: manifest.version,
    }));
  }

  /**
   * 通过 `isPersistablePluginId` 判断输入是否满足函数约束。
   * @param installation - 用于清单Tasks安装记录的领域对象，包含 `pluginId`、`id` 字段。
   * @param manifest - 用于清单Tasks安装记录的领域对象，包含 `tasks` 字段。
   * @param scheduleEnabledTasks - 决定清单Tasks安装记录内容、边界或目标的 `scheduleEnabledTasks` 值。
   * @returns 清单Tasks安装记录。
   */
  private async syncManifestTasksForInstallation(
    installation: PluginInstallation,
    manifest: PluginManifest,
    scheduleEnabledTasks: boolean,
  ) {
    if (!this.taskSynchronizer || !manifest.tasks.length) return [];
    if (
      !this.isPersistablePluginId(installation.pluginId) ||
      !this.isPersistablePluginId(installation.id)
    ) {
      return [];
    }

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

  /**
   * 按`manifest`停止ExistingWorkers清单并清理该入口拥有的运行态资源；从 `activeWorkersByPluginKey.get` 读取ExistingWorkers清单。
   * @param manifest - 用于ExistingWorkers清单的领域对象，包含 `pluginKey`、`legacyAliases` 字段。
   */
  private async stopExistingWorkersForManifest(manifest: PluginManifest) {
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

  /**
   * 根据`installationId`处理unregister启用状态工作进程；从 `activeWorkerContexts.get` 读取unregister启用状态工作进程。
   * @param installationId - 用于精确定位安装记录的标识。
   */
  private unregisterActiveWorker(installationId: string) {
    const workerContext = this.activeWorkerContexts.get(installationId);
    this.activeWorkers.delete(installationId);
    this.activeWorkerContexts.delete(installationId);
    if (!workerContext) return;

    this.eventPluginRegistry?.unregisterRuntimeEvents(workerContext.pluginKey);
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

  /**
   * 通过 `pluginRepository.findOne.bind` 原子更新持久状态。
   * @param pluginId - 用于精确定位插件的标识。
   * @returns 规范化后的插件键；主值为空时采用 `pluginId` 兜底。
   */
  private async getPluginKey(pluginId: string) {
    const findOne = this.pluginRepository.findOne?.bind(this.pluginRepository);
    const plugin = await (async () => {
      if (findOne) {
        return await findOne({ where: { id: pluginId } });
      }
      return null;
    })();
    return plugin?.pluginKey || pluginId;
  }

  /**
   * 按`installationId`停止工作进程并清理该入口拥有的运行态资源；从 `activeWorkers.get` 读取工作进程。
   * @param installationId - 用于精确定位安装记录的标识。
   */
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

  /**
   * 按`installation`停止Workers安装记录并清理该入口拥有的运行态资源；从 `getPluginKey` 读取Workers安装记录。
   * @param installation - 用于Workers安装记录的领域对象，包含 `pluginId`、`id` 字段。
   */
  private async stopWorkersForInstallation(
    installation: PluginInstallation,
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

  /**
   * 按`installation`、`versionOverride`启动工作进程；从 `versionRepository.findOne` 读取工作进程。
   * @param installation - 用于工作进程的领域对象，包含 `versionId`、`id`、`pluginId` 字段。
   * @param versionOverride - 决定工作进程内容、边界或目标的 `versionOverride` 值；为空时采用 `(await this.versionRepository.findOne({ where:…` 作为兜底。
   * @throws 当 `worker.load` 或 `worker.activate` 调用失败时重新抛出该入口捕获且决定公开的原异常。
   */
  private async startWorker(
    installation: PluginInstallation,
    versionOverride?: PluginVersion,
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
        worker as PluginWorkerRuntime,
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

  /**
   * 使用工作进程对应的安装与插件标识，将待处理运行事件写入持久化事件流。
   * @param workerContext - 用于使用工作进程对应的安装与插件标识，将待处理运行事件写入持久化事件流的领域对象，包含 `installationId`、`pluginId`、`worker` 字段。
   */
  private async flushWorkerRuntimeEvents(workerContext: ActiveWorkerContext) {
    await this.flushRuntimeEvents(
      workerContext.installationId,
      workerContext.pluginId,
      workerContext.worker,
    );
  }

  /**
   * 在工作进程存在时尽力刷新运行事件，并吞掉持久化失败以免阻塞进程清理。
   * @param workerContext - 决定flush工作进程运行态事件流BestEffort内容、边界或目标的 `workerContext` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   */
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

  /**
   * 通过 `worker.drainRuntimeEvents` 排空待处理队列。
   * @param installationId - 用于精确定位安装记录的标识。
   * @param pluginId - 用于精确定位插件的标识。
   * @param worker - 用于flush运行态事件流的领域对象，包含 `drainRuntimeEvents` 字段。
   */
  private async flushRuntimeEvents(
    installationId: string,
    pluginId: string,
    worker: Pick<PluginWorkerRuntime, 'drainRuntimeEvents'>,
  ) {
    const events = worker.drainRuntimeEvents?.() || [];
    if (!events.length || !this.isPersistablePluginId(pluginId)) return;

    await Promise.all(
      events.map((event: PluginWorkerRuntimeEvent) =>
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

  /**
   * 仅将全部由十进制数字组成的非空标识识别为可持久化插件 ID。
   * @param pluginId - 用于精确定位插件的标识。
   * @returns 满足仅将全部由十进制数字组成的非空标识识别为可持久化插件 ID约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isPersistablePluginId(pluginId: string) {
    return /^\d+$/.test(pluginId);
  }

  /**
   * 将插件安装、事件类型、级别和安全摘要写入运行时事件仓库，并返回持久化记录。
   * @param installation - 用于记录运行态事件的领域对象，包含 `id`、`pluginId` 字段。
   * @param eventType - 决定记录运行态事件内容、边界或目标的 `eventType` 值。
   * @param level - 决定记录运行态事件内容、边界或目标的 `level` 值；省略时默认采用 `'info'`。
   * @param safeSummary - 决定记录运行态事件内容、边界或目标的 `safeSummary` 值；省略时默认采用 `{}`。
   * @returns 记录运行态事件。
   */
  private async recordRuntimeEvent(
    installation: PluginInstallation,
    eventType: string,
    level: PluginRuntimeEventLevel = 'info',
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

  /**
   * 按`context`读取插件标识Context；当 `typeof context?.pluginId === 'string' && context.pluginId` 成立时返回 `context.pluginId`。
   * @param context - 用于插件标识Context的领域对象，包含 `pluginId` 字段；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 插件标识Context；无法解析或未命中时为 `null`。
   */
  private getPluginIdFromContext(context?: Record<string, any>) {
    if (typeof context?.pluginId === 'string' && context.pluginId) {
      return context.pluginId;
    }
    return null;
  }

  /**
   * 根据`query`构造运行态事件时间；当 `query.startTime && query.endTime` 成立时返回 `{ createTime: Between(query.startTime, quer…`。
   * @param query - 限定运行态事件时间筛选、排序与分页范围的查询条件，包含 `startTime`、`endTime` 字段。
   * @returns 运行态事件时间。
   */
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

  /**
   * 返回已注入的插件包读取器；读取器未初始化时以业务错误拒绝调用。
   * @returns 已注入的插件包读取器。
   */
  private requirePackageReader() {
    if (!this.packageReader) {
      throwVbenError('插件包读取器未初始化');
    }
    return this.packageReader;
  }
}

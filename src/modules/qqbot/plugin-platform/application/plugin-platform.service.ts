import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { formatKtDateTime, throwVbenError } from '@/common';
import {
  type QqbotPluginEventDispatchInput,
  type QqbotPluginExecutionInput,
  type QqbotPluginExecutionPort,
  type QqbotPluginOperationLookup,
} from '@/modules/qqbot/core/domain/plugin-execution.port';
import type {
  QqbotEventPluginDefinition,
  QqbotPluginHealth,
  QqbotPluginOperationSummary,
  QqbotPluginSummary,
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
import { QqbotPluginPackageReaderService } from '../infrastructure/integration/package/plugin-package-reader.service';
import { QqbotPluginPackageSourceService } from '../infrastructure/integration/package/plugin-package-source.service';
import type { QqbotPluginPackageDescriptor } from '../infrastructure/integration/package/plugin-package.types';
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

  /**
   * 初始化 QqbotPluginPlatformService 实例。
   * @param pluginRepository - 插件主表仓库；维护 package key、名称和安装状态的持久化真相。
   * @param versionRepository - 插件版本仓库；保存 manifest 快照和 package hash 供 worker 启动。
   * @param installationRepository - 插件安装仓库；记录 installedPath、versionId 和 runtime/status 状态。
   * @param operationRepository - 命令能力仓库；写入和启停 manifest 声明的 command operation。
   * @param eventHandlerRepository - 事件能力仓库；写入和启停 manifest 声明的 event handler。
   * @param accountBindingRepository - 账号绑定仓库；查询插件与账号的绑定关系。
   * @param configRepository - 插件配置仓库；保存 Admin 修改的插件配置项。
   * @param assetRepository - 插件资产仓库；保存 manifest 声明的资源路径和 hash。
   * @param runtimeEventRepository - 运行时事件仓库；持久化 worker lifecycle、命令和任务安全摘要。
   * @param argumentParser - 命令参数解析器；在执行 worker operation 前规范化输入。
   * @param runtimeFactory - worker runtime 工厂；根据 installation/version 创建隔离执行实例。
   * @param pluginRegistry - 命令 registry；在没有 active worker 时作为显式注册插件的查询兜底。
   * @param eventPluginRegistry - 事件 registry；接收 worker manifest 元数据并支撑 Admin 绑定页面。
   * @param packageReader - 本地安装包读取器；处理 Admin 上传/安装插件包的 manifest 校验。
   * @param packageSource - 插件包描述符来源；启动内置包时只读取 manifest 和受控路径。
   * @param taskSynchronizer - 定时任务同步器；把 manifest tasks 投影到平台任务表。
   * @param taskScheduler - 定时任务调度器；在插件启停时同步或移除 BullMQ cron 调度。
   */
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
    private readonly packageSource?: QqbotPluginPackageSourceService,
    @Optional()
    private readonly taskSynchronizer?: QqbotPluginTaskManifestSynchronizer,
    @Optional()
    private readonly taskScheduler?: QqbotPluginTaskSchedulerService,
  ) {}

  /**
   * 处理 QQBot 插件平台事件。
   */
  async onModuleInit() {
    await this.startBuiltinWorkers();
  }

  /**
   * 列出Installations。
   */
  async listInstallations() {
    return this.installationRepository.find();
  }

  /**
   * 列出Capabilities。
   * @param pluginId - 插件 ID；定位本次读取、更新、删除或关联的插件。
   */
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

  /**
   * 列出Operations。
   * @param pluginId - 插件 ID；定位本次读取、更新、删除或关联的插件。
   */
  async listOperations(pluginId?: string) {
    return this.listOperationSummaries({ pluginId });
  }

  /**
   * Lists command plugin summaries from active descriptor-backed workers.
   * @param pluginKey - Optional package or legacy key used by Admin to narrow the command plugin list.
   * @returns Command plugin summaries sourced from active worker manifests, with registry fallback only when no workers are active.
   */
  async listPluginSummaries(pluginKey?: string): Promise<QqbotPluginSummary[]> {
    const workerSummaries = this.listActiveWorkerPluginSummaries(pluginKey);
    if (workerSummaries.length > 0 || this.activeWorkerContexts.size > 0) {
      return workerSummaries;
    }

    return (this.pluginRegistry?.listPlugins() || []).filter(
      (plugin) => !pluginKey || plugin.key === pluginKey,
    );
  }

  /**
   * Reads health for command plugins from active descriptor-backed workers.
   * @param pluginKey - Optional package or legacy key used by Admin to narrow the health check.
   * @returns Health entries normalized for Admin command plugin status display.
   */
  async listPluginHealth(pluginKey?: string): Promise<QqbotPluginHealth[]> {
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
   * 执行 QQBot 插件平台流程。
   * @param query - 查询参数 DTO；限定 插件平台分页、搜索或详情查询条件。
   */
  async pageOperations(query: ListOperationsQuery) {
    return this.pageOperationSummaries(query);
  }

  /**
   * 列出Operation Summaries。
   * @param query - 查询参数 DTO；限定 插件平台分页、搜索或详情查询条件。
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
   * 执行 QQBot 插件平台流程。
   * @param query - 查询参数 DTO；限定 插件平台分页、搜索或详情查询条件。
   */
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

  /**
   * 列出Event Handlers。
   * @param pluginId - 插件 ID；定位本次读取、更新、删除或关联的插件。
   */
  async listEventHandlers(pluginId?: string) {
    return this.eventHandlerRepository.find({
      where: pluginId ? { pluginId } : undefined,
    });
  }

  /**
   * 判断 QQBot 插件平台条件。
   * @param body - 请求体 DTO；承载 插件平台新增、更新、导入或执行字段。
   */
  validateManifest(body: ValidateManifestBody) {
    return {
      manifest: parseQqbotPluginManifest(body.manifest),
      valid: true,
    };
  }

  /**
   * 执行 QQBot 插件平台流程。
   * @param body - 请求体 DTO；承载 插件平台新增、更新、导入或执行字段。
   */
  uploadPackage(body: InstallLocalBody) {
    return {
      ...this.requirePackageReader().readPackage(body),
      valid: true,
    };
  }

  /**
   * 执行 QQBot 插件平台流程。
   * @param body - 请求体 DTO；承载 插件平台新增、更新、导入或执行字段。
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
   * 执行 QQBot 插件平台流程。
   * @param body - 请求体 DTO；承载 插件平台新增、更新、导入或执行字段。
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
      runtimeStatus: 'healthy' as QqbotPluginRuntimeStatus,
      status: 'enabled' as QqbotPluginInstallStatus,
    };
  }

  /**
   * 执行 QQBot 插件平台流程。
   * @param body - 请求体 DTO；承载 插件平台新增、更新、导入或执行字段。
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
      runtimeStatus: 'stopped' as QqbotPluginRuntimeStatus,
      status: 'disabled' as QqbotPluginInstallStatus,
    };
  }

  /**
   * 执行 QQBot 插件平台流程。
   * @param body - 请求体 DTO；承载 插件平台新增、更新、导入或执行字段。
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

  /**
   * 执行 QQBot 插件平台流程。
   * @param body - 请求体 DTO；承载 插件平台新增、更新、导入或执行字段。
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
      runtimeStatus: 'stopped' as QqbotPluginRuntimeStatus,
      status: 'uninstalled' as QqbotPluginInstallStatus,
    };
  }

  /**
   * 执行Operation。
   * @param input - input 输入；使用 `input`、`pluginKey`、`operationKey`、`context` 字段生成结果。
   */
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

  /**
   * 投递 QQBot 插件平台消息或任务。
   * @param input - input 输入；使用 `eventKey`、`message` 字段生成结果。
   */
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

  /**
   * 执行Task。
   * @param input - input 输入；使用 `installationId`、`input`、`taskHandlerName`、`taskId` 字段生成结果。
   */
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

  /**
   * 列出Active Operations。
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
   * 查询 QQBot 插件平台数据。
   * @param command - command 输入；使用 `pluginKey`、`operationKey` 字段生成结果。
   */
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

  /**
   * 更新Config。
   * @param body - 请求体 DTO；承载 插件平台新增、更新、导入或执行字段。
   */
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

  /**
   * 列出Runtime Events。
   * @param query - 查询参数 DTO；限定 插件平台分页、搜索或详情查询条件。
   */
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

  /**
   * 列出Account Bindings。
   * @param pluginId - 插件 ID；定位本次读取、更新、删除或关联的插件。
   */
  async listAccountBindings(pluginId?: string) {
    return this.accountBindingRepository.find({
      where: pluginId ? { pluginId } : undefined,
    });
  }

  /**
   * 保存 QQBot 插件平台数据。
   * @param pluginId - 插件 ID；定位本次读取、更新、删除或关联的插件。
   * @param manifest - manifest 输入；使用 `operations`、`events`、`assets` 字段生成结果。
   */
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

  /**
   * 解析Active Operation Summaries。
   */
  private async resolveActiveOperationSummaries() {
    const operations = await this.listActiveOperations();
    return operations.map((operation) =>
      this.toPlatformOperationSummary(operation),
    );
  }

  /**
   * 执行 QQBot 插件平台流程。
   * @param operation - operation 输入；使用 `key`、`name`、`pluginKey` 字段生成结果。
   */
  private toPlatformOperationSummary(operation: QqbotPluginOperationSummary) {
    return {
      ...operation,
      enabled: true,
      operationKey: operation.key,
      operationName: operation.name,
      pluginId: operation.pluginKey,
    };
  }

  /**
   * 解析Operation Plugin Key Filter。
   * @param query - 查询参数 DTO；限定 插件平台分页、搜索或详情查询条件。
   */
  private async resolveOperationPluginKeyFilter(query: ListOperationsQuery) {
    if (query.pluginKey) return this.resolveActivePluginKey(query.pluginKey);
    if (!query.pluginId) return undefined;

    const findOne = this.pluginRepository.findOne?.bind(this.pluginRepository);
    const plugin = findOne
      ? await findOne({ where: { id: query.pluginId } })
      : null;
    return plugin?.pluginKey || query.pluginId;
  }

  /**
   * 执行 QQBot 插件平台流程。
   * @param body - 请求体 DTO；承载 插件平台新增、更新、导入或执行字段。
   */
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

  /**
   * 更新Installation Runtime。
   * @param installation - installation 输入；使用 `id`、`runtimeStatus`、`status` 字段生成结果。
   * @param status - 插件平台列表；写入 插件平台状态。
   * @param runtimeStatus - 插件平台列表；写入 插件平台状态。
   */
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

  /**
   * 执行 QQBot 插件平台流程。
   * @param installation - installation 输入；使用 `pluginId` 字段生成结果。
   * @param enabled - enabled 输入；驱动 `setPluginActive()` 的 插件平台步骤。
   */
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

  /**
   * Starts built-in plugin packages discovered from controlled package roots.
   * @returns Count of descriptor-backed workers that reached the active registry.
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
   * Records one failed built-in worker boot without blocking other built-in plugin packages.
   * @param installation - Persisted installation whose worker failed during module startup.
   * @param error - Startup error from worker load, activate, or health checks.
   */
  private async recordBuiltinWorkerStartFailure(
    installation: QqbotPluginInstallation,
    error: unknown,
  ) {
    const message = error instanceof Error ? error.message : `${error}`;
    await this.updateInstallationRuntime(
      installation,
      'enabled',
      'unhealthy',
    );
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
   * Ensures descriptor-discovered built-in package state is persisted.
   * @param descriptor - Manifest descriptor discovered from a controlled plugin package root.
   * @param persistedInstallation - Existing enabled installation for the same plugin key, when present.
   * @returns Installation and version rows aligned to the descriptor package root and manifest snapshot.
   */
  private async ensureBuiltinRuntimePersistence(
    descriptor: QqbotPluginPackageDescriptor,
    persistedInstallation?: QqbotPluginInstallation,
  ) {
    const plugin = await this.ensureBuiltinPlugin(descriptor);
    const version = await this.ensureBuiltinPluginVersion(
      plugin.id,
      descriptor,
    );
    const installation = persistedInstallation
      ? await this.alignBuiltinInstallation(
          persistedInstallation,
          version,
          descriptor,
        )
      : await this.installationRepository.save({
          installedPath: descriptor.packageRoot,
          pluginId: plugin.id,
          runtimeStatus: 'stopped',
          status: 'enabled',
          versionId: version.id,
        });

    return { installation, version };
  }

  /**
   * Ensures the plugin row exists for a descriptor-discovered package.
   * @param descriptor - Package descriptor whose manifest owns the plugin key, name, and description.
   * @returns Persisted plugin row for the descriptor package.
   */
  private async ensureBuiltinPlugin(
    descriptor: QqbotPluginPackageDescriptor,
  ) {
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
   * Ensures a version row exists for the descriptor manifest version.
   * @param pluginId - Persisted plugin id used for the `pluginId + version` uniqueness boundary.
   * @param descriptor - Package descriptor whose manifest is stored as the version snapshot.
   * @returns Persisted version row for this plugin and manifest version.
   */
  private async ensureBuiltinPluginVersion(
    pluginId: string,
    descriptor: QqbotPluginPackageDescriptor,
  ) {
    const manifestJson =
      descriptor.manifest as unknown as Record<string, unknown>;
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
   * Aligns an existing enabled installation with the current descriptor package version.
   * @param installation - Enabled installation previously persisted for the package plugin key.
   * @param version - Current descriptor-backed version row that should be launched.
   * @param descriptor - Package descriptor whose package root must become the installation path.
   * @returns Installation row updated in-memory for runtime startup.
   */
  private async alignBuiltinInstallation(
    installation: QqbotPluginInstallation,
    version: QqbotPluginVersion,
    descriptor: QqbotPluginPackageDescriptor,
  ) {
    const desiredPath = descriptor.packageRoot;
    const patch: Partial<QqbotPluginInstallation> = {};
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
   * 解析Persisted Plugin Runtime State。
   * @returns QQBot 插件平台转换后的值。
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

  /**
   * 执行 QQBot 插件平台流程。
   * @param pluginKey - pluginKey 输入；驱动 `this.resolveActivePluginKey()` 的 插件平台步骤。
   */
  private requireActiveWorker(pluginKey: string) {
    const resolvedPluginKey = this.resolveActivePluginKey(pluginKey);
    const workerContext = this.activeWorkersByPluginKey.get(resolvedPluginKey);
    if (!workerContext) {
      throwVbenError(`QQBot 插件运行时未启用：${pluginKey}`);
    }
    return workerContext;
  }

  /**
   * 解析Active Plugin Key。
   * @param pluginKey - pluginKey 输入；驱动 `activeWorkerPluginAliases.get()` 的 插件平台步骤。
   */
  private resolveActivePluginKey(pluginKey: string) {
    return this.activeWorkerPluginAliases.get(pluginKey) || pluginKey;
  }

  /**
   * Lists active command worker contexts filtered by canonical or legacy plugin key.
   * @param pluginKey - Optional package or legacy key supplied by Admin or compatibility callers.
   * @returns Active worker contexts whose manifests expose command operations.
   */
  private listActiveWorkerCommandContexts(
    pluginKey?: string,
  ): ActiveWorkerContext[] {
    const resolvedPluginKey = pluginKey
      ? this.resolveActivePluginKey(pluginKey)
      : undefined;
    return [...this.activeWorkerContexts.values()].filter(
      (workerContext) =>
        workerContext.manifest.operations.length > 0 &&
        (!resolvedPluginKey || workerContext.pluginKey === resolvedPluginKey),
    );
  }

  /**
   * Builds Admin command plugin summaries from active worker manifests.
   * @param pluginKey - Optional package or legacy key used to filter active worker contexts.
   * @returns Plugin summaries that do not depend on command registry plugin instances.
   */
  private listActiveWorkerPluginSummaries(
    pluginKey?: string,
  ): QqbotPluginSummary[] {
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
   * Normalizes an arbitrary worker health payload into the Admin health contract.
   * @param workerContext - Active worker context that owns the package key and manifest display data.
   * @param healthPayload - Worker health response returned by the plugin package runtime.
   * @returns Command plugin health entry for Admin display.
   */
  private toWorkerPluginHealth(
    workerContext: ActiveWorkerContext,
    healthPayload: unknown,
  ): QqbotPluginHealth {
    const health =
      healthPayload && typeof healthPayload === 'object'
        ? (healthPayload as Record<string, unknown>)
        : {};
    return {
      checkedAt:
        typeof health.checkedAt === 'string'
          ? health.checkedAt
          : formatKtDateTime(new Date()),
      message: typeof health.message === 'string' ? health.message : undefined,
      name:
        typeof health.name === 'string'
          ? health.name
          : workerContext.manifest.name,
      pluginKey: workerContext.pluginKey,
      status: this.normalizePluginHealthStatus(health.status),
      triggerMode: 'command',
    };
  }

  /**
   * Converts worker health status into the public QQBot plugin health enum.
   * @param status - Raw status value returned by a plugin health hook.
   * @returns Supported health status, defaulting to healthy for generic `{ ok: true }` payloads.
   */
  private normalizePluginHealthStatus(
    status: unknown,
  ): QqbotPluginHealth['status'] {
    return status === 'degraded' || status === 'offline' || status === 'healthy'
      ? status
      : 'healthy';
  }

  /**
   * 列出Active Worker Operations。
   * @returns QQBot 插件平台查询结果。
   */
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

  /**
   * 执行 QQBot 插件平台流程。
   * @param installation - installation 输入；使用 `id`、`pluginId` 字段生成结果。
   * @param version - version 输入；使用 `manifestJson` 字段生成结果。
   * @param worker - worker 输入；驱动 `activeWorkers.set()` 的 插件平台步骤。
   */
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
    this.eventPluginRegistry?.registerRuntimeEvents(
      manifest.pluginKey,
      this.buildRuntimeEventDefinitions(manifest),
    );
    await this.syncManifestTasksForInstallation(installation, manifest, true);
  }

  /**
   * Builds Admin-facing event metadata from a worker runtime manifest.
   * @param manifest - Active worker manifest that owns event handler metadata.
   * @returns Event plugin definitions grouped under the package plugin key.
   */
  private buildRuntimeEventDefinitions(
    manifest: QqbotPluginManifest,
  ): QqbotEventPluginDefinition[] {
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
   * 更新 QQBot 插件平台状态。
   * @param installation - installation 输入；使用 `pluginId`、`id` 字段生成结果。
   * @param manifest - manifest 输入；使用 `tasks` 字段生成结果。
   * @param scheduleEnabledTasks - 插件任务列表；决定 插件平台条件分支。
   */
  private async syncManifestTasksForInstallation(
    installation: QqbotPluginInstallation,
    manifest: QqbotPluginManifest,
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
   * 停止Existing Workers For Manifest。
   * @param manifest - manifest 输入；使用 `pluginKey`、`legacyAliases` 字段生成结果。
   */
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

  /**
   * 执行 QQBot 插件平台流程。
   * @param installationId - 插件平台 ID；定位本次读取、更新、删除或关联的插件平台。
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
   * 查询 QQBot 插件平台数据。
   * @param pluginId - 插件 ID；定位本次读取、更新、删除或关联的插件。
   */
  private async getPluginKey(pluginId: string) {
    const findOne = this.pluginRepository.findOne?.bind(this.pluginRepository);
    const plugin = findOne ? await findOne({ where: { id: pluginId } }) : null;
    return plugin?.pluginKey || pluginId;
  }

  /**
   * 停止Worker。
   * @param installationId - 插件平台 ID；定位本次读取、更新、删除或关联的插件平台。
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
   * 停止Workers For Installation。
   * @param installation - installation 输入；使用 `pluginId`、`id` 字段生成结果。
   */
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

  /**
   * 启动Worker。
   * @param installation - installation 输入；使用 `versionId`、`id`、`pluginId` 字段生成结果。
   * @param versionOverride - versionOverride 输入；影响 startWorker 的返回值。
   */
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

  /**
   * 执行 QQBot 插件平台流程。
   * @param workerContext - workerContext 输入；使用 `installationId`、`pluginId`、`worker` 字段生成结果。
   */
  private async flushWorkerRuntimeEvents(workerContext: ActiveWorkerContext) {
    await this.flushRuntimeEvents(
      workerContext.installationId,
      workerContext.pluginId,
      workerContext.worker,
    );
  }

  /**
   * 执行 QQBot 插件平台流程。
   * @param workerContext - workerContext 输入；驱动 `this.flushWorkerRuntimeEvents()` 的 插件平台步骤。
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
   * 执行 QQBot 插件平台流程。
   * @param installationId - 插件平台 ID；定位本次读取、更新、删除或关联的插件平台。
   * @param pluginId - 插件 ID；定位本次读取、更新、删除或关联的插件。
   * @param worker - worker 输入；使用 `drainRuntimeEvents` 字段生成结果。
   */
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

  /**
   * 判断 QQBot 插件平台条件。
   * @param pluginId - 插件 ID；定位本次读取、更新、删除或关联的插件。
   */
  private isPersistablePluginId(pluginId: string) {
    return /^\d+$/.test(pluginId);
  }

  /**
   * 执行 QQBot 插件平台流程。
   * @param installation - installation 输入；使用 `id`、`pluginId` 字段生成结果。
   * @param eventType - eventType 输入；影响 recordRuntimeEvent 的返回值。
   * @param level - level 输入；影响 recordRuntimeEvent 的返回值。
   * @param safeSummary - safeSummary 输入；影响 recordRuntimeEvent 的返回值。
   */
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

  /**
   * 查询 QQBot 插件平台数据。
   * @param context - context 输入；使用 `pluginId` 字段生成结果。
   */
  private getPluginIdFromContext(context?: Record<string, any>) {
    return typeof context?.pluginId === 'string' && context.pluginId
      ? context.pluginId
      : null;
  }

  /**
   * 创建 QQBot 插件平台对象或配置。
   * @param query - 查询参数 DTO；限定 插件平台分页、搜索或详情查询条件。
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
   * 执行 QQBot 插件平台流程。
   */
  private requirePackageReader() {
    if (!this.packageReader) {
      throwVbenError('插件包读取器未初始化');
    }
    return this.packageReader;
  }
}

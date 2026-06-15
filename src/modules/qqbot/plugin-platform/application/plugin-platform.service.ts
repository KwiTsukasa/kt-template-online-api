import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { throwVbenError } from '@/common';
import {
  QQBOT_PLUGIN_EXECUTION_PORT,
  type QqbotPluginEventDispatchInput,
  type QqbotPluginExecutionInput,
  type QqbotPluginExecutionPort,
} from '@/modules/qqbot/core/domain/plugin-execution.port';
import {
  parseQqbotPluginManifest,
  type QqbotPluginManifest,
} from '../domain/manifest';
import type { QqbotPluginWorkerRuntime } from '../infrastructure/integration/runtime';
import { QqbotPluginPackageReaderService } from '../infrastructure/integration/package/plugin-package-reader.service';
import { QqbotEventPluginRegistryService } from './registry/qqbot-event-plugin-registry.service';
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
    'activate' | 'deactivate' | 'dispose' | 'health' | 'load'
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

@Injectable()
export class QqbotPluginPlatformService {
  private readonly activeWorkers = new Map<string, QqbotPluginWorkerRuntime>();

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
    @Inject(QQBOT_PLUGIN_EXECUTION_PORT)
    private readonly pluginExecution?: QqbotPluginExecutionPort,
    @Optional()
    @Inject(QQBOT_PLUGIN_RUNTIME_FACTORY)
    private readonly runtimeFactory?: QqbotPluginRuntimeFactory,
    @Optional()
    private readonly pluginRegistry?: QqbotPluginRegistryService,
    @Optional()
    private readonly eventPluginRegistry?: QqbotEventPluginRegistryService,
    @Optional()
    private readonly packageReader?: QqbotPluginPackageReaderService,
  ) {}

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
    return this.operationRepository.find({
      where: pluginId ? { pluginId } : undefined,
    });
  }

  async pageOperations(query: ListOperationsQuery) {
    const pageNo = Number(query.pageNo || 1);
    const pageSize = Number(query.pageSize || 10);
    const safePageNo = Number.isFinite(pageNo) && pageNo > 0 ? pageNo : 1;
    const safePageSize =
      Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 10;
    const [list, total] = await this.operationRepository.findAndCount({
      skip: (safePageNo - 1) * safePageSize,
      take: safePageSize,
      where: query.pluginId ? { pluginId: query.pluginId } : undefined,
    });

    return {
      list,
      pageNo: safePageNo,
      pageSize: safePageSize,
      total,
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

    return this.installationRepository.save({
      installedPath: pluginPackage.packagePath,
      pluginId: plugin.id,
      runtimeStatus: 'stopped',
      status: 'installed',
      versionId: version.id,
    });
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
    await this.stopWorker(installation.id);
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
        await this.updateInstallationRuntime(installation, 'enabled', 'healthy');
      }
      await this.recordRuntimeEvent(
        installation,
        'upgrade-failed',
        'error',
        {
          message: error instanceof Error ? error.message : `${error}`,
        },
      );
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
    if (!this.pluginExecution) {
      throwVbenError('插件执行器未初始化');
    }

    const output = await this.pluginExecution.executeOperation(input);
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
  }

  async dispatchEvent(input: QqbotPluginEventDispatchInput) {
    if (!this.pluginExecution) return false;
    const handled = await this.pluginExecution.dispatchEvent(input);
    return handled;
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
      ...(normalizedQuery.pluginId ? { pluginId: normalizedQuery.pluginId } : {}),
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

  private async getPluginKey(pluginId: string) {
    const findOne = this.pluginRepository.findOne?.bind(
      this.pluginRepository,
    );
    const plugin = findOne ? await findOne({ where: { id: pluginId } }) : null;
    return plugin?.pluginKey || pluginId;
  }

  private async stopWorker(installationId: string) {
    const worker = this.activeWorkers.get(installationId);
    if (!worker) return;
    try {
      await worker.deactivate();
    } finally {
      await worker.dispose();
      this.activeWorkers.delete(installationId);
    }
  }

  private async startWorker(installation: QqbotPluginInstallation) {
    if (!this.runtimeFactory) return;

    const version = await this.versionRepository.findOne({
      where: { id: installation.versionId },
    });
    if (!version) {
      throwVbenError('插件版本不存在，无法启动运行时');
    }

    const worker = this.runtimeFactory.create(installation, version);
    try {
      await worker.load(version.manifestJson);
      await worker.activate();
      await worker.health();
      this.activeWorkers.set(
        installation.id,
        worker as QqbotPluginWorkerRuntime,
      );
    } catch (error) {
      await worker.dispose();
      throw error;
    }
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

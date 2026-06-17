import {
  forwardRef,
  Inject,
  Injectable,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { formatKtDateTime, throwVbenError } from '@/common';
import type {
  QqbotIntegrationPlugin,
  QqbotPluginHealth,
  QqbotPluginOperationContext,
  QqbotPluginOperationSummary,
  QqbotPluginSummary,
} from '@/modules/qqbot/core/contract/qqbot.types';
import { QqbotBuiltinPluginPackageLoaderService } from '@/modules/qqbot/plugin-platform/infrastructure/integration/package/builtin-plugin-package-loader.service';
import {
  QqbotPlugin,
  QqbotPluginInstallation,
} from '@/modules/qqbot/plugin-platform/infrastructure/persistence';
import { resolveInactivePluginKeys } from './plugin-installation-state';

@Injectable()
export class QqbotPluginRegistryService implements OnModuleInit {
  private readonly inactivePluginKeys = new Set<string>();
  private readonly pluginAliases = new Map<string, string>();
  private readonly plugins = new Map<string, QqbotIntegrationPlugin>();

  /**
   * 初始化 QqbotPluginRegistryService 实例。
   * @param builtinPluginLoader - builtinPluginLoader 输入；影响 constructor 的返回值。
   * @param pluginRepository - 插件仓库依赖；影响 constructor 的返回值。
   * @param installationRepository - 插件平台仓库依赖；影响 constructor 的返回值。
   */
  constructor(
    @Optional()
    @Inject(forwardRef(() => QqbotBuiltinPluginPackageLoaderService))
    private readonly builtinPluginLoader?: QqbotBuiltinPluginPackageLoaderService,
    @Optional()
    @InjectRepository(QqbotPlugin)
    private readonly pluginRepository?: Repository<QqbotPlugin>,
    @Optional()
    @InjectRepository(QqbotPluginInstallation)
    private readonly installationRepository?: Repository<QqbotPluginInstallation>,
  ) {}

  /**
   * 处理 QQBot 插件平台事件。
   */
  async onModuleInit() {
    await this.hydrateInactivePluginKeys();
    for (const plugin of this.builtinPluginLoader?.loadCommandPlugins() || []) {
      this.register(plugin);
      if (this.isPluginActive(plugin.key)) {
        await plugin.activate?.();
      }
    }
  }

  /**
   * 执行 QQBot 插件平台流程。
   * @param plugin - plugin 输入；使用 `key`、`operations`、`legacyKeys` 字段生成结果。
   */
  register(plugin: QqbotIntegrationPlugin) {
    if (!plugin.key || !plugin.operations.length) {
      throwVbenError('QQBot 插件必须包含 key 和 operation');
    }
    this.plugins.set(plugin.key, plugin);
    for (const legacyKey of plugin.legacyKeys || []) {
      if (!legacyKey || legacyKey === plugin.key) continue;
      if (this.plugins.has(legacyKey) || this.pluginAliases.has(legacyKey)) {
        throwVbenError(`QQBot 插件别名重复：${legacyKey}`);
      }
      this.pluginAliases.set(legacyKey, plugin.key);
    }
  }

  /**
   * 设置Plugin Active。
   * @param pluginKey - pluginKey 输入；驱动 `this.resolveCanonicalPluginKey()` 的 插件平台步骤。
   * @param active - active 输入；决定 插件平台条件分支。
   */
  setPluginActive(pluginKey: string, active: boolean) {
    const canonicalKey = this.resolveCanonicalPluginKey(pluginKey);
    if (active) {
      this.inactivePluginKeys.delete(canonicalKey);
      return;
    }
    this.inactivePluginKeys.add(canonicalKey);
  }

  /**
   * 列出Plugins。
   * @returns QQBot 插件平台查询结果。
   */
  listPlugins(): QqbotPluginSummary[] {
    return [...this.plugins.values()]
      .filter((plugin) => this.isPluginActive(plugin.key))
      .map((plugin) => ({
        description: plugin.description,
        key: plugin.key,
        name: plugin.name,
        operationCount: plugin.operations.length,
        triggerMode: 'command',
        version: plugin.version,
      }));
  }

  /**
   * 列出Operations。
   * @param pluginKey - pluginKey 输入；驱动 `this.getPlugins()` 的 插件平台步骤。
   * @returns QQBot 插件平台查询结果。
   */
  listOperations(pluginKey?: string): QqbotPluginOperationSummary[] {
    return this.getPlugins(pluginKey).flatMap((plugin) =>
      plugin.operations.map((operation) => ({
        aliases: operation.aliases,
        cacheTtlMs: operation.cacheTtlMs,
        description: operation.description,
        inputSchema: operation.inputSchema,
        key: operation.key,
        name: operation.name,
        outputSchema: operation.outputSchema,
        pluginKey: plugin.key,
        timeoutMs: operation.timeoutMs,
        triggerMode: 'command',
      })),
    );
  }

  /**
   * 执行 QQBot 插件平台流程。
   * @param pluginKey - pluginKey 输入；驱动 `this.getPlugins()`、`formatKtDateTime()`、`plugin.healthCheck()` 的 插件平台步骤。
   * @returns 异步完成后的 QQBot 插件平台结果。
   */
  async health(pluginKey?: string): Promise<QqbotPluginHealth[]> {
    const plugins = this.getPlugins(pluginKey);
    return Promise.all(
      plugins.map(async (plugin) => {
        if (!plugin.healthCheck) {
          return {
            checkedAt: formatKtDateTime(new Date()),
            message: '插件未提供健康检查',
            name: plugin.name,
            pluginKey: plugin.key,
            status: 'healthy',
            triggerMode: 'command' as const,
          };
        }
        return {
          ...(await plugin.healthCheck()),
          name: plugin.name,
          pluginKey: plugin.key,
          triggerMode: 'command' as const,
        };
      }),
    );
  }

  /**
   * 执行业务数据。
   * @param pluginKey - pluginKey 输入；驱动 `this.getOperation()` 的 插件平台步骤。
   * @param operationKey - operationKey 输入；驱动 `this.getOperation()` 的 插件平台步骤。
   * @param input - input 输入；驱动 `this.executeWithTimeout()` 的 插件平台步骤。
   * @param context - context 输入；驱动 `this.executeWithTimeout()` 的 插件平台步骤。
   */
  async execute(
    pluginKey: string,
    operationKey: string,
    input: Record<string, any>,
    context: QqbotPluginOperationContext = {},
  ) {
    const operation = this.getOperation(pluginKey, operationKey);
    return this.executeWithTimeout(operation, input, context);
  }

  /**
   * 执行 QQBot 插件平台流程。
   * @param pluginKey - pluginKey 输入；驱动 `this.getOperation()` 的 插件平台步骤。
   * @param operationKey - operationKey 输入；驱动 `this.getOperation()` 的 插件平台步骤。
   */
  assertOperation(pluginKey?: string, operationKey?: string) {
    if (!pluginKey || !operationKey) {
      throwVbenError('请选择插件和插件能力');
    }
    this.getOperation(pluginKey, operationKey);
  }

  /**
   * 查询 QQBot 插件平台数据。
   * @param pluginKey - pluginKey 输入；驱动 `this.getPluginByKey()` 的 插件平台步骤。
   * @param operationKey - operationKey 输入；驱动 `operations.find()` 的 插件平台步骤。
   */
  private getOperation(pluginKey: string, operationKey: string) {
    const plugin = this.getPluginByKey(pluginKey);
    if (!plugin) throwVbenError(`QQBot 插件不存在：${pluginKey}`);
    if (!this.isPluginActive(plugin.key)) {
      throwVbenError(`QQBot 插件未启用：${plugin.key}`);
    }

    const operation = plugin.operations.find(
      (item) => item.key === operationKey,
    );
    if (!operation) {
      throwVbenError(`QQBot 插件能力不存在：${pluginKey}.${operationKey}`);
    }
    return operation;
  }

  /**
   * 执行With Timeout。
   * @param operation - operation 输入；使用 `timeoutMs`、`key` 字段生成结果。
   * @param input - input 输入；驱动 `Promise.resolve()` 的 插件平台步骤。
   * @param context - context 输入；驱动 `Promise.resolve()` 的 插件平台步骤。
   */
  private async executeWithTimeout(
    operation: QqbotIntegrationPlugin['operations'][number],
    input: Record<string, any>,
    context: QqbotPluginOperationContext,
  ) {
    const timeoutMs = Number(operation.timeoutMs || 0);
    const execution = Promise.resolve().then(() =>
      operation.execute(input, context),
    );
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return execution;

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        try {
          throwVbenError(`QQBot 插件能力执行超时：${operation.key}`);
        } catch (error) {
          reject(error);
        }
      }, timeoutMs);
      timer.unref?.();
    });

    try {
      return await Promise.race([execution, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * 查询 QQBot 插件平台数据。
   * @param pluginKey - pluginKey 输入；驱动 `this.getPluginByKey()` 的 插件平台步骤。
   */
  private getPlugins(pluginKey?: string) {
    if (!pluginKey) {
      return [...this.plugins.values()].filter((plugin) =>
        this.isPluginActive(plugin.key),
      );
    }
    const plugin = this.getPluginByKey(pluginKey);
    return plugin && this.isPluginActive(plugin.key) ? [plugin] : [];
  }

  /**
   * 查询 QQBot 插件平台数据。
   * @param pluginKey - pluginKey 输入；限定 插件平台查询范围。
   */
  private getPluginByKey(pluginKey: string) {
    return (
      this.plugins.get(pluginKey) ||
      this.plugins.get(this.pluginAliases.get(pluginKey) || '')
    );
  }

  /**
   * 判断 QQBot 插件平台条件。
   * @param pluginKey - pluginKey 输入；驱动 `inactivePluginKeys.has()` 的 插件平台步骤。
   */
  private isPluginActive(pluginKey: string) {
    return !this.inactivePluginKeys.has(
      this.resolveCanonicalPluginKey(pluginKey),
    );
  }

  /**
   * 解析Canonical Plugin Key。
   * @param pluginKey - pluginKey 输入；驱动 `pluginAliases.get()` 的 插件平台步骤。
   */
  private resolveCanonicalPluginKey(pluginKey: string) {
    return this.pluginAliases.get(pluginKey) || pluginKey;
  }

  /**
   * 执行 QQBot 插件平台流程。
   */
  private async hydrateInactivePluginKeys() {
    if (!this.pluginRepository || !this.installationRepository) return;

    const [plugins, installations] = await Promise.all([
      this.pluginRepository.find(),
      this.installationRepository.find(),
    ]);
    for (const pluginKey of resolveInactivePluginKeys(plugins, installations)) {
      this.setPluginActive(pluginKey, false);
    }
  }
}

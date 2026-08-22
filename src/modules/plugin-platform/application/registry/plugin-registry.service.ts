import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { formatKtDateTime, throwVbenError } from '@/common';
import type {
  BotIntegrationPlugin as BotIntegrationPlugin,
  BotPluginHealth as PluginHealth,
  BotPluginOperationContext as PluginOperationContext,
  BotPluginOperationSummary as PluginOperationSummary,
  BotPluginSummary as PluginSummary,
} from '@/modules/plugin-platform/contract/plugin-protocol';
import {
  Plugin,
  PluginInstallation,
} from '@/modules/plugin-platform/infrastructure/persistence';
import { resolveInactivePluginKeys } from './plugin-installation-state';

@Injectable()
export class PluginRegistryService implements OnModuleInit {
  private readonly inactivePluginKeys = new Set<string>();
  private readonly pluginAliases = new Map<string, string>();
  private readonly plugins = new Map<string, BotIntegrationPlugin>();

  constructor(
    @Optional()
    @InjectRepository(Plugin)
    private readonly pluginRepository?: Repository<Plugin>,
    @Optional()
    @InjectRepository(PluginInstallation)
    private readonly installationRepository?: Repository<PluginInstallation>,
  ) {}

  async onModuleInit() {
    await this.hydrateInactivePluginKeys();
  }

  /**
   * 校验插件键与操作列表后注册插件及旧键别名，并拒绝重复别名。
   * @param plugin - 用于register的领域对象，包含 `key`、`operations`、`legacyKeys` 字段。
   */
  register(plugin: BotIntegrationPlugin) {
    if (!plugin.key || !plugin.operations.length) {
      throwVbenError('Bot 插件必须包含 key 和 operation');
    }
    this.plugins.set(plugin.key, plugin);
    for (const legacyKey of plugin.legacyKeys || []) {
      if (!legacyKey || legacyKey === plugin.key) continue;
      if (this.plugins.has(legacyKey) || this.pluginAliases.has(legacyKey)) {
        throwVbenError(`Bot 插件别名重复：${legacyKey}`);
      }
      this.pluginAliases.set(legacyKey, plugin.key);
    }
  }

  /**
   * 通过 `resolveCanonicalPluginKey` 生成稳定标识。
   * @param pluginKey - 用于读取或更新插件启用状态的稳定键。
   * @param active - 决定插件启用状态内容、边界或目标的 `active` 值。
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
   * 按当前运行态读取Plugins。
   * @returns 按输入顺序得到的Plugins列表；没有匹配项时为空数组。
   */
  listPlugins(): PluginSummary[] {
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
   * 通过 `flatMap` 遍历或定位集合元素。
   * @param pluginKey - 用于读取或更新操作集合的稳定键；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 按输入顺序得到的操作集合列表；没有匹配项时为空数组。
   */
  listOperations(pluginKey?: string): PluginOperationSummary[] {
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
   * 根据`pluginKey`处理健康状态；从 `getPlugins` 读取健康状态。
   * @param pluginKey - 用于读取或更新健康状态的稳定键；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 按输入顺序得到的健康状态列表；没有匹配项时为空数组。
   */
  async health(pluginKey?: string): Promise<PluginHealth[]> {
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
   * 根据`pluginKey`、`operationKey`、`input`处理`execute` 对应结果；从 `getOperation` 读取`execute` 对应结果。
   * @param pluginKey - 用于读取或更新`execute` 对应结果的稳定键。
   * @param operationKey - 用于读取或更新`execute` 对应结果的稳定键。
   * @param input - 用于`execute` 对应结果的结构化输入。
   * @param context - 决定`execute` 对应结果内容、边界或目标的 `context` 值；省略时默认采用 `{}`。
   * @returns `execute` 对应。
   */
  async execute(
    pluginKey: string,
    operationKey: string,
    input: Record<string, any>,
    context: PluginOperationContext = {},
  ) {
    const operation = this.getOperation(pluginKey, operationKey);
    return this.executeWithTimeout(operation, input, context);
  }

  /**
   * 校验`pluginKey`、`operationKey`是否满足操作约束，并拒绝不合法输入；从 `getOperation` 读取操作。
   * @param pluginKey - 用于读取或更新操作的稳定键；为空时采用 `!operationKey` 作为兜底。
   * @param operationKey - 用于读取或更新操作的稳定键；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   */
  assertOperation(pluginKey?: string, operationKey?: string) {
    if (!pluginKey || !operationKey) {
      throwVbenError('请选择插件和插件能力');
    }
    this.getOperation(pluginKey, operationKey);
  }

  /**
   * 按`pluginKey`、`operationKey`读取操作；从 `getPluginByKey` 读取操作。
   * @param pluginKey - 用于读取或更新操作的稳定键。
   * @param operationKey - 用于读取或更新操作的稳定键。
   * @returns 操作。
   */
  private getOperation(pluginKey: string, operationKey: string) {
    const plugin = this.getPluginByKey(pluginKey);
    if (!plugin) throwVbenError(`Bot 插件不存在：${pluginKey}`);
    if (!this.isPluginActive(plugin.key)) {
      throwVbenError(`Bot 插件未启用：${plugin.key}`);
    }

    const operation = plugin.operations.find(
      (item) => item.key === operationKey,
    );
    if (!operation) {
      throwVbenError(`Bot 插件能力不存在：${pluginKey}.${operationKey}`);
    }
    return operation;
  }

  /**
   * 执行插件操作；配置有效正超时时与定时拒绝竞速，并在结束后清理计时器。
   * @param operation - 在当前锁、事务或错误边界内执行的受控回调。
   * @param input - 用于超时的结构化输入。
   * @param context - 决定超时内容、边界或目标的 `context` 值。
   * @returns 超时。
   */
  private async executeWithTimeout(
    operation: BotIntegrationPlugin['operations'][number],
    input: Record<string, any>,
    context: PluginOperationContext,
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
          throwVbenError(`Bot 插件能力执行超时：${operation.key}`);
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
   * 通过 `filter` 筛选匹配数据。
   * @param pluginKey - 用于读取或更新Plugins的稳定键；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 按输入顺序得到的Plugins列表；没有匹配项时为空数组。
   */
  private getPlugins(pluginKey?: string) {
    if (!pluginKey) {
      return [...this.plugins.values()].filter((plugin) =>
        this.isPluginActive(plugin.key),
      );
    }
    const plugin = this.getPluginByKey(pluginKey);
    if (plugin && this.isPluginActive(plugin.key)) {
      return [plugin];
    }
    return [];
  }

  /**
   * 按`pluginKey`读取插件键；从 `plugins.get` 读取插件键。
   * @param pluginKey - 用于读取或更新插件键的稳定键。
   * @returns 规范化后的插件键；主值为空时采用 `this.plugins.get(this.pluginAliases.get(pluginKey)…` 兜底。
   */
  private getPluginByKey(pluginKey: string) {
    return (
      this.plugins.get(pluginKey) ||
      this.plugins.get(this.pluginAliases.get(pluginKey) || '')
    );
  }

  /**
   * 通过 `inactivePluginKeys.has` 判断输入是否满足函数约束。
   * @param pluginKey - 用于读取或更新插件启用状态的稳定键。
   * @returns 满足插件启用状态约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isPluginActive(pluginKey: string) {
    return !this.inactivePluginKeys.has(
      this.resolveCanonicalPluginKey(pluginKey),
    );
  }

  /**
   * 从`pluginKey`解析Canonical插件键；从 `pluginAliases.get` 读取Canonical插件键。
   * @param pluginKey - 用于读取或更新Canonical插件键的稳定键。
   * @returns 规范化后的Canonical插件键；主值为空时采用 `pluginKey` 兜底。
   */
  private resolveCanonicalPluginKey(pluginKey: string) {
    return this.pluginAliases.get(pluginKey) || pluginKey;
  }

  /**
   * 根据当前运行态处理hydrateInactive插件Keys。
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

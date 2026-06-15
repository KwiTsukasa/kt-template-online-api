import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
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

  constructor(
    @Optional()
    private readonly builtinPluginLoader?: QqbotBuiltinPluginPackageLoaderService,
    @Optional()
    @InjectRepository(QqbotPlugin)
    private readonly pluginRepository?: Repository<QqbotPlugin>,
    @Optional()
    @InjectRepository(QqbotPluginInstallation)
    private readonly installationRepository?: Repository<QqbotPluginInstallation>,
  ) {}

  async onModuleInit() {
    for (const plugin of this.builtinPluginLoader?.loadCommandPlugins() || []) {
      this.register(plugin);
    }
    await this.hydrateInactivePluginKeys();
  }

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

  setPluginActive(pluginKey: string, active: boolean) {
    const canonicalKey = this.resolveCanonicalPluginKey(pluginKey);
    if (active) {
      this.inactivePluginKeys.delete(canonicalKey);
      return;
    }
    this.inactivePluginKeys.add(canonicalKey);
  }

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

  async execute(
    pluginKey: string,
    operationKey: string,
    input: Record<string, any>,
    context: QqbotPluginOperationContext = {},
  ) {
    const operation = this.getOperation(pluginKey, operationKey);
    return this.executeWithTimeout(operation, input, context);
  }

  assertOperation(pluginKey?: string, operationKey?: string) {
    if (!pluginKey || !operationKey) {
      throwVbenError('请选择插件和插件能力');
    }
    this.getOperation(pluginKey, operationKey);
  }

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

  private getPlugins(pluginKey?: string) {
    if (!pluginKey) {
      return [...this.plugins.values()].filter((plugin) =>
        this.isPluginActive(plugin.key),
      );
    }
    const plugin = this.getPluginByKey(pluginKey);
    return plugin && this.isPluginActive(plugin.key) ? [plugin] : [];
  }

  private getPluginByKey(pluginKey: string) {
    return (
      this.plugins.get(pluginKey) ||
      this.plugins.get(this.pluginAliases.get(pluginKey) || '')
    );
  }

  private isPluginActive(pluginKey: string) {
    return !this.inactivePluginKeys.has(this.resolveCanonicalPluginKey(pluginKey));
  }

  private resolveCanonicalPluginKey(pluginKey: string) {
    return this.pluginAliases.get(pluginKey) || pluginKey;
  }

  private async hydrateInactivePluginKeys() {
    if (!this.pluginRepository || !this.installationRepository) return;

    const [plugins, installations] = await Promise.all([
      this.pluginRepository.find(),
      this.installationRepository.find(),
    ]);
    for (const pluginKey of resolveInactivePluginKeys(
      plugins,
      installations,
    )) {
      this.setPluginActive(pluginKey, false);
    }
  }
}

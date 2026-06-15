import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { formatKtDateTime, throwVbenError } from '@/common';
import type {
  QqbotIntegrationPlugin,
  QqbotPluginHealth,
  QqbotPluginOperationContext,
  QqbotPluginOperationSummary,
  QqbotPluginSummary,
} from '@/modules/qqbot/core/contract/qqbot.types';
import { QqbotBuiltinPluginPackageLoaderService } from '@/modules/qqbot/plugin-platform/infrastructure/integration/package/builtin-plugin-package-loader.service';

@Injectable()
export class QqbotPluginRegistryService implements OnModuleInit {
  private readonly pluginAliases = new Map<string, string>();
  private readonly plugins = new Map<string, QqbotIntegrationPlugin>();

  constructor(
    @Optional()
    private readonly builtinPluginLoader?: QqbotBuiltinPluginPackageLoaderService,
  ) {}

  onModuleInit() {
    for (const plugin of this.builtinPluginLoader?.loadCommandPlugins() || []) {
      this.register(plugin);
    }
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

  listPlugins(): QqbotPluginSummary[] {
    return [...this.plugins.values()].map((plugin) => ({
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
        cacheTtlMs: operation.cacheTtlMs,
        description: operation.description,
        inputSchema: operation.inputSchema,
        key: operation.key,
        name: operation.name,
        outputSchema: operation.outputSchema,
        pluginKey: plugin.key,
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
    return operation.execute(input, context);
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

    const operation = plugin.operations.find(
      (item) => item.key === operationKey,
    );
    if (!operation) {
      throwVbenError(`QQBot 插件能力不存在：${pluginKey}.${operationKey}`);
    }
    return operation;
  }

  private getPlugins(pluginKey?: string) {
    if (!pluginKey) return [...this.plugins.values()];
    const plugin = this.getPluginByKey(pluginKey);
    return plugin ? [plugin] : [];
  }

  private getPluginByKey(pluginKey: string) {
    return (
      this.plugins.get(pluginKey) ||
      this.plugins.get(this.pluginAliases.get(pluginKey) || '')
    );
  }
}

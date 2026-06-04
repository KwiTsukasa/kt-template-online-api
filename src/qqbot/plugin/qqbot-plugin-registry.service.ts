import { Injectable, OnModuleInit } from '@nestjs/common';
import { throwVbenError } from '@/common';
import { QqbotFf14MarketPluginService } from '../plugins/ff14Market/qqbot-ff14-market.plugin';
import { QqbotFflogsPluginService } from '../plugins/fflogs/qqbot-fflogs.plugin';
import type {
  QqbotIntegrationPlugin,
  QqbotPluginHealth,
  QqbotPluginOperationContext,
  QqbotPluginOperationSummary,
  QqbotPluginSummary,
} from '../qqbot.types';

@Injectable()
export class QqbotPluginRegistryService implements OnModuleInit {
  private readonly plugins = new Map<string, QqbotIntegrationPlugin>();

  constructor(
    private readonly ff14MarketPlugin: QqbotFf14MarketPluginService,
    private readonly fflogsPlugin: QqbotFflogsPluginService,
  ) {}

  onModuleInit() {
    this.register(this.ff14MarketPlugin.getPlugin());
    this.register(this.fflogsPlugin.getPlugin());
  }

  register(plugin: QqbotIntegrationPlugin) {
    if (!plugin.key || !plugin.operations.length) {
      throwVbenError('QQBot 插件必须包含 key 和 operation');
    }
    this.plugins.set(plugin.key, plugin);
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
            checkedAt: new Date().toISOString(),
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
    const plugin = this.plugins.get(pluginKey);
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
    const plugin = this.plugins.get(pluginKey);
    return plugin ? [plugin] : [];
  }
}

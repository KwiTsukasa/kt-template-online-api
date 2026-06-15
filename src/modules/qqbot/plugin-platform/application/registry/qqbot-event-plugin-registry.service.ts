import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { formatKtDateTime, throwVbenError } from '@/common';
import { QqbotAccountService } from '@/modules/qqbot/core/application/account/qqbot-account.service';
import type {
  QqbotEventPluginDefinition,
  QqbotNormalizedMessage,
  QqbotPluginHealth,
  QqbotPluginOperationSummary,
} from '@/modules/qqbot/core/contract/qqbot.types';
import {
  QqbotBuiltinPluginPackageLoaderService,
  type QqbotEventPluginPackage,
} from '@/modules/qqbot/plugin-platform/infrastructure/integration/package/builtin-plugin-package-loader.service';
import {
  QqbotPlugin,
  QqbotPluginInstallation,
} from '@/modules/qqbot/plugin-platform/infrastructure/persistence';
import { resolveInactivePluginKeys } from './plugin-installation-state';

@Injectable()
export class QqbotEventPluginRegistryService implements OnModuleInit {
  private readonly eventPlugins = new Map<string, QqbotEventPluginPackage>();
  private readonly inactivePluginKeys = new Set<string>();

  constructor(
    private readonly accountService: QqbotAccountService,
    private readonly builtinPluginLoader: QqbotBuiltinPluginPackageLoaderService,
    @Optional()
    @InjectRepository(QqbotPlugin)
    private readonly pluginRepository?: Repository<QqbotPlugin>,
    @Optional()
    @InjectRepository(QqbotPluginInstallation)
    private readonly installationRepository?: Repository<QqbotPluginInstallation>,
  ) {}

  async onModuleInit() {
    this.loadBuiltinEventPlugins();
    await this.hydrateInactivePluginKeys();
  }

  registerEventPlugin(plugin: QqbotEventPluginPackage) {
    const definition = plugin.getDefinition();
    if (!definition.key) {
      throwVbenError('QQBot 事件插件必须包含 key');
    }
    if (this.eventPlugins.has(definition.key)) {
      throwVbenError(`QQBot 事件插件重复：${definition.key}`);
    }
    this.eventPlugins.set(definition.key, plugin);
  }

  listDefinitions(pluginKey?: string): QqbotEventPluginDefinition[] {
    return this.getDefinitions(pluginKey);
  }

  setPluginActive(pluginKey: string, active: boolean) {
    if (active) {
      this.inactivePluginKeys.delete(pluginKey);
      return;
    }
    this.inactivePluginKeys.add(pluginKey);
  }

  async listPlugins(selfId?: string) {
    const plugins = this.getActiveEventPlugins();
    const accounts = selfId
      ? [await this.accountService.findBySelfId(selfId)]
      : await this.accountService.allEnabled();
    return Promise.all(
      accounts
        .filter((account): account is NonNullable<typeof account> => !!account)
        .flatMap((account) =>
          plugins.map((plugin) =>
            plugin.getSummary({
              accountName: account.name,
              connectStatus: account.connectStatus,
              selfId: account.selfId,
            }),
          ),
        ),
    );
  }

  listOperations(pluginKey?: string): QqbotPluginOperationSummary[] {
    return this.getDefinitions(pluginKey).map((definition) => ({
      description: definition.description,
      inputSchema: {
        triggerType: definition.triggerType,
      },
      key: definition.triggerType,
      name: definition.triggerType === 'message' ? '消息事件' : definition.name,
      outputSchema: undefined,
      pluginKey: definition.key,
      triggerMode: 'event',
    }));
  }

  async health(pluginKey?: string): Promise<QqbotPluginHealth[]> {
    return this.getDefinitions(pluginKey).map((definition) => ({
      checkedAt: formatKtDateTime(new Date()),
      message: definition.remark || '事件插件由账号配置绑定后触发',
      name: definition.name,
      pluginKey: definition.key,
      status: 'healthy',
      triggerMode: 'event',
    }));
  }

  async dispatchMessage(message: QqbotNormalizedMessage) {
    let handled = false;
    for (const plugin of this.getActiveEventPlugins()) {
      const definition = plugin.getDefinition();
      if (definition.triggerType !== 'message') continue;
      handled = (await plugin.handleMessage(message)) || handled;
    }
    return handled;
  }

  async bind(pluginKey: string, selfId: string) {
    return this.requirePlugin(pluginKey).bind(selfId);
  }

  async unbind(pluginKey: string, selfId: string) {
    return this.requirePlugin(pluginKey).unbind(selfId);
  }

  private requirePlugin(pluginKey: string) {
    this.ensureEventPluginsLoaded();
    const plugin = this.eventPlugins.get(pluginKey);
    if (!plugin) {
      throwVbenError(`QQBot 事件插件不存在：${pluginKey}`);
    }
    if (!this.isPluginActive(pluginKey)) {
      throwVbenError(`QQBot 事件插件未启用：${pluginKey}`);
    }
    return plugin;
  }

  private getDefinitions(pluginKey?: string): QqbotEventPluginDefinition[] {
    const definitions = this.getActiveEventPlugins().map((plugin) =>
      plugin.getDefinition(),
    );
    return pluginKey
      ? definitions.filter((definition) => definition.key === pluginKey)
      : definitions;
  }

  private isPluginActive(pluginKey: string) {
    return !this.inactivePluginKeys.has(pluginKey);
  }

  private getActiveEventPlugins() {
    this.ensureEventPluginsLoaded();
    return [...this.eventPlugins.entries()]
      .filter(([pluginKey]) => this.isPluginActive(pluginKey))
      .map(([, plugin]) => plugin);
  }

  private ensureEventPluginsLoaded() {
    if (this.eventPlugins.size) return;
    this.loadBuiltinEventPlugins();
  }

  private loadBuiltinEventPlugins() {
    for (const plugin of this.builtinPluginLoader.loadEventPlugins()) {
      if (!this.eventPlugins.has(plugin.getDefinition().key)) {
        this.registerEventPlugin(plugin);
      }
    }
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

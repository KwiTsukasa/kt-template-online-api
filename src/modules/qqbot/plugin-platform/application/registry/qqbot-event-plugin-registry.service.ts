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

  /**
   * 初始化 QqbotEventPluginRegistryService 实例。
   * @param accountService - accountService 服务依赖；影响 constructor 的返回值。
   * @param builtinPluginLoader - builtinPluginLoader 输入；影响 constructor 的返回值。
   * @param pluginRepository - 插件仓库依赖；影响 constructor 的返回值。
   * @param installationRepository - 插件平台仓库依赖；影响 constructor 的返回值。
   */
  constructor(
    private readonly accountService: QqbotAccountService,
    @Inject(forwardRef(() => QqbotBuiltinPluginPackageLoaderService))
    private readonly builtinPluginLoader: QqbotBuiltinPluginPackageLoaderService,
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
    this.loadBuiltinEventPlugins();
    await this.hydrateInactivePluginKeys();
  }

  /**
   * 执行 QQBot 插件平台流程。
   * @param plugin - plugin 输入；执行 `plugin.getDefinition()` 对应的 插件平台步骤。
   */
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

  /**
   * 列出Definitions。
   * @param pluginKey - pluginKey 输入；驱动 `this.getDefinitions()` 的 插件平台步骤。
   * @returns QQBot 插件平台查询结果。
   */
  listDefinitions(pluginKey?: string): QqbotEventPluginDefinition[] {
    return this.getDefinitions(pluginKey);
  }

  /**
   * 设置Plugin Active。
   * @param pluginKey - pluginKey 输入；驱动 `inactivePluginKeys.delete()`、`inactivePluginKeys.add()` 的 插件平台步骤。
   * @param active - active 输入；决定 插件平台条件分支。
   */
  setPluginActive(pluginKey: string, active: boolean) {
    if (active) {
      this.inactivePluginKeys.delete(pluginKey);
      return;
    }
    this.inactivePluginKeys.add(pluginKey);
  }

  /**
   * 列出Plugins。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   */
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

  /**
   * 列出Operations。
   * @param pluginKey - pluginKey 输入；驱动 `this.getDefinitions()` 的 插件平台步骤。
   * @returns QQBot 插件平台查询结果。
   */
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

  /**
   * 执行 QQBot 插件平台流程。
   * @param pluginKey - pluginKey 输入；驱动 `this.getDefinitions()`、`formatKtDateTime()` 的 插件平台步骤。
   * @returns 异步完成后的 QQBot 插件平台结果。
   */
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

  /**
   * 投递 QQBot 插件平台消息或任务。
   * @param message - message 输入；驱动 `plugin.handleMessage()` 的 插件平台步骤。
   */
  async dispatchMessage(message: QqbotNormalizedMessage) {
    let handled = false;
    for (const plugin of this.getActiveEventPlugins()) {
      const definition = plugin.getDefinition();
      if (definition.triggerType !== 'message') continue;
      handled = (await plugin.handleMessage(message)) || handled;
    }
    return handled;
  }

  /**
   * 执行 QQBot 插件平台流程。
   * @param pluginKey - pluginKey 输入；驱动 `this.requirePlugin()` 的 插件平台步骤。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   */
  async bind(pluginKey: string, selfId: string) {
    return this.requirePlugin(pluginKey).bind(selfId);
  }

  /**
   * 执行 QQBot 插件平台流程。
   * @param pluginKey - pluginKey 输入；驱动 `this.requirePlugin()` 的 插件平台步骤。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   */
  async unbind(pluginKey: string, selfId: string) {
    return this.requirePlugin(pluginKey).unbind(selfId);
  }

  /**
   * 执行 QQBot 插件平台流程。
   * @param pluginKey - pluginKey 输入；驱动 `eventPlugins.get()` 的 插件平台步骤。
   */
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

  /**
   * 查询 QQBot 插件平台数据。
   * @param pluginKey - pluginKey 输入；驱动 `definitions.filter()` 的 插件平台步骤。
   * @returns QQBot 插件平台查询结果。
   */
  private getDefinitions(pluginKey?: string): QqbotEventPluginDefinition[] {
    const definitions = this.getActiveEventPlugins().map((plugin) =>
      plugin.getDefinition(),
    );
    return pluginKey
      ? definitions.filter((definition) => definition.key === pluginKey)
      : definitions;
  }

  /**
   * 判断 QQBot 插件平台条件。
   * @param pluginKey - pluginKey 输入；驱动 `inactivePluginKeys.has()` 的 插件平台步骤。
   */
  private isPluginActive(pluginKey: string) {
    return !this.inactivePluginKeys.has(pluginKey);
  }

  /**
   * 查询 QQBot 插件平台数据。
   */
  private getActiveEventPlugins() {
    this.ensureEventPluginsLoaded();
    return [...this.eventPlugins.entries()]
      .filter(([pluginKey]) => this.isPluginActive(pluginKey))
      .map(([, plugin]) => plugin);
  }

  /**
   * 确保Event Plugins Loaded。
   */
  private ensureEventPluginsLoaded() {
    if (this.eventPlugins.size) return;
    this.loadBuiltinEventPlugins();
  }

  /**
   * 加载Builtin Event Plugins。
   */
  private loadBuiltinEventPlugins() {
    for (const plugin of this.builtinPluginLoader.loadEventPlugins()) {
      if (!this.eventPlugins.has(plugin.getDefinition().key)) {
        this.registerEventPlugin(plugin);
      }
    }
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

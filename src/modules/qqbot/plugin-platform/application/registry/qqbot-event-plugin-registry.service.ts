import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { formatKtDateTime, throwVbenError } from '@/common';
import { QqbotAccountService } from '@/modules/qqbot/core/application/account/qqbot-account.service';
import type {
  QqbotEventPluginDefinition,
  QqbotEventPluginSummary,
  QqbotNormalizedMessage,
  QqbotPluginHealth,
  QqbotPluginOperationSummary,
} from '@/modules/qqbot/core/contract/qqbot.types';
import {
  QqbotPlugin,
  QqbotPluginInstallation,
} from '@/modules/qqbot/plugin-platform/infrastructure/persistence';
import { resolveInactivePluginKeys } from './plugin-installation-state';

@Injectable()
export class QqbotEventPluginRegistryService implements OnModuleInit {
  private readonly inactivePluginKeys = new Set<string>();
  private readonly runtimeEventsByPluginKey = new Map<
    string,
    QqbotEventPluginDefinition[]
  >();

  /**
   * 初始化 QqbotEventPluginRegistryService 实例。
   * @param accountService - QQBot 账号服务；读写账号与事件插件能力绑定关系。
   * @param pluginRepository - 插件仓库依赖；用于启动时恢复禁用插件状态。
   * @param installationRepository - 插件安装仓库依赖；用于启动时恢复禁用插件状态。
   */
  constructor(
    private readonly accountService: QqbotAccountService,
    @Optional()
    @InjectRepository(QqbotPlugin)
    private readonly pluginRepository?: Repository<QqbotPlugin>,
    @Optional()
    @InjectRepository(QqbotPluginInstallation)
    private readonly installationRepository?: Repository<QqbotPluginInstallation>,
  ) {}

  /**
   * Initializes inactive event plugin state without loading package instances.
   * @returns Promise that resolves after persisted installation state is loaded.
   */
  async onModuleInit(): Promise<void> {
    await this.hydrateInactivePluginKeys();
  }

  /**
   * Registers event metadata emitted by an active plugin worker.
   * @param pluginKey - Package key from the active worker descriptor.
   * @param events - Event definitions returned from the runtime manifest summary.
   */
  registerRuntimeEvents(
    pluginKey: string,
    events: QqbotEventPluginDefinition[],
  ): void {
    if (events.length <= 0) {
      this.runtimeEventsByPluginKey.delete(pluginKey);
      return;
    }
    this.runtimeEventsByPluginKey.set(pluginKey, events);
  }

  /**
   * Removes event metadata when the owning runtime worker stops.
   * @param pluginKey - Package key whose active runtime metadata should be removed.
   */
  unregisterRuntimeEvents(pluginKey: string): void {
    this.runtimeEventsByPluginKey.delete(pluginKey);
  }

  /**
   * 列出Definitions。
   * @param pluginKey - 可选插件包 key；限定 Admin 事件插件元数据的返回范围。
   * @returns QQBot 插件平台查询结果。
   */
  listDefinitions(pluginKey?: string): QqbotEventPluginDefinition[] {
    return this.getDefinitions(pluginKey);
  }

  /**
   * 设置Plugin Active。
   * @param pluginKey - 插件包 key；对应持久化安装状态中的 active/inactive 语义。
   * @param active - 是否启用该插件的事件元数据和绑定入口。
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
   * @param selfId - 可选 QQ 账号 selfId；为空时为所有启用账号生成事件插件绑定摘要。
   */
  async listPlugins(selfId?: string): Promise<QqbotEventPluginSummary[]> {
    const definitions = this.getDefinitions();
    const accounts = selfId
      ? [await this.accountService.findBySelfId(selfId)]
      : await this.accountService.allEnabled();
    const accountSummaries = await Promise.all(
      accounts
        .filter((account): account is NonNullable<typeof account> => !!account)
        .map(async (account) => {
          const boundKeys = new Set(
            await this.accountService.getBoundEventPluginKeys(account.selfId),
          );
          return definitions.map((definition) => ({
            accountName: account.name,
            bound: boundKeys.has(definition.key),
            connectStatus: account.connectStatus,
            description: definition.description,
            key: definition.key,
            name: definition.name,
            remark: definition.remark,
            selfId: account.selfId,
            triggerType: definition.triggerType,
            version: definition.version,
          }));
        }),
    );
    return accountSummaries.flat();
  }

  /**
   * 列出Operations。
   * @param pluginKey - 可选插件包 key；用于筛选 Admin 展示的事件触发能力。
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
   * @param pluginKey - 可选插件包 key；用于筛选需要返回健康状态的事件插件元数据。
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
   * Keeps the historical registry dispatch method inert while platform workers own event execution.
   * @param message - Normalized QQBot message supplied by old registry callers; ignored after worker routing.
   * @returns Always `false` because worker event execution is routed through `QqbotPluginPlatformService`.
   */
  async dispatchMessage(message: QqbotNormalizedMessage): Promise<boolean> {
    void message;
    return false;
  }

  /**
   * 执行 QQBot 插件平台流程。
   * @param pluginKey - 插件包 key；必须存在于当前 runtime event metadata 后才能绑定。
   * @param selfId - QQ 账号 selfId；作为账号能力绑定表的目标账号。
   */
  async bind(pluginKey: string, selfId: string) {
    this.requireDefinition(pluginKey);
    return this.accountService.bindEventPlugin(selfId, pluginKey);
  }

  /**
   * 执行 QQBot 插件平台流程。
   * @param pluginKey - 插件包 key；必须存在于当前 runtime event metadata 后才能解绑。
   * @param selfId - QQ 账号 selfId；作为账号能力绑定表的目标账号。
   */
  async unbind(pluginKey: string, selfId: string) {
    this.requireDefinition(pluginKey);
    return this.accountService.unbindEventPlugin(selfId, pluginKey);
  }

  /**
   * Requires active runtime event metadata for an event plugin key.
   * @param pluginKey - Event plugin package key requested by Admin binding APIs.
   * @returns Runtime event definition for the active plugin.
   */
  private requireDefinition(pluginKey: string) {
    const definition = this.getDefinitions(pluginKey)[0];
    if (!definition) {
      const suffix = this.inactivePluginKeys.has(pluginKey)
        ? '未启用'
        : '不存在';
      throwVbenError(`QQBot 事件插件${suffix}：${pluginKey}`);
    }
    return definition;
  }

  /**
   * 查询 QQBot 插件平台数据。
   * @param pluginKey - 可选插件包 key；为空时返回所有 active runtime event definitions。
   * @returns QQBot 插件平台查询结果。
   */
  private getDefinitions(pluginKey?: string): QqbotEventPluginDefinition[] {
    const definitions = [...this.runtimeEventsByPluginKey.entries()]
      .filter(([key]) => this.isPluginActive(key))
      .flatMap(([, events]) => events);
    return pluginKey
      ? definitions.filter((definition) => definition.key === pluginKey)
      : definitions;
  }

  /**
   * 判断 QQBot 插件平台条件。
   * @param pluginKey - 插件包 key；用于读取启动时或安装状态切换时维护的 inactive 集合。
   */
  private isPluginActive(pluginKey: string) {
    return !this.inactivePluginKeys.has(pluginKey);
  }

  /**
   * Hydrates inactive event plugin keys from persisted plugin installations.
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

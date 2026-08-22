import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { formatKtDateTime } from '@/common';
import type {
  BotEventPluginDefinition as PluginEventDefinition,
  BotPluginHealth as PluginHealth,
  BotPluginOperationSummary as PluginOperationSummary,
} from '@/modules/plugin-platform/contract/plugin-protocol';
import {
  Plugin,
  PluginInstallation,
} from '@/modules/plugin-platform/infrastructure/persistence';
import { resolveInactivePluginKeys } from './plugin-installation-state';

@Injectable()
export class PluginEventRegistryService implements OnModuleInit {
  private readonly inactivePluginKeys = new Set<string>();
  private readonly runtimeEventsByPluginKey = new Map<
    string,
    PluginEventDefinition[]
  >();

  constructor(
    @Optional()
    @InjectRepository(Plugin)
    private readonly pluginRepository?: Repository<Plugin>,
    @Optional()
    @InjectRepository(PluginInstallation)
    private readonly installationRepository?: Repository<PluginInstallation>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.hydrateInactivePluginKeys();
  }

  /**
   * 根据`pluginKey`、`events`处理运行态事件；当 `events.length <= 0` 成立时直接结束且不产生返回值。
   * @param pluginKey - 用于读取或更新运行态事件的稳定键。
   * @param events - 按原有顺序参与运行态事件筛选、合并或汇总的集合。
   */
  registerRuntimeEvents(
    pluginKey: string,
    events: PluginEventDefinition[],
  ): void {
    if (events.length <= 0) {
      this.runtimeEventsByPluginKey.delete(pluginKey);
      return;
    }
    this.runtimeEventsByPluginKey.set(pluginKey, events);
  }

  /**
   * 根据参数 `pluginKey`，删除指定插件的运行时事件定义，使后续消息不再路由到该插件。
   * @param pluginKey - 用于读取或更新unregister运行态事件流的稳定键。
   */
  unregisterRuntimeEvents(pluginKey: string): void {
    this.runtimeEventsByPluginKey.delete(pluginKey);
  }

  /**
   * 按`pluginKey`读取定义列表；从 `getDefinitions` 读取定义列表。
   * @param pluginKey - 用于读取或更新定义列表的稳定键；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 按输入顺序得到的定义列表；没有匹配项时为空数组。
   */
  listDefinitions(pluginKey?: string): PluginEventDefinition[] {
    return this.getDefinitions(pluginKey);
  }

  /**
   * 根据`pluginKey`、`active`更新插件启用状态；当 `active` 成立时直接结束且不产生返回值。
   * @param pluginKey - 用于读取或更新插件启用状态的稳定键。
   * @param active - 决定插件启用状态内容、边界或目标的 `active` 值。
   */
  setPluginActive(pluginKey: string, active: boolean) {
    if (active) {
      this.inactivePluginKeys.delete(pluginKey);
      return;
    }
    this.inactivePluginKeys.add(pluginKey);
  }

  /**
   * 读取当前已启用事件协议插件的无账号定义，绑定状态由各 Bot 适配器自行投影。
   * @returns 按运行时注册顺序排列的事件插件定义。
   */
  listPlugins(): PluginEventDefinition[] {
    return this.getDefinitions();
  }

  /**
   * 按`pluginKey`读取操作集合；从 `getDefinitions` 读取操作集合。
   * @param pluginKey - 用于读取或更新操作集合的稳定键；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 按输入顺序得到的操作集合列表；没有匹配项时为空数组。
   */
  listOperations(pluginKey?: string): PluginOperationSummary[] {
    return this.getDefinitions(pluginKey).map((definition) => ({
      description: definition.description,
      inputSchema: {
        triggerType: definition.triggerType,
      },
      key: definition.triggerType,
      name: (() => {
        if (definition.triggerType === 'message') {
          return '消息事件';
        }
        return definition.name;
      })(),
      outputSchema: undefined,
      pluginKey: definition.key,
      triggerMode: 'event',
    }));
  }

  /**
   * 根据`pluginKey`处理健康状态；从 `getDefinitions` 读取健康状态。
   * @param pluginKey - 用于读取或更新健康状态的稳定键；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 按输入顺序得到的健康状态列表；没有匹配项时为空数组。
   */
  async health(pluginKey?: string): Promise<PluginHealth[]> {
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
   * 通过 `flatMap` 遍历或定位集合元素。
   * @param pluginKey - 用于读取或更新定义列表的稳定键；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 按输入顺序得到的定义列表；没有匹配项时为空数组。
   */
  private getDefinitions(pluginKey?: string): PluginEventDefinition[] {
    const definitions = [...this.runtimeEventsByPluginKey.entries()]
      .filter(([key]) => this.isPluginActive(key))
      .flatMap(([, events]) => events);
    if (pluginKey) {
      return definitions.filter((definition) => definition.key === pluginKey);
    }
    return definitions;
  }

  /**
   * 通过 `inactivePluginKeys.has` 判断输入是否满足函数约束。
   * @param pluginKey - 用于读取或更新插件启用状态的稳定键。
   * @returns 满足插件启用状态约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isPluginActive(pluginKey: string) {
    return !this.inactivePluginKeys.has(pluginKey);
  }

  /**
   * 恢复未激活的插件键；通过 `pluginRepository.find` 查询匹配的持久化记录，通过 `installationRepository.find` 查询匹配的持久化记录，等待 `resolveInactivePluginKeys` 返回后继续处理未激活的插件键，按输入顺序逐项处理。
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

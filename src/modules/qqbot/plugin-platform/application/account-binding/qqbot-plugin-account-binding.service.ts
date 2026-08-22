import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { throwVbenError } from '@/common';
import { QqbotAccountService } from '@/modules/qqbot/core/application/account/qqbot-account.service';
import type { QqbotAccount } from '@/modules/qqbot/core/infrastructure/persistence/account/qqbot-account.entity';
import {
  QqbotPlugin,
  QqbotPluginAccountBinding,
} from '../../infrastructure/persistence';

export type QqbotPluginAccountBindingIdentity = {
  accountId?: string;
  pluginId?: string;
  pluginKey?: string;
  selfId?: string;
};

export type QqbotPluginAccountBindingSummary = {
  accountId: string;
  accountName: string;
  bound: boolean;
  connectionMode: QqbotAccount['connectionMode'];
  enabled: boolean;
  id: null | string;
  pluginId: string;
  pluginKey: string;
  pluginName: string;
  selfId: string;
};

@Injectable()
export class QqbotPluginAccountBindingService {
  constructor(
    @InjectRepository(QqbotPluginAccountBinding)
    private readonly bindingRepository: Repository<QqbotPluginAccountBinding>,
    @InjectRepository(QqbotPlugin)
    private readonly pluginRepository: Repository<QqbotPlugin>,
    private readonly accountService: QqbotAccountService,
  ) {}

  /**
   * 对全部启用账号与未卸载插件做候选矩阵投影，再合并持久化行得到可直接管理的实际绑定状态。
   * @param pluginId - 可选插件主键；提供时只返回该插件的账号绑定候选。
   * @returns 包含账号、transport、插件和实际绑定状态的稳定矩阵。
   */
  async list(pluginId?: string): Promise<QqbotPluginAccountBindingSummary[]> {
    const [accounts, allPlugins, bindings] = await Promise.all([
      this.accountService.allEnabled(),
      this.pluginRepository.find({ order: { pluginName: 'ASC' } }),
      this.bindingRepository.find({
        where: (() => {
          if (pluginId) return { pluginId };
          return undefined;
        })(),
      }),
    ]);
    const plugins = allPlugins.filter((plugin) => {
      if (plugin.status === 'uninstalled') return false;
      if (pluginId && plugin.id !== pluginId) return false;
      return true;
    });
    const bindingMap = new Map(
      bindings.map((binding) => [
        this.bindingKey(binding.accountId, binding.pluginId),
        binding,
      ]),
    );
    const summaries: QqbotPluginAccountBindingSummary[] = [];
    for (const account of accounts) {
      for (const plugin of plugins) {
        summaries.push(
          this.buildSummary(
            account,
            plugin,
            bindingMap.get(this.bindingKey(account.id, plugin.id)),
          ),
        );
      }
    }
    return summaries;
  }

  /**
   * 按账号和插件身份恢复或新建平台绑定，重复调用保持同一行并重新启用。
   * @param input - 可使用主键或稳定业务键定位账号与插件。
   * @returns 写入后的账号插件绑定摘要。
   */
  async bind(
    input: QqbotPluginAccountBindingIdentity,
  ): Promise<QqbotPluginAccountBindingSummary> {
    const { account, plugin } = await this.requirePair(input);
    const existing = await this.bindingRepository.findOne({
      where: { accountId: account.id, pluginId: plugin.id },
    });
    let binding = existing;
    if (existing) {
      await this.bindingRepository.update(
        { id: existing.id },
        { enabled: true },
      );
      existing.enabled = true;
      binding = existing;
    } else {
      binding = await this.bindingRepository.save(
        this.bindingRepository.create({
          accountId: account.id,
          enabled: true,
          pluginId: plugin.id,
        }),
      );
    }
    return this.buildSummary(account, plugin, binding);
  }

  /**
   * 按账号和插件身份停用平台绑定，保留原行供后续幂等恢复。
   * @param input - 可使用主键或稳定业务键定位账号与插件。
   * @returns 完成停用后固定返回 true。
   */
  async unbind(input: QqbotPluginAccountBindingIdentity): Promise<boolean> {
    const { account, plugin } = await this.requirePair(input);
    await this.bindingRepository.update(
      { accountId: account.id, pluginId: plugin.id },
      { enabled: false },
    );
    return true;
  }

  /**
   * 读取指定账号当前启用且未卸载的插件键，供命令和事件统一执行门禁复用。
   * @param selfId - NapCat QQ 号或 `qq-official:<AppID>` 官方账号键。
   * @returns 按插件键排序的已绑定插件集合；账号不可用时为空数组。
   */
  async listBoundPluginKeys(selfId: string): Promise<string[]> {
    const account = await this.accountService.findBySelfId(
      `${selfId || ''}`.trim(),
    );
    if (!account || !account.enabled || account.isDeleted) return [];
    const bindings = await this.bindingRepository.find({
      where: { accountId: account.id, enabled: true },
    });
    const pluginIds = [...new Set(bindings.map((item) => item.pluginId))];
    if (pluginIds.length === 0) return [];
    const plugins = await this.pluginRepository.find({
      where: { id: In(pluginIds) },
    });
    return plugins
      .filter((plugin) => plugin.status !== 'uninstalled')
      .map((plugin) => plugin.pluginKey)
      .sort();
  }

  /**
   * 将账号和插件稳定身份解析为内部主键，并以启用行计数判定该插件是否可在账号上执行。
   * @param input - 必须提供账号稳定键与插件稳定键。
   * @returns 账号和插件均有效且存在启用绑定时返回 true。
   */
  async isBound(input: QqbotPluginAccountBindingIdentity): Promise<boolean> {
    const { account, plugin } = await this.findPair(input);
    if (!account || !plugin) return false;
    const count = await this.bindingRepository.count({
      where: { accountId: account.id, enabled: true, pluginId: plugin.id },
    });
    return count > 0;
  }

  /**
   * 校验账号已通过插件平台绑定目标插件，未绑定时给出可直接处理的中文错误。
   * @param input - 必须提供账号稳定键与插件稳定键。
   * @returns 绑定存在时固定返回 true。
   * @throws 账号、插件不存在或平台绑定未启用时抛出业务错误。
   */
  async assertBound(
    input: QqbotPluginAccountBindingIdentity,
  ): Promise<boolean> {
    const bound = await this.isBound(input);
    if (!bound) {
      throwVbenError(
        `QQBot 插件未绑定到当前账号：${input.pluginKey || input.pluginId || '-'}`,
      );
    }
    return true;
  }

  /**
   * 通过主键或稳定业务键解析可配置账号与未卸载插件，并把无效身份归一为空值。
   * @param input - 账号和插件定位字段。
   * @returns 解析后的可选账号与插件。
   */
  private async findPair(input: QqbotPluginAccountBindingIdentity): Promise<{
    account: null | QqbotAccount;
    plugin: null | QqbotPlugin;
  }> {
    let account: null | QqbotAccount = null;
    if (input.accountId) {
      account = await this.accountService.findById(input.accountId);
    } else if (input.selfId) {
      account = await this.accountService.findBySelfId(input.selfId.trim());
    }
    let plugin: null | QqbotPlugin = null;
    if (input.pluginId) {
      plugin = await this.pluginRepository.findOne({
        where: { id: input.pluginId },
      });
    } else if (input.pluginKey) {
      plugin = await this.pluginRepository.findOne({
        where: { pluginKey: input.pluginKey.trim() },
      });
    }
    const accountValid = !!account && account.enabled && !account.isDeleted;
    const pluginValid = !!plugin && plugin.status !== 'uninstalled';
    if (!accountValid) account = null;
    if (!pluginValid) plugin = null;
    return { account, plugin };
  }

  /**
   * 强制解析可配置账号与未卸载插件，为写入操作提供非空身份。
   * @param input - 账号和插件定位字段。
   * @returns 已验证为非空的账号与插件。
   * @throws 账号或插件不存在、停用或已卸载时抛出业务错误。
   */
  private async requirePair(
    input: QqbotPluginAccountBindingIdentity,
  ): Promise<{ account: QqbotAccount; plugin: QqbotPlugin }> {
    const { account, plugin } = await this.findPair(input);
    if (!account) throwVbenError('QQBot 账号不存在或已停用');
    if (!plugin) throwVbenError('QQBot 插件不存在或已卸载');
    return { account, plugin };
  }

  /**
   * 将账号、插件和可选持久化行投影为 Admin 可直接展示的绑定摘要。
   * @param account - 已启用 QQBot 账号。
   * @param plugin - 未卸载插件记录。
   * @param binding - 可选平台绑定行；缺失表示尚未绑定。
   * @returns transport-neutral 的账号插件绑定摘要。
   */
  private buildSummary(
    account: QqbotAccount,
    plugin: QqbotPlugin,
    binding?: QqbotPluginAccountBinding,
  ): QqbotPluginAccountBindingSummary {
    const bound = !!binding?.enabled;
    return {
      accountId: account.id,
      accountName: account.name,
      bound,
      connectionMode: account.connectionMode,
      enabled: bound,
      id: binding?.id || null,
      pluginId: plugin.id,
      pluginKey: plugin.pluginKey,
      pluginName: plugin.pluginName,
      selfId: account.selfId,
    };
  }

  /**
   * 将两个 Snowflake 主键组合为单次内存索引，避免候选矩阵重复扫描持久化绑定行。
   * @param accountId - QQBot 账号主键。
   * @param pluginId - 插件主键。
   * @returns 不与单字段主键混淆的组合键。
   */
  private bindingKey(accountId: string, pluginId: string): string {
    return `${accountId}:${pluginId}`;
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { throwVbenError } from '@/common';
import {
  BOT_PLUGIN_PROTOCOL,
  type BotPluginProtocol,
} from '@/modules/plugin-platform/contract/plugin-protocol';
import { BotAccountService } from '@/modules/bot-adapter/core/application/account/bot-account.service';
import type { BotAccount } from '@/modules/bot-adapter/core/infrastructure/persistence/account/bot-account.entity';
import { TencentBotPluginBinding } from '../infrastructure/persistence/tencent-bot-plugin-binding.entity';

@Injectable()
export class TencentBotPluginBindingService {
  constructor(
    @InjectRepository(TencentBotPluginBinding)
    private readonly bindingRepository: Repository<TencentBotPluginBinding>,
    private readonly accountService: BotAccountService,
    @Inject(BOT_PLUGIN_PROTOCOL)
    private readonly pluginProtocol: BotPluginProtocol,
  ) {}

  /**
   * 将协议层启用插件与 Tencent 账号自己的绑定行合并为管理候选，协议层不接触账号身份。
   * @param accountId - Tencent 连接使用的内部账号主键。
   * @returns 插件目录及当前账号绑定状态。
   */
  async list(accountId: string) {
    const account = await this.requireAccount(accountId);
    const [plugins, bindings] = await Promise.all([
      this.pluginProtocol.listPlugins(),
      this.bindingRepository.find({ where: { accountId: account.id } }),
    ]);
    const bindingMap = new Map(
      bindings.map((binding) => [binding.pluginKey, binding]),
    );
    return plugins.map((plugin) => {
      const binding = bindingMap.get(plugin.key);
      return {
        accountId: account.id,
        bound: binding?.enabled === true,
        description: plugin.description,
        id: binding?.id || null,
        operationCount: plugin.operationCount,
        pluginKey: plugin.key,
        pluginName: plugin.name,
        triggerMode: plugin.triggerMode,
        version: plugin.version,
      };
    });
  }

  /**
   * 将 Tencent 账号与协议插件的授权幂等落在适配器侧，避免向插件平台写入账号数据。
   * @param accountId - Tencent 内部账号主键。
   * @param pluginKey - 平台无关插件稳定键。
   * @returns 写入后的绑定主键。
   */
  async bind(accountId: string, pluginKey: string) {
    const account = await this.requireAccount(accountId);
    const normalizedPluginKey = await this.requirePluginKey(pluginKey);
    const existing = await this.bindingRepository.findOne({
      where: { accountId: account.id, pluginKey: normalizedPluginKey },
    });
    if (existing) {
      await this.bindingRepository.update(
        { id: existing.id },
        { enabled: true },
      );
      return existing.id;
    }
    const saved = await this.bindingRepository.save(
      this.bindingRepository.create({
        accountId: account.id,
        enabled: true,
        pluginKey: normalizedPluginKey,
      }),
    );
    return saved.id;
  }

  /**
   * 幂等停用 Tencent 账号的插件绑定并保留稳定行供恢复。
   * @param accountId - Tencent 内部账号主键。
   * @param pluginKey - 平台无关插件稳定键。
   * @returns 固定返回 true。
   */
  async unbind(accountId: string, pluginKey: string) {
    const account = await this.requireAccount(accountId);
    const normalizedPluginKey = `${pluginKey || ''}`.trim();
    if (!normalizedPluginKey) throwVbenError('请选择插件');
    await this.bindingRepository.update(
      { accountId: account.id, pluginKey: normalizedPluginKey },
      { enabled: false },
    );
    return true;
  }

  /**
   * 读取 Tencent 账号当前同时绑定且在协议层启用的插件键，供入站事件调用前授权。
   * @param accountId - Tencent 内部账号主键。
   * @returns 按插件目录顺序排列的授权键。
   */
  async listBoundPluginKeys(accountId: string) {
    const [plugins, bindings] = await Promise.all([
      this.pluginProtocol.listPlugins(),
      this.bindingRepository.find({ where: { accountId, enabled: true } }),
    ]);
    const enabledKeys = new Set(plugins.map((plugin) => plugin.key));
    return bindings
      .map((binding) => binding.pluginKey)
      .filter((pluginKey) => enabledKeys.has(pluginKey));
  }

  /**
   * 校验内部账号属于已启用 Tencent 双传输模式。
   * @param accountId - 待校验账号主键。
   * @returns 可配置的 Tencent 账号。
   * @throws 账号不存在、停用或属于 NapCat 时抛出业务错误。
   */
  private async requireAccount(accountId: string): Promise<BotAccount> {
    const account = await this.accountService.findById(accountId);
    if (!account || !account.enabled || account.isDeleted) {
      throwVbenError('Tencent Bot 账号不存在或已停用');
    }
    if (
      account.connectionMode !== 'official-websocket' &&
      account.connectionMode !== 'official-webhook'
    ) {
      throwVbenError('所选账号不是 Tencent Bot 连接');
    }
    return account;
  }

  /**
   * 校验插件键存在于协议层当前启用目录，并返回规范化稳定键。
   * @param pluginKey - 待绑定插件键。
   * @returns 当前协议目录中的稳定键。
   * @throws 插件未启用或不存在时抛出业务错误。
   */
  private async requirePluginKey(pluginKey: string) {
    const normalizedPluginKey = `${pluginKey || ''}`.trim();
    if (!normalizedPluginKey) throwVbenError('请选择插件');
    const plugins = await this.pluginProtocol.listPlugins();
    if (!plugins.some((plugin) => plugin.key === normalizedPluginKey)) {
      throwVbenError(`插件协议未启用：${normalizedPluginKey}`);
    }
    return normalizedPluginKey;
  }
}

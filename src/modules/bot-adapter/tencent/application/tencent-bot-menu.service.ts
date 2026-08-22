import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  BOT_PLUGIN_PROTOCOL,
  type BotPluginProtocol,
} from '@/modules/plugin-platform/contract/plugin-protocol';
import { BotAccountService } from '@/modules/bot-adapter/core/application/account/bot-account.service';
import type { BotRuleTargetType } from '@/modules/bot-adapter/core/contract/bot.types';
import { TENCENT_MANAGED_MENU_PREFIX } from '../contract/tencent-bot.constants';
import type {
  TencentMenuItem,
  TencentPanelItem,
  TencentPanelScope,
  TencentPluginMenuProjection,
} from '../contract/tencent-bot.types';
import { BotCommand } from '@/modules/bot-adapter/core/infrastructure/persistence/command/bot-command.entity';
import { TencentBotService } from '../infrastructure/tencent-bot.service';
import { TencentBotPluginBindingService } from './tencent-bot-plugin-binding.service';

type TencentMenuCommand = {
  desc: string;
  invocation: string;
  label: string;
  targetType: BotRuleTargetType;
};

type TencentMenuPlugin = {
  commands: TencentMenuCommand[];
  name: string;
  pluginKey: string;
};

@Injectable()
export class TencentBotMenuService {
  constructor(
    private readonly accountService: BotAccountService,
    private readonly bindingService: TencentBotPluginBindingService,
    @InjectRepository(BotCommand)
    private readonly commandRepository: Repository<BotCommand>,
    @Inject(BOT_PLUGIN_PROTOCOL)
    private readonly pluginProtocol: BotPluginProtocol,
    private readonly tencentService: TencentBotService,
  ) {}

  /**
   * 从 Tencent 适配器绑定构建官方菜单投影并交给官方 OpenAPI 同步，插件协议层不参与账号或菜单调用。
   * @param accountId - Tencent 内部账号主键。
   * @returns 官方菜单与面板实际变更计数。
   * @throws 当账号不存在或任一菜单投影违反官方数量、字符、唯一性限制时抛出错误。
   */
  async sync(accountId: string) {
    const account = await this.accountService.findById(accountId);
    if (!account) throw new Error('Tencent Bot 账号不存在');
    const projection = await this.buildProjection(accountId);
    return this.tencentService.syncPluginMenus({
      projection,
      selfId: account.selfId,
    });
  }

  /**
   * 将当前账号绑定的启用插件和命令目录投影为 C2C 自定义菜单与四场景指令面板。
   * @param accountId - Tencent 内部账号主键。
   * @returns 已完成数量与字符限制校验的官方菜单投影。
   */
  private async buildProjection(
    accountId: string,
  ): Promise<TencentPluginMenuProjection> {
    const pluginKeys = await this.bindingService.listBoundPluginKeys(accountId);
    const plugins = await this.loadPlugins(pluginKeys);
    return {
      menuItems: this.buildCustomMenu(plugins),
      panels: {
        c2c: this.buildPanel(plugins, 'c2c'),
        channel: this.buildPanel(plugins, 'channel'),
        dm: this.buildPanel(plugins, 'dm'),
        group: this.buildPanel(plugins, 'group'),
      },
    };
  }

  /**
   * 读取协议插件名称和对应启用命令，并把每条命令转换为官方可点击文本。
   * @param pluginKeys - Tencent 适配器已授权的插件键。
   * @returns 按协议目录顺序排列的插件命令组。
   */
  private async loadPlugins(
    pluginKeys: string[],
  ): Promise<TencentMenuPlugin[]> {
    if (pluginKeys.length === 0) return [];
    const [catalog, commands] = await Promise.all([
      this.pluginProtocol.listPlugins(),
      this.commandRepository.find({
        order: { createTime: 'ASC', priority: 'DESC' },
        where: {
          enabled: true,
          isDeleted: false,
          pluginKey: In(pluginKeys),
        },
      }),
    ]);
    const seen = new Set<string>();
    return catalog
      .filter((plugin) => pluginKeys.includes(plugin.key))
      .map((plugin) => ({
        commands: commands
          .filter((command) => command.pluginKey === plugin.key)
          .map((command) => this.projectCommand(command, seen)),
        name: plugin.name,
        pluginKey: plugin.key,
      }));
  }

  /**
   * 选择可被现有命令解析器识别且满足官方字符上限的调用文本，并拒绝跨插件重名。
   * @param command - Bot 命令目录记录。
   * @param seen - 已投影调用文本集合。
   * @returns 菜单和面板共用的命令投影。
   * @throws 当命令名称、描述超限或调用文本与已有投影重复时抛出错误。
   */
  private projectCommand(command: BotCommand, seen: Set<string>) {
    const aliases = this.parseList(command.aliases);
    aliases.push(command.code);
    const prefixes = this.parseList(command.prefixes);
    let prefix = prefixes[0] || '/';
    if (prefixes.includes('/')) prefix = '/';
    let invocation = '';
    for (const alias of aliases) {
      const candidate = `${prefix}${alias}`;
      if (this.textLength(candidate) > 14) continue;
      invocation = candidate;
      break;
    }
    if (!invocation) throw new Error(`Tencent 指令名称超长：${command.name}`);
    if (seen.has(invocation))
      throw new Error(`Tencent 指令重复：${invocation}`);
    seen.add(invocation);
    const label = invocation.slice(prefix.length);
    const desc = `${command.name || label}`.trim();
    if (this.textLength(desc) > 30) {
      throw new Error(`Tencent 指令描述超长：${desc}`);
    }
    return {
      desc,
      invocation,
      label,
      targetType: command.targetType,
    };
  }

  /**
   * 将 C2C 命令按每五项切为带 KT 托管前缀的折叠菜单，最多生成十个顶级项。
   * @param plugins - Tencent 已授权插件命令组。
   * @returns 官方全局自定义菜单项。
   * @throws 当投影需要超过十个官方顶级菜单时抛出错误。
   */
  private buildCustomMenu(plugins: TencentMenuPlugin[]) {
    const items: TencentMenuItem[] = [];
    for (const plugin of plugins) {
      const commands = plugin.commands.filter((command) =>
        this.supportsScope(command.targetType, 'c2c'),
      );
      for (let offset = 0; offset < commands.length; offset += 5) {
        const index = items.length + 1;
        items.push({
          name: this.menuName(plugin.name, index),
          sub_menu_items: commands.slice(offset, offset + 5).map((command) => ({
            name: command.label,
            send_message: command.invocation,
            type: 'send_message' as const,
          })),
          type: 'menu',
        });
      }
    }
    if (items.length > 10) {
      throw new Error(
        `Tencent 自定义菜单需要 ${items.length} 个顶级项，超过 10 项`,
      );
    }
    return items;
  }

  /**
   * 将指定场景可执行命令转换为官方全局指令面板元素。
   * @param plugins - Tencent 已授权插件命令组。
   * @param scope - 官方面板场景。
   * @returns 最多二十项的官方面板元素。
   * @throws 当指定场景的可执行指令超过二十项时抛出错误。
   */
  private buildPanel(
    plugins: TencentMenuPlugin[],
    scope: TencentPanelScope,
  ): TencentPanelItem[] {
    const items = plugins.flatMap((plugin) =>
      plugin.commands
        .filter((command) => this.supportsScope(command.targetType, scope))
        .map((command) => ({
          desc: command.desc,
          name: command.label,
          only_admin: false,
          type: 'command' as const,
        })),
    );
    if (items.length > 20) {
      throw new Error(
        `Tencent ${scope} 指令面板需要 ${items.length} 项，超过 20 项`,
      );
    }
    return items;
  }

  /**
   * 按 Bot 目标类型与 Tencent 场景的显式映射，拒绝把命令投放到无效会话范围。
   * @param targetType - Bot 命令目标类型。
   * @param scope - Tencent 面板场景。
   * @returns 该命令可用于此场景时返回 true。
   */
  private supportsScope(
    targetType: BotRuleTargetType,
    scope: TencentPanelScope,
  ) {
    if (targetType === 'all') return true;
    if (targetType === 'private') return scope === 'c2c';
    if (targetType === 'group') return scope === 'group';
    if (targetType === 'channel') {
      return scope === 'channel' || scope === 'dm';
    }
    return false;
  }

  /**
   * 按官方字符权重预算截取插件名，并保留 KT 托管前缀与稳定序号。
   * @param pluginName - 插件展示名。
   * @param index - 当前托管项序号。
   * @returns 官方菜单顶级名称。
   * @throws 当托管前缀占满字符预算而无法保留插件名称时抛出错误。
   */
  private menuName(pluginName: string, index: number) {
    const prefix = `${TENCENT_MANAGED_MENU_PREFIX}${index}`;
    const budget = 10 - this.textLength(prefix);
    let suffix = '';
    for (const character of Array.from(pluginName.trim())) {
      if (this.textLength(`${suffix}${character}`) > budget) break;
      suffix += character;
    }
    if (!suffix) throw new Error(`Tencent 菜单名称无法投影：${pluginName}`);
    return `${prefix}${suffix}`;
  }

  /**
   * 解析 JSON 数组或逗号分隔的命令字段并去除空项。
   * @param value - 命令别名或前缀持久化文本。
   * @returns 按原顺序保留的字符串列表。
   */
  private parseList(value: null | string | undefined) {
    const source = `${value || ''}`.trim();
    if (!source) return [];
    let values: unknown = source.split(',');
    if (source.startsWith('[')) {
      try {
        values = JSON.parse(source);
      } catch {
        values = [];
      }
    }
    if (!Array.isArray(values)) return [];
    return values.map((item) => `${item || ''}`.trim()).filter(Boolean);
  }

  /**
   * 按官方 ASCII 一字符、其他码点两字符的规则计算菜单文本权重。
   * @param value - 待校验文本。
   * @returns 官方字符权重。
   */
  private textLength(value: string) {
    return Array.from(value).reduce((total, character) => {
      if (character.codePointAt(0)! <= 0x7f) return total + 1;
      return total + 2;
    }, 0);
  }
}

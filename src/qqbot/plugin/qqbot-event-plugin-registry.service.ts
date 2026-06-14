import { Injectable } from '@nestjs/common';
import { formatKtDateTime, throwVbenError } from '@/common';
import { QqbotAccountService } from '../account/qqbot-account.service';
import { QqbotRepeaterPluginService } from '@/modules/qqbot/plugins/repeater/qqbot-repeater.plugin';
import type {
  QqbotEventPluginDefinition,
  QqbotPluginHealth,
  QqbotPluginOperationSummary,
} from '../qqbot.types';

@Injectable()
export class QqbotEventPluginRegistryService {
  constructor(
    private readonly accountService: QqbotAccountService,
    private readonly repeaterPlugin: QqbotRepeaterPluginService,
  ) {}

  listDefinitions(pluginKey?: string): QqbotEventPluginDefinition[] {
    return this.getDefinitions(pluginKey);
  }

  async listPlugins(selfId?: string) {
    const accounts = selfId
      ? [await this.accountService.findBySelfId(selfId)]
      : await this.accountService.allEnabled();
    return Promise.all(
      accounts
        .filter((account): account is NonNullable<typeof account> => !!account)
        .map((account) =>
          this.repeaterPlugin.getSummary({
            accountName: account.name,
            connectStatus: account.connectStatus,
            selfId: account.selfId,
          }),
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

  async bind(pluginKey: string, selfId: string) {
    this.assertPlugin(pluginKey);
    if (pluginKey === 'repeater') {
      return this.repeaterPlugin.bind(selfId);
    }
    await this.accountService.bindEventPlugin(selfId, pluginKey);
    return true;
  }

  async unbind(pluginKey: string, selfId: string) {
    this.assertPlugin(pluginKey);
    if (pluginKey === 'repeater') {
      return this.repeaterPlugin.unbind(selfId);
    }
    await this.accountService.unbindEventPlugin(selfId, pluginKey);
    return true;
  }

  private assertPlugin(pluginKey: string) {
    if (pluginKey === 'repeater') return;
    throwVbenError(`QQBot 事件插件不存在：${pluginKey}`);
  }

  private getDefinitions(pluginKey?: string): QqbotEventPluginDefinition[] {
    const definitions = [this.repeaterPlugin.getDefinition()];
    return pluginKey
      ? definitions.filter((definition) => definition.key === pluginKey)
      : definitions;
  }
}

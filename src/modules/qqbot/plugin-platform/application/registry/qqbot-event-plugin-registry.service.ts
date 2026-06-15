import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatKtDateTime, throwVbenError } from '@/common';
import { QqbotAccountService } from '@/modules/qqbot/core/application/account/qqbot-account.service';
import { QqbotSendService } from '@/modules/qqbot/core/application/send/qqbot-send.service';
import type {
  QqbotEventPluginDefinition,
  QqbotNormalizedMessage,
  QqbotPluginHealth,
  QqbotPluginOperationSummary,
} from '@/modules/qqbot/core/contract/qqbot.types';
import {
  parseQqbotPluginManifest,
  type QqbotPluginManifest,
} from '@/modules/qqbot/plugin-platform/domain/manifest';
import { createPlugin as createRepeaterPlugin } from '@/modules/qqbot/plugins/repeater/src';

@Injectable()
export class QqbotEventPluginRegistryService {
  private readonly logger = new Logger(QqbotEventPluginRegistryService.name);
  private readonly repeaterPlugin: ReturnType<typeof createRepeaterPlugin>;

  constructor(
    private readonly accountService: QqbotAccountService,
    private readonly configService: ConfigService,
    private readonly sendService: QqbotSendService,
  ) {
    const manifest = this.loadManifest('repeater');
    this.repeaterPlugin = createRepeaterPlugin({
      host: {
        bindEventPlugin: (selfId, pluginKey) =>
          this.accountService
            .bindEventPlugin(selfId, pluginKey)
            .then(() => undefined),
        getBoundEventPluginKeys: (selfId) =>
          this.accountService.getBoundEventPluginKeys(selfId),
        getConfig: (key) => this.configService.get(key),
        sendText: (input) => this.sendService.sendText(input as any),
        unbindEventPlugin: (selfId, pluginKey) =>
          this.accountService
            .unbindEventPlugin(selfId, pluginKey)
            .then(() => undefined),
        warn: (message) => this.logger.warn(message),
      },
      manifest,
    });
  }

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

  async dispatchMessage(message: QqbotNormalizedMessage) {
    return this.repeaterPlugin.handleMessage(message);
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

  private loadManifest(pluginKey: string): QqbotPluginManifest {
    const pluginRoot = this.resolvePluginRoot(pluginKey);
    return parseQqbotPluginManifest(
      readJsonFile(join(pluginRoot, 'plugin.json')),
      { pluginRoot },
    );
  }

  private resolvePluginRoot(pluginKey: string) {
    const sourceRoot = join(
      process.cwd(),
      `src/modules/qqbot/plugins/${pluginKey}`,
    );
    if (existsSync(join(sourceRoot, 'plugin.json'))) return sourceRoot;
    return join(__dirname, `../../../plugins/${pluginKey}`);
  }
}

function readJsonFile<T = unknown>(filePath: string) {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

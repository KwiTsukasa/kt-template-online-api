import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QqbotAccountService } from '../../account/qqbot-account.service';
import type {
  QqbotEventPluginDefinition,
  QqbotEventPluginSummary,
} from '../../plugin/qqbot-plugin.types';
import type { QqbotNormalizedMessage } from '../../qqbot.types';
import { QqbotSendService } from '../../send/qqbot-send.service';

const QQBOT_REPEATER_VERSION = '1.0.0';
const QQBOT_REPEATER_PLUGIN_KEY = 'repeater';

type QqbotRepeaterConversationState = {
  count: number;
  lastText: string;
  repeatedText: string;
  updatedAt: number;
};

@Injectable()
export class QqbotRepeaterPluginService {
  private readonly logger = new Logger(QqbotRepeaterPluginService.name);
  private readonly states = new Map<string, QqbotRepeaterConversationState>();
  private readonly boundCache = new Map<
    string,
    {
      expiresAt: number;
      value: boolean;
    }
  >();
  private readonly pluginDescription =
    '监听同一会话内连续重复的普通文本消息，达到阈值后自动复读一次。';
  private readonly pluginName = '复读机';
  private readonly pluginRemark =
    '连续重复达到阈值后触发；命令、CQ 码和机器人自身消息不触发。';

  constructor(
    private readonly configService: ConfigService,
    private readonly accountService: QqbotAccountService,
    private readonly sendService: QqbotSendService,
  ) {}

  async getSummary(params: {
    accountName?: string;
    connectStatus?: string;
    selfId: string;
  }): Promise<QqbotEventPluginSummary> {
    const definition = this.getDefinition();
    return {
      accountName: params.accountName,
      bound: await this.isBound(params.selfId),
      connectStatus: params.connectStatus,
      description: definition.description,
      key: definition.key,
      name: definition.name,
      remark: definition.remark,
      selfId: params.selfId,
      triggerType: definition.triggerType,
      version: definition.version,
    };
  }

  getDefinition(): QqbotEventPluginDefinition {
    return {
      description: this.pluginDescription,
      key: QQBOT_REPEATER_PLUGIN_KEY,
      name: this.pluginName,
      remark: this.pluginRemark,
      triggerType: 'message',
      version: QQBOT_REPEATER_VERSION,
    };
  }

  async bind(selfId: string) {
    await this.accountService.bindEventPlugin(
      selfId,
      QQBOT_REPEATER_PLUGIN_KEY,
    );
    this.clearBoundCache(selfId);
    return this.getSummary({ selfId });
  }

  async unbind(selfId: string) {
    await this.accountService.unbindEventPlugin(
      selfId,
      QQBOT_REPEATER_PLUGIN_KEY,
    );
    this.clearBoundCache(selfId);
    return this.getSummary({ selfId });
  }

  clearBoundCache(selfId: string) {
    this.boundCache.delete(`${selfId || ''}`.trim());
  }

  async handleMessage(message: QqbotNormalizedMessage) {
    if (!(await this.isBound(message.selfId))) return false;
    const text = this.normalizeText(message.messageText);
    if (!this.canRepeat(message, text)) {
      this.resetState(message);
      return false;
    }

    const key = this.buildStateKey(message);
    const state = this.getNextState(key, text);
    if (!this.shouldRepeat(state, text)) return false;

    state.repeatedText = text;
    try {
      await this.sendService.sendText({
        channelId: message.channelId,
        guildId: message.rawEvent.guild_id
          ? `${message.rawEvent.guild_id}`
          : undefined,
        message: text,
        selfId: message.selfId,
        targetId: message.targetId,
        targetType: message.messageType,
      });
      return true;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : '复读失败';
      this.logger.warn(`QQBot 复读机发送失败: ${errMsg}`);
      return false;
    }
  }

  private async isBound(selfId: string) {
    const normalizedSelfId = `${selfId || ''}`.trim();
    if (!normalizedSelfId) return false;
    const now = Date.now();
    const cached = this.boundCache.get(normalizedSelfId);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }
    const value = (
      await this.accountService.getBoundEventPluginKeys(normalizedSelfId)
    ).includes(QQBOT_REPEATER_PLUGIN_KEY);
    this.boundCache.set(normalizedSelfId, {
      expiresAt: now + this.getConfigCacheTtlMs(),
      value,
    });
    return value;
  }

  private canRepeat(message: QqbotNormalizedMessage, text: string) {
    if (!text) return false;
    if (message.userId === message.selfId) return false;
    if (/^[!/！]/.test(text)) return false;
    if (text.includes('[CQ:')) return false;
    return text.length <= this.getMaxTextLength();
  }

  private getNextState(key: string, text: string) {
    const current = this.states.get(key);
    const now = Date.now();
    const next =
      current?.lastText === text
        ? { ...current, count: current.count + 1, updatedAt: now }
        : {
            count: 1,
            lastText: text,
            repeatedText: '',
            updatedAt: now,
          };
    this.states.set(key, next);
    this.pruneStates(now);
    return next;
  }

  private shouldRepeat(state: QqbotRepeaterConversationState, text: string) {
    return state.count >= this.getThreshold() && state.repeatedText !== text;
  }

  private normalizeText(value: string) {
    return `${value || ''}`.trim().replace(/\s+/g, ' ');
  }

  private resetState(message: QqbotNormalizedMessage) {
    this.states.delete(this.buildStateKey(message));
  }

  private buildStateKey(message: QqbotNormalizedMessage) {
    return [message.selfId, message.messageType, message.targetId].join(':');
  }

  private getThreshold() {
    const value = Number(this.configService.get('QQBOT_REPEATER_THRESHOLD'));
    return Number.isInteger(value) && value > 1 ? value : 2;
  }

  private getMaxTextLength() {
    const value = Number(
      this.configService.get('QQBOT_REPEATER_MAX_TEXT_LENGTH'),
    );
    return Number.isInteger(value) && value > 0 ? value : 300;
  }

  private getStateTtlMs() {
    const value = Number(this.configService.get('QQBOT_REPEATER_STATE_TTL_MS'));
    return Number.isInteger(value) && value > 0 ? value : 10 * 60 * 1000;
  }

  private getConfigCacheTtlMs() {
    const value = Number(
      this.configService.get('QQBOT_REPEATER_CONFIG_CACHE_TTL_MS'),
    );
    return Number.isInteger(value) && value > 0 ? value : 2000;
  }

  private pruneStates(now: number) {
    const ttl = this.getStateTtlMs();
    for (const [key, state] of this.states.entries()) {
      if (now - state.updatedAt > ttl) this.states.delete(key);
    }
  }
}

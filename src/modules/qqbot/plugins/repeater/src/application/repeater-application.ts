import { readRepeaterRuntimeConfig } from '../config/repeater-config';
import {
  buildRepeaterStateKey,
  canRepeaterEcho,
  createNextRepeaterState,
  normalizeRepeaterText,
  shouldRepeaterEcho,
} from '../domain/repeat-policy';
import type {
  RepeaterConversationState,
  RepeaterManifest,
  RepeaterMessage,
} from '../domain/repeater.types';
import type { RepeaterPluginHost } from '../infrastructure/integration/repeater-host';

export class RepeaterApplication {
  private readonly boundCache = new Map<
    string,
    { expiresAt: number; value: boolean }
  >();
  private readonly states = new Map<string, RepeaterConversationState>();

  constructor(
    private readonly host: RepeaterPluginHost,
    private readonly manifest: RepeaterManifest,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * 根据`selfId`处理针对复读插件。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @returns 满足针对复读插件约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  async bind(selfId: string) {
    await this.host.bindEventPlugin(selfId, this.manifest.pluginKey);
    this.clearBoundCache(selfId);
    return true;
  }

  /**
   * 按`selfId`移除Bound缓存；同步更新对应缓存或去重状态（`boundCache.delete`）。
   * @param selfId - 用于精确定位QQ 账号的标识。
   */
  clearBoundCache(selfId: string) {
    this.boundCache.delete(`${selfId || ''}`.trim());
  }

  /**
   * 按当前运行态读取Definition。
   * @returns 包含 `description`、`key`、`name`、`remark`、`triggerType` 字段的Definition。
   */
  getDefinition() {
    return {
      description: this.manifest.description,
      key: this.manifest.pluginKey,
      name: this.manifest.name,
      remark: '连续重复达到阈值后触发；命令、CQ 码和机器人自身消息不触发。',
      triggerType: 'message' as const,
      version: this.manifest.version,
    };
  }

  /**
   * 按`params`读取针对复读插件；从 `getDefinition` 读取针对复读插件。
   * @param params - 用于针对复读插件的领域对象，包含 `accountName`、`selfId`、`connectStatus` 字段。
   * @returns 包含 `accountName`、`bound`、`connectStatus`、`description`、`key` 字段的针对复读插件。
   */
  async getSummary(params: {
    accountName?: string;
    connectStatus?: string;
    selfId: string;
  }) {
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

  /**
   * 通过 `isBound` 判断输入是否满足函数约束。
   * @param message - 包含正文、发送目标与账号身份的待处理消息，包含 `selfId`、`messageText`、`channelId`、`rawEvent` 字段。
   * @returns 满足消息约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  async handleMessage(message: RepeaterMessage) {
    if (!(await this.isBound(message.selfId))) return false;

    const config = readRepeaterRuntimeConfig(this.host);
    const text = normalizeRepeaterText(message.messageText);
    if (!canRepeaterEcho(message, text, config.maxTextLength)) {
      this.resetState(message);
      return false;
    }

    const key = buildRepeaterStateKey(message);
    const current = this.now();
    const state = createNextRepeaterState(this.states.get(key), text, current);
    this.states.set(key, state);
    this.pruneStates(current, config.stateTtlMs);
    if (!shouldRepeaterEcho(state, text, current, config)) return false;

    state.repeatedText = text;
    state.lastRepeatedAt = current;
    state.updatedAt = current;
    try {
      await this.host.sendText({
        channelId: message.channelId,
        guildId: (() => {
          if (message.guildId) return message.guildId;
          if (message.rawEvent.guild_id) {
            return `${message.rawEvent.guild_id}`;
          }
          return undefined;
        })(),
        message: text,
        replyMessageId: message.replyMessageId,
        selfId: message.selfId,
        targetId: message.targetId,
        targetType: message.messageType,
      });
      return true;
    } catch (error) {
      this.host.warn?.(
        `QQBot 复读机发送失败: ${(() => {
          if (error instanceof Error) {
            return error.message;
          }
          return `${error}`;
        })()}`,
      );
      return false;
    }
  }

  /**
   * 按`selfId`移除针对复读插件。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @returns 满足针对复读插件约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  async unbind(selfId: string) {
    await this.host.unbindEventPlugin(selfId, this.manifest.pluginKey);
    this.clearBoundCache(selfId);
    return true;
  }

  /**
   * 根据`selfId`与当前约束判定针对复读插件；同步更新对应缓存或去重状态（`boundCache.set`）。
   * @param selfId - 用于精确定位QQ 账号的标识。
   * @returns 满足针对复读插件约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private async isBound(selfId: string) {
    const normalizedSelfId = `${selfId || ''}`.trim();
    if (!normalizedSelfId) return false;
    const current = this.now();
    const cached = this.boundCache.get(normalizedSelfId);
    if (cached && cached.expiresAt > current) return cached.value;

    const config = readRepeaterRuntimeConfig(this.host);
    const value = (
      await this.host.getBoundEventPluginKeys(normalizedSelfId)
    ).includes(this.manifest.pluginKey);
    this.boundCache.set(normalizedSelfId, {
      expiresAt: current + config.configCacheTtlMs,
      value,
    });
    return value;
  }

  /**
   * 按`current`、`ttl`移除针对复读插件。
   * @param current - 决定针对复读插件内容、边界或目标的 `current` 值。
   * @param ttl - 决定针对复读插件内容、边界或目标的 `ttl` 值。
   */
  private pruneStates(current: number, ttl: number) {
    for (const [key, state] of this.states.entries()) {
      if (current - state.updatedAt > ttl) this.states.delete(key);
    }
  }

  /**
   * 通过 `buildRepeaterStateKey` 生成稳定标识。
   * @param message - 包含正文、发送目标与账号身份的待处理消息。
   */
  private resetState(message: RepeaterMessage) {
    const key = buildRepeaterStateKey(message);
    const currentState = this.states.get(key);
    if (!currentState?.lastRepeatedAt) {
      this.states.delete(key);
      return;
    }
    this.states.set(key, {
      count: 0,
      lastRepeatedAt: currentState.lastRepeatedAt,
      lastText: '',
      repeatedText: '',
      updatedAt: this.now(),
    });
  }
}

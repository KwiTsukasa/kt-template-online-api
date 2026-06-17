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

  /**
   * 初始化 RepeaterApplication 实例。
   * @param host - host 输入；影响 constructor 的返回值。
   * @param manifest - manifest 输入；影响 constructor 的返回值。
   * @param now - now 输入；影响 constructor 的返回值。
   */
  constructor(
    private readonly host: RepeaterPluginHost,
    private readonly manifest: RepeaterManifest,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * 执行 复读插件流程。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   */
  async bind(selfId: string) {
    await this.host.bindEventPlugin(selfId, this.manifest.pluginKey);
    this.clearBoundCache(selfId);
    return true;
  }

  /**
   * 清理Bound Cache。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   */
  clearBoundCache(selfId: string) {
    this.boundCache.delete(`${selfId || ''}`.trim());
  }

  /**
   * 查询 复读插件数据。
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
   * 查询 复读插件数据。
   * @param params - 模块列表；使用 `accountName`、`selfId`、`connectStatus` 字段生成结果。
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
   * 处理Message。
   * @param message - message 输入；使用 `selfId`、`messageText`、`channelId`、`rawEvent` 字段生成结果。
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
        guildId: message.rawEvent.guild_id
          ? `${message.rawEvent.guild_id}`
          : undefined,
        message: text,
        selfId: message.selfId,
        targetId: message.targetId,
        targetType: message.messageType,
      });
      return true;
    } catch (error) {
      this.host.warn?.(
        `QQBot 复读机发送失败: ${
          error instanceof Error ? error.message : `${error}`
        }`,
      );
      return false;
    }
  }

  /**
   * 执行 复读插件流程。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
   */
  async unbind(selfId: string) {
    await this.host.unbindEventPlugin(selfId, this.manifest.pluginKey);
    this.clearBoundCache(selfId);
    return true;
  }

  /**
   * 判断 复读插件条件。
   * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
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
   * 执行 复读插件流程。
   * @param current - current 输入；决定 模块条件分支。
   * @param ttl - ttl 输入；决定 模块条件分支。
   */
  private pruneStates(current: number, ttl: number) {
    for (const [key, state] of this.states.entries()) {
      if (current - state.updatedAt > ttl) this.states.delete(key);
    }
  }

  /**
   * 重置State。
   * @param message - message 输入；驱动 `buildRepeaterStateKey()` 的 模块步骤。
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

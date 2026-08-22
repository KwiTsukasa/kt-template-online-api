import type { BotPluginEventResult } from '@/modules/plugin-platform/contract/plugin-protocol';
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
  private readonly states = new Map<string, RepeaterConversationState>();

  constructor(
    private readonly host: RepeaterPluginHost,
    private readonly manifest: RepeaterManifest,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * 返回复读协议插件的静态能力说明，不包含任何 Bot 账号或平台绑定状态。
   * @returns 事件插件定义。
   */
  getDefinition() {
    return {
      description: this.manifest.description,
      key: this.manifest.pluginKey,
      name: this.manifest.name,
      remark:
        '连续重复达到阈值后触发；命令、平台控制码和机器人自身消息不触发。',
      triggerType: 'message' as const,
      version: this.manifest.version,
    };
  }

  /**
   * 按 opaque 会话键维护复读状态，并在达到阈值时返回文本回复意图而不直接调用任何平台发送接口。
   * @param message - 平台无关的消息事件信封。
   * @returns 是否处理以及待由当前 Bot 适配器发送的回复意图。
   */
  async handleMessage(message: RepeaterMessage): Promise<BotPluginEventResult> {
    const config = readRepeaterRuntimeConfig(this.host);
    const text = normalizeRepeaterText(message.text);
    if (!canRepeaterEcho(message, text, config.maxTextLength)) {
      this.resetState(message);
      return emptyEventResult();
    }

    const key = buildRepeaterStateKey(message);
    const current = this.now();
    const state = createNextRepeaterState(this.states.get(key), text, current);
    this.states.set(key, state);
    this.pruneStates(current, config.stateTtlMs);
    if (!shouldRepeaterEcho(state, text, current, config)) {
      return emptyEventResult();
    }

    state.repeatedText = text;
    state.lastRepeatedAt = current;
    state.updatedAt = current;
    return {
      handled: true,
      replies: [{ content: text, kind: 'text' }],
    };
  }

  /**
   * 清除超过状态保留窗口的会话计数，避免协议插件长期积累无界内存。
   * @param current - 当前毫秒时间戳。
   * @param ttl - 会话状态保留时长。
   */
  private pruneStates(current: number, ttl: number) {
    for (const [key, state] of this.states.entries()) {
      if (current - state.updatedAt > ttl) this.states.delete(key);
    }
  }

  /**
   * 在消息不适用时重置当前 opaque 会话的连续计数，同时保留最近一次已回复时间用于节流。
   * @param message - 平台无关消息事件。
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

/**
 * 在复读条件未满足时返回统一的未处理结果，避免适配器误发空回复。
 * @returns 固定空事件结果。
 */
function emptyEventResult(): BotPluginEventResult {
  return { handled: false, replies: [] };
}

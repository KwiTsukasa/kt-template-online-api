import type {
  RepeaterConversationState,
  RepeaterMessage,
} from './repeater.types';

export type RepeaterPolicyConfig = {
  maxTextLength: number;
  minIntervalMs: number;
  threshold: number;
};

/**
 * 转换 复读插件输入。
 * @param value - 待转文本值；影响 normalizeRepeaterText 的返回值。
 */
export const normalizeRepeaterText = (value: string) =>
  `${value || ''}`.replace(/\s+/g, ' ').trim();

/**
 * 创建 复读插件对象或配置。
 * @param message - message 输入；使用 `selfId`、`messageType`、`targetId` 字段生成结果。
 */
export const buildRepeaterStateKey = (message: RepeaterMessage) =>
  [message.selfId, message.messageType, message.targetId].join(':');

/**
 * 判断 复读插件条件。
 * @param message - message 输入；使用 `userId`、`selfId` 字段生成结果。
 * @param text - 待匹配文本；使用 `length` 字段生成结果。
 * @param maxTextLength - maxTextLength 输入；计算 模块判断结果。
 */
export function canRepeaterEcho(
  message: RepeaterMessage,
  text: string,
  maxTextLength: number,
) {
  if (!text) return false;
  if (message.userId === message.selfId) return false;
  if (/^[!/！]/.test(text)) return false;
  if (text.includes('[CQ:')) return false;
  return text.length <= maxTextLength;
}

/**
 * 创建 复读插件对象或配置。
 * @param currentState - currentState 输入；使用 `count` 字段生成结果。
 * @param text - 待匹配文本；生成 模块对象。
 * @param current - current 输入；生成 模块对象。
 * @returns 创建后的 复读插件对象或配置。
 */
export function createNextRepeaterState(
  currentState: RepeaterConversationState | undefined,
  text: string,
  current: number,
): RepeaterConversationState {
  return currentState?.lastText === text
    ? { ...currentState, count: currentState.count + 1, updatedAt: current }
    : {
        count: 1,
        lastText: text,
        lastRepeatedAt: currentState?.lastRepeatedAt || 0,
        repeatedText: '',
        updatedAt: current,
      };
}

/**
 * 判断 复读插件条件。
 * @param state - state 输入；使用 `count`、`repeatedText`、`lastRepeatedAt` 字段生成结果。
 * @param text - 待匹配文本；计算 模块判断结果。
 * @param current - current 输入；计算 模块判断结果。
 * @param config - config 输入；使用 `threshold`、`minIntervalMs` 字段生成结果。
 */
export function shouldRepeaterEcho(
  state: RepeaterConversationState,
  text: string,
  current: number,
  config: RepeaterPolicyConfig,
) {
  return (
    state.count >= config.threshold &&
    state.repeatedText !== text &&
    current - (state.lastRepeatedAt || 0) >= config.minIntervalMs
  );
}

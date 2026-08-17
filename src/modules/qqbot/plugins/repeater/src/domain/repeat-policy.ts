import type {
  RepeaterConversationState,
  RepeaterMessage,
} from './repeater.types';

export type RepeaterPolicyConfig = {
  maxTextLength: number;
  minIntervalMs: number;
  threshold: number;
};

export const normalizeRepeaterText = (value: string) =>
  `${value || ''}`.replace(/\s+/g, ' ').trim();

export const buildRepeaterStateKey = (message: RepeaterMessage) =>
  [message.selfId, message.messageType, message.targetId].join(':');

/**
 * 根据`message`、`text`、`maxTextLength`与当前约束判定针对复读插件。
 * @param message - 包含正文、发送目标与账号身份的待处理消息，包含 `userId`、`selfId` 字段。
 * @param text - 用于针对复读插件的领域对象，包含 `length` 字段。
 * @param maxTextLength - 限制针对复读插件数量、尺寸、等级或重试边界的数值。
 * @returns 满足针对复读插件约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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
 * 根据`currentState`、`text`、`current`构造下次运行时间Repeater状态；当 `currentState?.lastText === text` 成立时返回 `{ ...currentState, count: currentState.coun…`。
 * @param currentState - 用于下次运行时间Repeater状态的领域对象，包含 `lastText`、`count`、`lastRepeatedAt` 字段。
 * @param text - 决定下次运行时间Repeater状态内容、边界或目标的 `text` 值。
 * @param current - 决定下次运行时间Repeater状态内容、边界或目标的 `current` 值。
 * @returns 包含 `count`、`lastText`、`lastRepeatedAt`、`repeatedText`、`updatedAt` 字段的下次运行时间Repeater状态。
 */
export function createNextRepeaterState(
  currentState: RepeaterConversationState | undefined,
  text: string,
  current: number,
): RepeaterConversationState {
  if (currentState?.lastText === text) {
    return { ...currentState, count: currentState.count + 1, updatedAt: current };
  }
  return {
        count: 1,
        lastText: text,
        lastRepeatedAt: currentState?.lastRepeatedAt || 0,
        repeatedText: '',
        updatedAt: current,
      };
}

/**
 * 针对复读插件，根据 `state.count >= config.threshold && state.repeatedText !== text && current - (state.last…` 判定输入是否满足条件。
 * @param state - 用于RepeaterEcho的领域对象，包含 `count`、`repeatedText`、`lastRepeatedAt` 字段。
 * @param text - 决定RepeaterEcho内容、边界或目标的 `text` 值。
 * @param current - 决定RepeaterEcho内容、边界或目标的 `current` 值。
 * @param config - 限定RepeaterEcho边界、地址与开关的运行配置，包含 `threshold`、`minIntervalMs` 字段。
 * @returns 满足RepeaterEcho约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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

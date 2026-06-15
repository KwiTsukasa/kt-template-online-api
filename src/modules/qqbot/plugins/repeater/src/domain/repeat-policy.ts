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

import type { BilibiliUrlExtractionInput } from './bilibili-card.types';
import {
  cleanBilibiliUrlCandidate,
  isAllowedBilibiliUrl,
} from './bilibili-url-parser';

const URL_PATTERN = /https?:\/\/[^\s<>"',:!，。！？；、\]\)}]+/giu;
const HTML_ENTITY_BEFORE_SEMICOLON = /&(?:amp|quot|lt|gt|#34|#60|#62)$/iu;
const MAX_DEPTH = 7;
const MAX_NODES = 200;
const MAX_STRINGS = 200;
const MAX_STRING_LENGTH = 4000;
const MAX_URLS = 20;
const MAX_JSON_BYTES = 8000;
const URL_LIKE_KEY_PATTERN = /(?:^url$|url$|jump|qqdocurl)/iu;

type ExtractionState = {
  candidates: string[];
  nodes: number;
  strings: number;
};

/**
 * 从`input`解析从输入中提取BilibiliURL。
 * @param input - 用于从输入中提取BilibiliURL的结构化输入。
 * @returns 从输入中提取BilibiliURL。
 */
export function extractBilibiliUrls(input: BilibiliUrlExtractionInput) {
  const candidates = collectStringCandidates(input);
  const seen = new Set<string>();
  const output: string[] = [];

  for (const text of candidates) {
    for (const rawUrl of text.match(URL_PATTERN) || []) {
      const cleaned = cleanBilibiliUrlCandidate(
        trimNonEntitySemicolonTail(rawUrl),
      );
      if (!isAllowedBilibiliUrl(cleaned) || seen.has(cleaned)) continue;
      seen.add(cleaned);
      output.push(cleaned);
      if (output.length >= MAX_URLS) return output;
    }
  }

  return output;
}

/**
 * 将`rawUrl`规范为裁剪非实体分号尾部，使等价输入得到一致表示。
 * @param rawUrl - 待规范化、请求或同源校验的rawURL 地址 URL。
 * @returns 裁剪非实体分号尾部。
 */
function trimNonEntitySemicolonTail(rawUrl: string) {
  for (let index = 0; index < rawUrl.length; index += 1) {
    if (rawUrl[index] !== ';') continue;
    if (HTML_ENTITY_BEFORE_SEMICOLON.test(rawUrl.slice(0, index))) continue;
    return rawUrl.slice(0, index);
  }
  return rawUrl;
}

/**
 * 根据`input`处理字符串候选项。
 * @param input - 用于字符串候选项的结构化输入，包含 `messageText`、`rawMessage`、`rawEvent` 字段。
 * @returns 字符串候选项。
 */
function collectStringCandidates(input: BilibiliUrlExtractionInput) {
  const state = createExtractionState();
  pushText(state, input.messageText);
  pushText(state, input.rawMessage);
  collectRawEventCandidates(input.rawEvent, state);
  return state.candidates;
}

/**
 * 创建提取状态，并输出固定投影 `candidates`、`nodes`、`strings` 字段。
 * @returns 包含 `candidates`、`nodes`、`strings` 字段的Extraction状态。
 */
function createExtractionState(): ExtractionState {
  return {
    candidates: [],
    nodes: 0,
    strings: 0,
  };
}

/**
 * 根据`rawEvent`、`state`处理原始的事件候选项。
 * @param rawEvent - 触发原始的事件候选项的领域事件，包含 `message` 字段。
 * @param state - 决定原始的事件候选项内容、边界或目标的 `state` 值。
 */
function collectRawEventCandidates(
  rawEvent: BilibiliUrlExtractionInput['rawEvent'],
  state: ExtractionState,
) {
  if (!isRecord(rawEvent)) return;
  collectMessageSegments(rawEvent.message, state);
}

/**
 * 根据`value`、`state`处理消息分段；当 `Array.isArray(value)` 成立时直接结束且不产生返回值。
 * @param value - 参与消息分段比较、格式化或输出的候选值。
 * @param state - 决定消息分段内容、边界或目标的 `state` 值。
 */
function collectMessageSegments(value: unknown, state: ExtractionState) {
  if (Array.isArray(value)) {
    for (const segment of value) {
      collectMessageSegment(segment, state);
    }
    return;
  }
  collectMessageSegment(value, state);
}

/**
 * 根据`value`、`state`处理消息分段；当 `type === 'json' || type === 'lightapp'` 成立时直接结束且不产生返回值。
 * @param value - 参与消息分段比较、格式化或输出的候选值。
 * @param state - 决定消息分段内容、边界或目标的 `state` 值。
 */
function collectMessageSegment(value: unknown, state: ExtractionState) {
  if (!isRecord(value)) return;
  const type = (() => {
    if (typeof value.type === 'string') {
      return value.type.toLowerCase();
    }
    return '';
  })();
  const data = (() => {
    if (isRecord(value.data)) {
      return value.data;
    }
    return undefined;
  })();

  collectUrlLikeFields(value, state, new WeakSet<object>(), 0);

  if (!data) return;
  if (type === 'json' || type === 'lightapp') {
    pushText(state, data.data);
    collectJsonCardPayload(data.data, state);
    return;
  }
  if (type === 'xml') {
    pushText(state, data.data);
  }
}

/**
 * 根据`value`、`state`、`seen`处理URL类似的字段；当 `Array.isArray(value)` 成立时直接结束且不产生返回值。
 * @param value - 参与URL类似的字段比较、格式化或输出的候选值。
 * @param state - 决定URL类似的字段内容、边界或目标的 `state` 值。
 * @param seen - 决定URL类似的字段内容、边界或目标的 `seen` 值。
 * @param depth - 决定URL类似的字段内容、边界或目标的 `depth` 值。
 */
function collectUrlLikeFields(
  value: unknown,
  state: ExtractionState,
  seen: WeakSet<object>,
  depth: number,
) {
  if (!enterObjectNode(value, state, seen, depth)) return;

  if (Array.isArray(value)) {
    for (const item of value) {
      collectUrlLikeFields(item, state, seen, depth + 1);
    }
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (typeof nestedValue === 'string') {
      if (isUrlLikeKey(key)) pushText(state, nestedValue);
      continue;
    }
    collectUrlLikeFields(nestedValue, state, seen, depth + 1);
  }
}

/**
 * 根据`value`、`state`处理JSON卡片载荷。
 * @param value - 参与JSON卡片载荷比较、格式化或输出的候选值。
 * @param state - 决定JSON卡片载荷内容、边界或目标的 `state` 值。
 */
function collectJsonCardPayload(value: unknown, state: ExtractionState) {
  if (typeof value !== 'string' || value.length > MAX_JSON_BYTES) return;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return;
  try {
    collectUrlLikeFields(
      JSON.parse(trimmed),
      state,
      new WeakSet<object>(),
      0,
    );
  } catch {
    return;
  }
}

/**
 * 将`state`、`value`中的非空文本截断到安全上限后追加到目标集合。
 * @param state - 用于文本的领域对象，包含 `strings`、`candidates` 字段。
 * @param value - 参与文本比较、格式化或输出的候选值。
 */
function pushText(state: ExtractionState, value: unknown) {
  if (state.strings >= MAX_STRINGS) return;
  if (typeof value === 'string' && value.trim()) {
    state.strings += 1;
    state.candidates.push(value.slice(0, MAX_STRING_LENGTH));
  }
}

/**
 * 根据`value`与当前约束判定记录。
 * @param value - 待判定是否满足记录约束的候选值。
 * @returns 满足记录约束时为 `true`；不满足、未命中或显式失败分支为 `false`；无法解析或未命中时为 `null`。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * 根据`value`、`state`、`seen`处理进入对象节点；当 `depth > MAX_DEPTH || !isRecord(value) || state.nodes >= MAX_N…` 成立时返回 `false`。
 * @param value - 参与进入对象节点比较、格式化或输出的候选值。
 * @param state - 用于进入对象节点的领域对象，包含 `nodes` 字段。
 * @param seen - 用于进入对象节点的领域对象，包含 `has`、`add` 字段。
 * @param depth - 决定进入对象节点内容、边界或目标的 `depth` 值。
 * @returns 满足进入对象节点约束时为 `true`；不满足、未命中或显式失败分支为 `false`；没有匹配项时为空数组。
 */
function enterObjectNode(
  value: unknown,
  state: ExtractionState,
  seen: WeakSet<object>,
  depth: number,
): value is Record<string, unknown> | unknown[] {
  if (depth > MAX_DEPTH || !isRecord(value) || state.nodes >= MAX_NODES) {
    return false;
  }
  if (seen.has(value)) return false;
  seen.add(value);
  state.nodes += 1;
  return true;
}

/**
 * 根据`key`与当前约束判定URL类似的键。
 * @param key - 用于读取或更新URL类似的键的稳定键。
 * @returns 满足URL类似的键约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
 */
function isUrlLikeKey(key: string) {
  return URL_LIKE_KEY_PATTERN.test(key);
}

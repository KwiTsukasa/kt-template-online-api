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

function trimNonEntitySemicolonTail(rawUrl: string) {
  for (let index = 0; index < rawUrl.length; index += 1) {
    if (rawUrl[index] !== ';') continue;
    if (HTML_ENTITY_BEFORE_SEMICOLON.test(rawUrl.slice(0, index))) continue;
    return rawUrl.slice(0, index);
  }
  return rawUrl;
}

function collectStringCandidates(input: BilibiliUrlExtractionInput) {
  const state = createExtractionState();
  pushText(state, input.messageText);
  pushText(state, input.rawMessage);
  collectRawEventCandidates(input.rawEvent, state);
  return state.candidates;
}

function createExtractionState(): ExtractionState {
  return {
    candidates: [],
    nodes: 0,
    strings: 0,
  };
}

function collectRawEventCandidates(
  rawEvent: BilibiliUrlExtractionInput['rawEvent'],
  state: ExtractionState,
) {
  if (!isRecord(rawEvent)) return;
  collectMessageSegments(rawEvent.message, state);
}

function collectMessageSegments(value: unknown, state: ExtractionState) {
  if (Array.isArray(value)) {
    for (const segment of value) {
      collectMessageSegment(segment, state);
    }
    return;
  }
  collectMessageSegment(value, state);
}

function collectMessageSegment(value: unknown, state: ExtractionState) {
  if (!isRecord(value)) return;
  const type = typeof value.type === 'string' ? value.type.toLowerCase() : '';
  const data = isRecord(value.data) ? value.data : undefined;

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

function pushText(state: ExtractionState, value: unknown) {
  if (state.strings >= MAX_STRINGS) return;
  if (typeof value === 'string' && value.trim()) {
    state.strings += 1;
    state.candidates.push(value.slice(0, MAX_STRING_LENGTH));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

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

function isUrlLikeKey(key: string) {
  return URL_LIKE_KEY_PATTERN.test(key);
}

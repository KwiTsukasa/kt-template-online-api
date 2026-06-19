import type { BilibiliUrlExtractionInput } from './bilibili-card.types';
import {
  cleanBilibiliUrlCandidate,
  isAllowedBilibiliUrl,
} from './bilibili-url-parser';

const URL_PATTERN = /https?:\/\/[^\s<>"',;:!，。！？；、\]\)}]+/giu;
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
 * Extracts Bilibili URL candidates from normalized message text and raw QQ card payloads.
 * @param input - Normalized QQBot message fields and raw OneBot event payload from NapCat.
 * @returns Unique allowed Bilibili URL strings in discovery order.
 */
export function extractBilibiliUrls(input: BilibiliUrlExtractionInput) {
  const candidates = collectStringCandidates(input);
  const seen = new Set<string>();
  const output: string[] = [];

  for (const text of candidates) {
    for (const rawUrl of text.match(URL_PATTERN) || []) {
      const cleaned = cleanBilibiliUrlCandidate(rawUrl);
      if (!isAllowedBilibiliUrl(cleaned) || seen.has(cleaned)) continue;
      seen.add(cleaned);
      output.push(cleaned);
      if (output.length >= MAX_URLS) return output;
    }
  }

  return output;
}

/**
 * Collects string values that may contain links from text fields and nested QQ card objects.
 * @param input - Extraction input built from normalized message state.
 * @returns Candidate strings that may contain URLs.
 */
function collectStringCandidates(input: BilibiliUrlExtractionInput) {
  const state = createExtractionState();
  pushText(state, input.messageText);
  pushText(state, input.rawMessage);
  collectRawEventCandidates(input.rawEvent, state);
  return state.candidates;
}

/**
 * Creates mutable extraction counters used to keep event traversal predictable.
 * @returns Empty extraction state with bounded candidate storage.
 */
function createExtractionState(): ExtractionState {
  return {
    candidates: [],
    nodes: 0,
    strings: 0,
  };
}

/**
 * Collects raw event candidates from explicit OneBot message segments and URL-like fields.
 * @param rawEvent - Raw OneBot event payload from NapCat.
 * @param state - Mutable extraction state with traversal counters.
 */
function collectRawEventCandidates(
  rawEvent: BilibiliUrlExtractionInput['rawEvent'],
  state: ExtractionState,
) {
  if (!isRecord(rawEvent)) return;
  collectMessageSegments(rawEvent.message, state);
  collectUrlLikeFields(rawEvent, state, new WeakSet<object>(), 0);
}

/**
 * Collects candidates from OneBot message segment arrays or a single segment object.
 * @param value - Raw `message` field from a OneBot event.
 * @param state - Mutable extraction state with traversal counters.
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
 * Collects URL-like fields and known card text payloads from one OneBot message segment.
 * @param value - Raw OneBot segment value.
 * @param state - Mutable extraction state with traversal counters.
 */
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

/**
 * Walks object payloads while collecting only values held by URL-like keys.
 * @param value - Unknown raw event value to inspect.
 * @param state - Mutable extraction state with traversal counters.
 * @param seen - Object identity set used to avoid cyclic payloads.
 * @param depth - Current recursion depth used to bound malformed payloads.
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
 * Parses a JSON card string when possible and ignores invalid JSON without aborting extraction.
 * @param value - Raw segment `data.data` value that may be JSON.
 * @param state - Mutable extraction state with traversal counters.
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
 * Adds a non-empty string candidate to the output list.
 * @param state - Mutable extraction state with traversal counters.
 * @param value - Candidate value from normalized text or raw card payload.
 */
function pushText(state: ExtractionState, value: unknown) {
  if (state.strings >= MAX_STRINGS) return;
  if (typeof value === 'string' && value.trim()) {
    state.strings += 1;
    state.candidates.push(value.slice(0, MAX_STRING_LENGTH));
  }
}

/**
 * Checks whether an unknown value is a non-null object record.
 * @param value - Unknown value from the raw event tree.
 * @returns `true` when the value can be inspected with object keys.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Enters an object node when recursion and node-count bounds allow it.
 * @param value - Unknown value being traversed.
 * @param state - Mutable extraction state with traversal counters.
 * @param seen - Object identity set used to avoid cyclic payloads.
 * @param depth - Current recursion depth used to bound malformed payloads.
 * @returns `true` when callers may inspect the object's children.
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
 * Identifies card fields that commonly carry jump URLs instead of display text.
 * @param key - Raw object key from a OneBot segment or card payload.
 * @returns `true` when the key name suggests URL content.
 */
function isUrlLikeKey(key: string) {
  return URL_LIKE_KEY_PATTERN.test(key);
}

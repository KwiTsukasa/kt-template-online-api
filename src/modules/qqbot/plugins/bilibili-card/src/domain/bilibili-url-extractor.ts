import type { BilibiliUrlExtractionInput } from './bilibili-card.types';
import {
  cleanBilibiliUrlCandidate,
  isAllowedBilibiliUrl,
} from './bilibili-url-parser';

const URL_PATTERN = /https?:\/\/[^\s<>"'，。！？；、]+/giu;
const MAX_DEPTH = 7;

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
  const output: string[] = [];
  const seen = new WeakSet<object>();
  pushText(output, input.messageText);
  pushText(output, input.rawMessage);
  collectUnknown(input.rawEvent, output, seen, 0);
  return output;
}

/**
 * Walks unknown card payload data while bounding recursion and parsing JSON-looking strings.
 * @param value - Unknown raw value from OneBot message segments or nested card fields.
 * @param output - Mutable candidate string list.
 * @param seen - Object identity set used to avoid cyclic payloads.
 * @param depth - Current recursion depth used to bound malformed payloads.
 */
function collectUnknown(
  value: unknown,
  output: string[],
  seen: WeakSet<object>,
  depth: number,
) {
  if (depth > MAX_DEPTH || value == null) return;
  if (typeof value === 'string') {
    pushText(output, value);
    collectJsonString(value, output, seen, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      collectUnknown(item, output, seen, depth + 1);
    }
    return;
  }

  for (const nestedValue of Object.values(value)) {
    collectUnknown(nestedValue, output, seen, depth + 1);
  }
}

/**
 * Parses a JSON card string when possible and ignores invalid JSON without aborting extraction.
 * @param value - Raw string that may be JSON.
 * @param output - Mutable candidate string list.
 * @param seen - Object identity set shared with the recursive walk.
 * @param depth - Recursion depth for the parsed value.
 */
function collectJsonString(
  value: string,
  output: string[],
  seen: WeakSet<object>,
  depth: number,
) {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return;
  try {
    collectUnknown(JSON.parse(trimmed), output, seen, depth);
  } catch {
    return;
  }
}

/**
 * Adds a non-empty string candidate to the output list.
 * @param output - Mutable candidate string list.
 * @param value - Candidate value from normalized text or raw card payload.
 */
function pushText(output: string[], value: unknown) {
  if (typeof value === 'string' && value.trim()) {
    output.push(value);
  }
}

import type { BilibiliUrlExtractionInput } from './bilibili-card.types';
import {
  cleanBilibiliUrlCandidate,
  isAllowedBilibiliUrl,
} from './bilibili-url-parser';

const URL_PATTERN = /https?:\/\/[^\s<>"',:!，。！？；、\]\)}]+/giu;
const HTML_ENTITY_BEFORE_SEMICOLON = /&(?:amp|quot|lt|gt|#34|#60|#62)$/iu;
const MAX_URLS = 20;

/**
 * 从平台适配器预抽取链接与标准正文中筛选 Bilibili URL，插件不再解析任何平台原始事件结构。
 * @param input - 平台无关的链接、正文和原始正文集合。
 * @returns 按首次出现顺序去重且通过 Bilibili 域名策略的 URL。
 */
export function extractBilibiliUrls(input: BilibiliUrlExtractionInput) {
  const candidates = [
    ...(input.links || []),
    `${input.messageText || ''}`,
    `${input.rawMessage || ''}`,
  ];
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
 * 将首个非 HTML 实体分号后的尾部裁掉，同时保留实体编码中的合法分号。
 * @param rawUrl - 正则抽取到的原始 URL 候选。
 * @returns 可继续执行 URL 规范化的候选文本。
 */
function trimNonEntitySemicolonTail(rawUrl: string) {
  for (let index = 0; index < rawUrl.length; index += 1) {
    if (rawUrl[index] !== ';') continue;
    if (HTML_ENTITY_BEFORE_SEMICOLON.test(rawUrl.slice(0, index))) continue;
    return rawUrl.slice(0, index);
  }
  return rawUrl;
}

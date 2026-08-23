import { XMLParser } from 'fast-xml-parser';

export interface MediaGovernanceRssEntry {
  guid: null | string;
  magnetUri: null | string;
  publishedAt: Date | null;
  title: string;
}

const MAX_FEED_BYTES = 2 * 1024 * 1024;
const MAX_FEED_ITEMS = 5_000;

/**
 * 把 RSS/Atom 解析器可能返回的单值或数组统一为数组。
 * @param value - XML 节点的单值、数组或空值。
 * @returns 保持原始顺序的数组投影。
 */
function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

/**
 * 从 XML 文本节点、属性包装或原始标量中读取有界单行文本。
 * @param value - 解析后的 XML 节点值。
 * @param maximum - 允许返回的最大字符数。
 * @returns 清理空白后的文本；没有文本时返回空串。
 */
function nodeText(value: unknown, maximum: number): string {
  let candidate = value;
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    candidate = (candidate as Record<string, unknown>)['#text'];
  }
  if (!['number', 'string'].includes(typeof candidate)) return '';
  return String(candidate).replace(/\s+/gu, ' ').trim().slice(0, maximum);
}

/**
 * 从 Atom link、RSS enclosure、torrent 扩展或正文链接中提取唯一磁力链接。
 * @param item - 单个 RSS 或 Atom 条目。
 * @returns 长度受限且含 BTIH 的磁力链接；未命中时返回 `null`。
 */
function entryMagnet(item: Record<string, unknown>): null | string {
  const candidates: unknown[] = [
    item['torrent:magnetURI'],
    item.magnetURI,
    item.magnet,
  ];
  for (const enclosure of asArray(item.enclosure)) {
    if (enclosure && typeof enclosure === 'object') {
      candidates.push((enclosure as Record<string, unknown>)['@_url']);
    }
  }
  for (const link of asArray(item.link)) {
    candidates.push(link);
    if (link && typeof link === 'object') {
      candidates.push((link as Record<string, unknown>)['@_href']);
    }
  }
  for (const candidate of candidates) {
    const value = nodeText(candidate, 4_096);
    if (/^magnet:\?xt=urn:btih:/iu.test(value)) return value;
  }
  const infoHash = nodeText(
    item['nyaa:infoHash'] ?? item['torrent:infoHash'],
    40,
  ).toLowerCase();
  if (/^[a-f0-9]{40}$/u.test(infoHash)) {
    return `magnet:?xt=urn:btih:${infoHash}`;
  }
  return null;
}

/**
 * 把 RSS/Atom 日期字段转换为可持久化时间，拒绝无效或缺失日期。
 * @param value - pubDate、published 或 updated 节点。
 * @returns 有效日期；无法解析时返回 `null`。
 */
function entryDate(value: unknown): Date | null {
  const text = nodeText(value, 160);
  if (!text) return null;
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp);
}

/**
 * 解析有界 RSS 2.0 或 Atom XML，并只投影去重所需的标题、GUID、时间和磁链。
 * @param xml - 从订阅地址取得的完整 XML 文本。
 * @returns 最多五千条、保持源顺序的标准条目。
 * @throws XML 超限、含实体声明、结构无效或条目数超限时抛出。
 */
export function parseMediaGovernanceRss(
  xml: string,
): MediaGovernanceRssEntry[] {
  if (
    Buffer.byteLength(xml, 'utf8') > MAX_FEED_BYTES ||
    /<!DOCTYPE|<!ENTITY/iu.test(xml)
  ) {
    throw new Error('media-rss-feed-boundary-invalid');
  }
  const parser = new XMLParser({
    attributeNamePrefix: '@_',
    ignoreAttributes: false,
    parseTagValue: false,
    processEntities: false,
    textNodeName: '#text',
    trimValues: true,
  });
  const document = parser.parse(xml) as Record<string, unknown>;
  const rss = document.rss as Record<string, unknown> | undefined;
  const channel = rss?.channel as Record<string, unknown> | undefined;
  const atom = document.feed as Record<string, unknown> | undefined;
  let rawItems = asArray(atom?.entry);
  if (channel) rawItems = asArray(channel.item);
  if (rawItems.length > MAX_FEED_ITEMS) {
    throw new Error('media-rss-feed-item-limit-exceeded');
  }
  return rawItems
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object' && !Array.isArray(item),
    )
    .map((item) => ({
      guid:
        nodeText(item.guid ?? item.id, 512) || nodeText(item.link, 512) || null,
      magnetUri: entryMagnet(item),
      publishedAt: entryDate(item.pubDate ?? item.published ?? item.updated),
      title: nodeText(item.title, 512),
    }))
    .filter((item) => item.title.length > 0);
}

/**
 * 按管理员提供的捕获组或内置发布名模式提取集号，避免把年份和分辨率误作集号。
 * @param title - RSS 条目标题。
 * @param episodePattern - 可选正则；优先读取命名组 `episode`，否则读取第一捕获组。
 * @returns 1–2000 的集号；未命中或越界时返回 `null`。
 * @throws 自定义正则无法编译时抛出。
 */
export function parseMediaGovernanceEpisodeNumber(
  title: string,
  episodePattern: null | string,
): null | number {
  const patterns: RegExp[] = [];
  if (episodePattern) patterns.push(new RegExp(episodePattern, 'iu'));
  patterns.push(/\s-\s(\d{1,4})(?:\s|\[|\()/u);
  patterns.push(/\bE(?:P)?\s*(\d{1,4})\b/iu);
  for (const pattern of patterns) {
    const match = pattern.exec(title);
    const value = match?.groups?.episode ?? match?.[1];
    if (!value) continue;
    const episode = Number(value);
    if (Number.isInteger(episode) && episode >= 1 && episode <= 2_000) {
      return episode;
    }
  }
  return null;
}

/**
 * 空规则保留订阅全量；非空规则以一次正则命中作为进入集号解析链的唯一门禁。
 * @param title - RSS 条目标题。
 * @param includePattern - 可选包含正则。
 * @returns 未配置正则或标题命中时返回 `true`。
 * @throws 自定义正则无法编译时抛出。
 */
export function mediaGovernanceRssTitleIncluded(
  title: string,
  includePattern: null | string,
): boolean {
  if (!includePattern) return true;
  return new RegExp(includePattern, 'iu').test(title);
}

/**
 * 从磁力链接读取规范小写 BTIH，供 RSS 去重和来源身份绑定。
 * @param magnetUri - 已从 RSS 条目提取的磁力链接。
 * @returns 四十位小写 BTIH。
 * @throws 链接格式或 BTIH 不受支持时抛出。
 */
export function mediaGovernanceMagnetInfoHash(magnetUri: string): string {
  const parsed = new URL(magnetUri);
  const xt = parsed.searchParams
    .getAll('xt')
    .find((value) => /^urn:btih:/iu.test(value));
  const match = xt?.match(/^urn:btih:([a-f0-9]{40})$/iu);
  if (!match) throw new Error('media-rss-magnet-info-hash-invalid');
  return match[1].toLowerCase();
}

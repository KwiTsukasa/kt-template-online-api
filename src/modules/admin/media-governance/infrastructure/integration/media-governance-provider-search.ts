import type { MediaGovernanceMediaType } from '@/modules/admin/media-governance/contract/media-governance.dto';

const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_CANDIDATES = 8;

export interface MediaGovernanceTmdbCandidate {
  candidateId: string;
  originalTitle: null | string;
  posterUrl: null | string;
  provider: 'tmdb';
  providerId: string;
  releaseYear: null | number;
  title: string;
}

export interface MediaGovernanceTmdbSeasonFact {
  episodeCount: number;
  episodeStart: number;
  releaseYear: null | number;
  seasonNumber: number;
  title: string;
}

/**
 * 查询 TMDB 中文搜索页，保留展示标题与原始片名，并按发行年份优先返回有界候选。
 * @param input - 用于searchTmdb媒体任务Candidates的结构化输入，包含 `mediaType`、`title`、`releaseYear` 字段。
 * @returns 按输入顺序得到的searchTmdb媒体任务Candidates列表；没有匹配项时为空数组。
 * @throws 当 `!response.ok || !String(response.headers.get('content-type') ?? '') .to…` 成立时拒绝当前输入并抛出 `Error`。
 */
export async function searchTmdbMediaCandidates(input: {
  mediaType: MediaGovernanceMediaType;
  releaseYear: null | number;
  title: string;
}): Promise<MediaGovernanceTmdbCandidate[]> {
  let mediaType: 'movie' | 'tv' = 'movie';
  if (input.mediaType === 'tv') mediaType = 'tv';
  const url = new URL(`https://www.themoviedb.org/search/${mediaType}`);
  url.searchParams.set('language', 'zh-CN');
  url.searchParams.set('query', input.title.trim());
  const html = await fetchTmdbHtml(url, `/search/${mediaType}`);
  const candidates = parseTmdbSearchHtml(html, mediaType);
  return candidates
    .sort((left, right) => {
      let leftMatches = 0;
      if (left.releaseYear === input.releaseYear) leftMatches = 1;
      let rightMatches = 0;
      if (right.releaseYear === input.releaseYear) rightMatches = 1;
      return rightMatches - leftMatches;
    })
    .slice(0, MAX_CANDIDATES);
}

/**
 * 按显式 TMDB ID 读取官方详情页并核对媒体类型与年份，作为搜索页不可用时的独立身份验证路径。
 * @param input - 媒体类型、TMDB ID 与任务声明年份。
 * @returns 通过官方页面验证且包含展示标题、原始片名与年份的唯一 TMDB 候选。
 * @throws 页面不可用、路径漂移、标题缺失或年份不一致时拒绝候选。
 */
export async function verifyTmdbMediaCandidate(input: {
  mediaType: MediaGovernanceMediaType;
  providerId: string;
  releaseYear: null | number;
}): Promise<MediaGovernanceTmdbCandidate> {
  let mediaType: 'movie' | 'tv' = 'movie';
  if (input.mediaType === 'tv') mediaType = 'tv';
  if (!/^[1-9]\d*$/u.test(input.providerId)) {
    throw new Error('tmdb-provider-id-invalid');
  }
  const pathname = `/${mediaType}/${input.providerId}`;
  const url = new URL(`https://www.themoviedb.org${pathname}`);
  url.searchParams.set('language', 'zh-CN');
  const html = await fetchTmdbHtml(url, pathname);
  const openGraphTitle = html.match(
    /<meta\b[^>]*\bproperty="og:title"[^>]*\bcontent="([^"]+)"/iu,
  )?.[1];
  const documentTitle = html.match(/<title>([^<]+)<\/title>/iu)?.[1];
  const decodedDocumentTitle = decodeHtmlAttribute(documentTitle ?? '').trim();
  let title = decodeHtmlAttribute(openGraphTitle ?? '').trim();
  if (!title) title = decodedDocumentTitle;
  title = title.replace(/\s*[—|-]\s*The Movie Database.*$/iu, '').trim();
  const releaseText = decodeHtmlAttribute(
    html.match(/class="[^"]*\brelease(?:_date)?\b[^"]*"[^>]*>([^<]*)/iu)?.[1] ??
      '',
  );
  const originalTitle = decodeHtmlAttribute(
    html.match(
      /<p\b[^>]*\bclass="[^"]*\bwrap\b[^"]*"[^>]*>\s*<strong\b[^>]*>(?:<bdi>)?(?:原始片名|Original Name)(?:<\/bdi>)?<\/strong>\s*([^<]+)<\/p>/iu,
    )?.[1] ?? '',
  );
  const yearMatch = `${decodedDocumentTitle} ${releaseText}`.match(
    /(?:18|19|20|21)\d{2}/u,
  )?.[0];
  let releaseYear: null | number = null;
  if (yearMatch) releaseYear = Number(yearMatch);
  let normalizedOriginalTitle: null | string = null;
  if (originalTitle.trim()) normalizedOriginalTitle = originalTitle.trim();
  const yearMatches =
    input.releaseYear === null || releaseYear === input.releaseYear;
  if (!title || !yearMatches) {
    throw new Error('tmdb-provider-candidate-mismatch');
  }
  return {
    candidateId: `tmdb:${input.providerId}`,
    originalTitle: normalizedOriginalTitle,
    posterUrl: null,
    provider: 'tmdb',
    providerId: input.providerId,
    releaseYear,
    title,
  };
}

/**
 * 按显式 TMDB TV ID 读取官方季列表，并拒绝缺少正集数季事实的响应。
 * @param providerId - TMDB TV 唯一编号。
 * @returns 按季号升序排列且至少包含一个正集数季的官方事实。
 * @throws ID 非法、页面不可用或季事实不完整时拒绝创建空 TV Series。
 */
export async function fetchTmdbTvSeasonFacts(
  providerId: string,
): Promise<MediaGovernanceTmdbSeasonFact[]> {
  if (!/^[1-9]\d*$/u.test(providerId)) {
    throw new Error('tmdb-provider-id-invalid');
  }
  const pathname = `/tv/${providerId}/seasons`;
  const url = new URL(`https://www.themoviedb.org${pathname}`);
  url.searchParams.set('language', 'zh-CN');
  const html = await fetchTmdbHtml(url, pathname);
  const facts = parseTmdbTvSeasonFactsHtml(html, providerId);
  if (facts.length === 0) {
    throw new Error('tmdb-provider-season-facts-missing');
  }
  return facts;
}

/**
 * 从 TMDB TV 季列表卡片读取季号、正集数和可选首播年份，并去除重复链接。
 * @param html - TMDB 官方季列表 HTML。
 * @param providerId - 页面必须归属的 TMDB TV 编号。
 * @returns 可直接固化为连续 Season/Episode 的有界季事实。
 * @throws 页面出现越界季号或无法读取集数的季卡片时拒绝部分投影。
 */
export function parseTmdbTvSeasonFactsHtml(
  html: string,
  providerId: string,
): MediaGovernanceTmdbSeasonFact[] {
  if (!/^[1-9]\d*$/u.test(providerId)) {
    throw new Error('tmdb-provider-id-invalid');
  }
  const facts: MediaGovernanceTmdbSeasonFact[] = [];
  const seen = new Set<number>();
  const linkPattern = new RegExp(
    `href="\\/tv\\/${providerId}\\/season\\/(\\d{1,3})(?:\\?[^\"]*)?"`,
    'gu',
  );
  for (const match of html.matchAll(linkPattern)) {
    const seasonNumber = Number(match[1]);
    if (seen.has(seasonNumber)) continue;
    if (
      !Number.isInteger(seasonNumber) ||
      seasonNumber < 0 ||
      seasonNumber > 99
    ) {
      throw new Error('tmdb-provider-season-number-invalid');
    }
    seen.add(seasonNumber);
    let cardEnd = match.index + 16_000;
    const nextSeason = html.indexOf('<div class="season">', match.index + 1);
    if (nextSeason >= 0 && nextSeason < cardEnd) cardEnd = nextSeason;
    const cardText = decodeHtmlAttribute(
      html.slice(match.index, cardEnd).replace(/<[^>]+>/gu, ' '),
    ).replace(/\s+/gu, ' ');
    const episodeCountText = cardText.match(
      /(?:共\s*)?(\d{1,4})\s*(?:集|Episodes?)/iu,
    )?.[1];
    if (!episodeCountText) {
      throw new Error('tmdb-provider-season-episode-count-missing');
    }
    const episodeCount = Number(episodeCountText);
    if (episodeCount === 0) continue;
    if (episodeCount > 2_000) {
      throw new Error('tmdb-provider-season-episode-count-invalid');
    }
    const releaseYearText = cardText.match(/(?:18|19|20|21)\d{2}/u)?.[0];
    let releaseYear: null | number = null;
    if (releaseYearText) releaseYear = Number(releaseYearText);
    let title = `第 ${seasonNumber} 季`;
    if (seasonNumber === 0) title = '特别篇';
    facts.push({
      episodeCount,
      episodeStart: 1,
      releaseYear,
      seasonNumber,
      title,
    });
  }
  facts.sort((left, right) => left.seasonNumber - right.seasonNumber);
  return facts;
}

/**
 * 以禁用连接复用的两次有界请求读取 TMDB HTML，并限制重定向仍停留在预期官方路径。
 * @param url - TMDB 搜索或详情页 URL。
 * @param expectedPathPrefix - 跟随重定向后仍必须命中的官方路径前缀。
 * @returns 不超过 512 KiB 的 HTML 正文。
 * @throws 两次请求均失败、响应类型错误或最终地址漂移时抛出稳定不可用错误。
 */
async function fetchTmdbHtml(url: URL, expectedPathPrefix: string) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: 'text/html,application/xhtml+xml',
          connection: 'close',
          'user-agent': 'KT-Media-Governance/1.0',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(10_000),
      });
      const finalUrl = new URL(response.url);
      const officialHost = finalUrl.hostname === 'www.themoviedb.org';
      const expectedPath = finalUrl.pathname.startsWith(expectedPathPrefix);
      const htmlResponse = String(response.headers.get('content-type') ?? '')
        .toLowerCase()
        .includes('text/html');
      if (response.ok && officialHost && expectedPath && htmlResponse) {
        return await readBoundedText(response);
      }
    } catch {
      if (attempt === 2) break;
    }
  }
  throw new Error('tmdb-provider-search-unavailable');
}

/**
 * 从 TMDB 搜索页提取去重后的展示标题、原始片名、年份、海报与资料源标识。
 * @param html - 用于从 TMDB 搜索页提取去重后的标题、年份、海报与资料源标识的领域对象，包含 `matchAll` 字段。
 * @param mediaType - 决定从 TMDB 搜索页提取去重后的标题、年份、海报与资料源标识内容、边界或目标的 `mediaType` 值。
 * @returns 按输入顺序得到的从 TMDB 搜索页提取去重后的标题、年份、海报与资料源标识列表；没有匹配项时为空数组。
 */
export function parseTmdbSearchHtml(
  html: string,
  mediaType: 'movie' | 'tv',
): MediaGovernanceTmdbCandidate[] {
  const candidates: MediaGovernanceTmdbCandidate[] = [];
  const seen = new Set<string>();
  const linkPattern = new RegExp(
    `href="\\/${mediaType}\\/([1-9]\\d*)[^\"]*"`,
    'gu',
  );
  for (const match of html.matchAll(linkPattern)) {
    const providerId = match[1];
    if (!providerId || seen.has(providerId)) continue;
    const card = html.slice(match.index, match.index + 8_000);
    const title = decodeHtmlAttribute(
      card.match(/<img\b[^>]*\balt="([^"]+)"/iu)?.[1] ?? '',
    ).trim();
    if (!title) continue;
    const poster = decodeHtmlAttribute(
      card.match(/<img\b[^>]*\bsrc="([^"]+)"/iu)?.[1] ?? '',
    );
    const releaseText = decodeHtmlAttribute(
      card.match(/class="[^"]*\brelease_date\b[^"]*"[^>]*>([^<]*)</iu)?.[1] ??
        '',
    );
    const year = releaseText.match(/(?:18|19|20|21)\d{2}/u)?.[0];
    const originalTitle = decodeHtmlAttribute(
      card.match(
        /<span\b[^>]*\bclass="[^"]*\bfont-light\b[^"]*"[^>]*>\s*\(([^<]+)\)\s*<\/span>/iu,
      )?.[1] ?? '',
    ).trim();
    seen.add(providerId);
    let posterUrl = null;
    if (/^https:\/\/media\.themoviedb\.org\//u.test(poster)) {
      posterUrl = poster;
    }
    let releaseYear = null;
    if (year) releaseYear = Number(year);
    let normalizedOriginalTitle: null | string = null;
    if (originalTitle) normalizedOriginalTitle = originalTitle;
    candidates.push({
      candidateId: `tmdb:${providerId}`,
      originalTitle: normalizedOriginalTitle,
      posterUrl,
      provider: 'tmdb',
      providerId,
      releaseYear,
      title,
    });
    if (candidates.length >= MAX_CANDIDATES) break;
  }
  return candidates;
}

/**
 * 逐块读取 HTTP 响应正文并累计文本；超过允许字节数时取消流并拒绝响应。
 * @param response - 包含 `body` 字段的上游服务响应。
 * @returns 当前状态对应的逐块读取 HTTP 响应正文并累计文本，取值为 `''`。
 * @throws 当 `total > MAX_RESPONSE_BYTES` 成立时拒绝当前输入并抛出 `Error`。
 */
async function readBoundedText(response: Response) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('tmdb-provider-search-response-too-large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * 根据参数 `value`，解码搜索页属性中允许出现的 HTML 实体。
 * @param value - 待转换为根据参数 `value`，解码搜索页属性中允许出现的 HTML 实体的原始值。
 * @returns 根据参数 `value`，解码搜索页属性中允许出现的 HTML 实体。
 */
function decodeHtmlAttribute(value: string) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replace(/&#(\d+);/gu, (_match, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([a-f0-9]+);/giu, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

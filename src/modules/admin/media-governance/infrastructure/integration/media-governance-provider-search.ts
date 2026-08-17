import type { MediaGovernanceMediaType } from '@/modules/admin/media-governance/contract/media-governance.dto';

const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_CANDIDATES = 8;

export interface MediaGovernanceTmdbCandidate {
  candidateId: string;
  posterUrl: null | string;
  provider: 'tmdb';
  providerId: string;
  releaseYear: null | number;
  title: string;
}

/** 查询 TMDB 中文搜索页，并按发行年份优先返回有界候选。 */
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
  const response = await fetch(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': 'KT-Media-Governance/1.0',
    },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (
    !response.ok ||
    !String(response.headers.get('content-type') ?? '')
      .toLowerCase()
      .includes('text/html')
  ) {
    throw new Error('tmdb-provider-search-unavailable');
  }
  const html = await readBoundedText(response);
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

/** 从 TMDB 搜索页提取去重后的标题、年份、海报与资料源标识。 */
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
    seen.add(providerId);
    let posterUrl = null;
    if (/^https:\/\/media\.themoviedb\.org\//u.test(poster)) {
      posterUrl = poster;
    }
    let releaseYear = null;
    if (year) releaseYear = Number(year);
    candidates.push({
      candidateId: `tmdb:${providerId}`,
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

/** 读取响应流并在超过允许体积时主动取消请求。 */
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

/** 解码搜索页属性中允许出现的 HTML 实体。 */
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

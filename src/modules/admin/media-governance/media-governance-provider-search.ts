import type { MediaGovernanceMediaType } from './media-governance.dto';

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

export async function searchTmdbMediaCandidates(input: {
  mediaType: MediaGovernanceMediaType;
  releaseYear: null | number;
  title: string;
}): Promise<MediaGovernanceTmdbCandidate[]> {
  const mediaType = input.mediaType === 'tv' ? 'tv' : 'movie';
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
      const leftMatches = left.releaseYear === input.releaseYear ? 1 : 0;
      const rightMatches = right.releaseYear === input.releaseYear ? 1 : 0;
      return rightMatches - leftMatches;
    })
    .slice(0, MAX_CANDIDATES);
}

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
    candidates.push({
      candidateId: `tmdb:${providerId}`,
      posterUrl: /^https:\/\/media\.themoviedb\.org\//u.test(poster)
        ? poster
        : null,
      provider: 'tmdb',
      providerId,
      releaseYear: year ? Number(year) : null,
      title,
    });
    if (candidates.length >= MAX_CANDIDATES) break;
  }
  return candidates;
}

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

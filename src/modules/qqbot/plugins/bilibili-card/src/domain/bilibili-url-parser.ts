import type { BilibiliVideoReference } from './bilibili-card.types';

const BILIBILI_HOST = 'bilibili.com';
const B23_HOST = 'b23.tv';
const TRAILING_WRAPPERS = /[\s"'<>，。！？、；：）)\]}】]+$/u;
const LEADING_WRAPPERS = /^[\s"'<>（([{【]+/u;
const BVID_PATTERN = /^BV[0-9A-Za-z]{10}$/;
const AID_PATTERN = /^(?:av|AV)(\d+)$/;

/**
 * Removes QQ card wrappers and punctuation that often stick to copied URLs.
 * @param candidate - Raw string fragment found in text or card JSON.
 * @returns Cleaned URL candidate ready for `URL` parsing.
 */
export function cleanBilibiliUrlCandidate(candidate: string) {
  return candidate
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#34;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&#60;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&#62;', '>')
    .replace(LEADING_WRAPPERS, '')
    .replace(TRAILING_WRAPPERS, '')
    .trim();
}

/**
 * Checks whether a URL belongs to the Bilibili domains this plugin is allowed to parse.
 * @param candidate - URL string collected from a QQ message or redirect result.
 * @returns `true` when the host is Bilibili-owned or `b23.tv`.
 */
export function isAllowedBilibiliUrl(candidate: string) {
  try {
    const url = new URL(cleanBilibiliUrlCandidate(candidate));
    const hostname = url.hostname.toLowerCase();
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      (hostname === B23_HOST ||
        hostname === BILIBILI_HOST ||
        hostname.endsWith(`.${BILIBILI_HOST}`))
    );
  } catch {
    return false;
  }
}

/**
 * Extracts a Bilibili video identifier from a supported URL.
 * @param candidate - Direct Bilibili video URL or short-link URL that already embeds BV/av.
 * @returns Parsed video reference, or `null` when the URL is not a supported video URL.
 */
export function parseBilibiliVideoReference(
  candidate: string,
): BilibiliVideoReference | null {
  const cleaned = cleanBilibiliUrlCandidate(candidate);
  if (!isAllowedBilibiliUrl(cleaned)) return null;

  const url = new URL(cleaned);
  const pathSegments = url.pathname.split('/').filter(Boolean);
  const videoSegmentIndex = pathSegments.findIndex(
    (segment) => segment.toLowerCase() === 'video',
  );
  if (videoSegmentIndex < 0) return null;

  const videoIdSegment = pathSegments[videoSegmentIndex + 1];
  if (videoIdSegment && BVID_PATTERN.test(videoIdSegment)) {
    return {
      canonicalVideoId: videoIdSegment,
      kind: 'bvid',
      sourceUrl: cleaned,
      value: videoIdSegment,
    };
  }

  const aid = videoIdSegment?.match(AID_PATTERN)?.[1];
  if (aid) {
    return {
      canonicalVideoId: `av${aid}`,
      kind: 'aid',
      sourceUrl: cleaned,
      value: aid,
    };
  }

  return null;
}

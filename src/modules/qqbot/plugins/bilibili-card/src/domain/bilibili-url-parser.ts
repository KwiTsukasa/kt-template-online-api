import type { BilibiliVideoReference } from './bilibili-card.types';

const BILIBILI_HOST = 'bilibili.com';
const B23_HOST = 'b23.tv';
const TRAILING_WRAPPERS = /[\s"'<>.,!?;:，。！？、；：）)\]}】]+$/u;
const LEADING_WRAPPERS = /^[\s"'<>（([{【]+/u;
const BVID_PATTERN = /^BV[0-9A-Za-z]{10}$/;
const AID_PATTERN = /^(?:av|AV)(\d+)$/;

/** 返回清理BilibiliURL候选项。 */
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

/** 判断允许的BilibiliURL是否成立。 */
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

/** 解析Bilibili视频引用。 */
export function parseBilibiliVideoReference(
  candidate: string,
): BilibiliVideoReference | null {
  const cleaned = cleanBilibiliUrlCandidate(candidate);
  if (!isAllowedBilibiliUrl(cleaned)) return null;

  const url = new URL(cleaned);
  const pathSegments = url.pathname.split('/').filter(Boolean);
  const hostname = url.hostname.toLowerCase();
  let videoIdSegment: string | undefined;

  if (hostname === B23_HOST) {
    videoIdSegment = pathSegments[0];
  } else {
    const videoSegmentIndex = pathSegments.findIndex(
      (segment) => segment.toLowerCase() === 'video',
    );
    if (videoSegmentIndex < 0) return null;
    videoIdSegment = pathSegments[videoSegmentIndex + 1];
  }

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

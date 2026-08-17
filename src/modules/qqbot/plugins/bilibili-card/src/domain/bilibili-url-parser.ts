import type { BilibiliVideoReference } from './bilibili-card.types';

const BILIBILI_HOST = 'bilibili.com';
const B23_HOST = 'b23.tv';
const TRAILING_WRAPPERS = /[\s"'<>.,!?;:，。！？、；：）)\]}】]+$/u;
const LEADING_WRAPPERS = /^[\s"'<>（([{【]+/u;
const BVID_PATTERN = /^BV[0-9A-Za-z]{10}$/;
const AID_PATTERN = /^(?:av|AV)(\d+)$/;

/**
 * 清理输入并返回BilibiliURL候选项。
 * @param candidate - 决定是否启用“candidate”分支的布尔选项。
 * @returns 输入并返回BilibiliURL候选项。
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
 * 根据`candidate`与当前约束判定允许的BilibiliURL。
 * @param candidate - 决定是否启用“candidate”分支的布尔选项。
 * @returns 满足允许的BilibiliURL约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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
 * 从`candidate`解析Bilibili视频引用；当 `videoIdSegment && BVID_PATTERN.test(videoIdSegment)` 成立时返回 `{ canonicalVideoId: videoIdSegment, kind: '…`。
 * @param candidate - 决定是否启用“candidate”分支的布尔选项。
 * @returns 包含 `canonicalVideoId`、`kind`、`sourceUrl`、`value` 字段的Bilibili视频引用；无法解析或未命中时为 `null`。
 */
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

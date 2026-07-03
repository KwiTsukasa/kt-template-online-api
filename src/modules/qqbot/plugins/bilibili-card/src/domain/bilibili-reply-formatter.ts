import type {
  BilibiliCardRuntimeConfig,
  BilibiliVideoInfo,
} from './bilibili-card.types';

/**
 * Formats a Bilibili video summary as a leading cover CQ image plus text for QQBot replies.
 * @param video - Normalized video info returned by the package-local Bilibili client.
 * @param config - Runtime config that controls the maximum displayed description length.
 * @returns Concise CQ-compatible reply with a cover image and canonical Bilibili video URL.
 */
export function formatBilibiliVideoReply(
  video: BilibiliVideoInfo,
  config: BilibiliCardRuntimeConfig,
) {
  const coverImageSegment = buildBilibiliCoverImageSegment(video.pic);
  const lines = [
    ...(coverImageSegment ? [coverImageSegment] : []),
    'Bilibili 视频解析',
    `标题：${video.title || '未知标题'}`,
    `UP：${video.ownerName || '未知UP主'}`,
    `时长：${formatBilibiliDuration(video.duration)}`,
    `播放：${formatBilibiliStat(video.stat.view)} 弹幕：${formatBilibiliStat(
      video.stat.danmaku,
    )} 点赞：${formatBilibiliStat(video.stat.like)}`,
    `链接：${buildCanonicalBilibiliVideoUrl(video)}`,
  ];
  const desc = truncateBilibiliDescription(video.desc, config.descMaxLength);
  if (desc) lines.push(`简介：${desc}`);
  return lines.join('\n');
}

/**
 * Builds the leading CQ image segment from the Bilibili cover URL.
 * @param pic - Cover URL returned by the Bilibili video API; used as the OneBot image `file` parameter.
 * @returns CQ image segment placed before the text summary, or an empty string when no cover URL exists.
 */
function buildBilibiliCoverImageSegment(pic: string) {
  const normalizedPic = `${pic || ''}`.trim();
  if (!normalizedPic) return '';
  return `[CQ:image,file=${escapeCqParam(normalizedPic)}]`;
}

/**
 * Escapes values embedded in a CQ segment parameter.
 * @param value - Raw parameter value that may contain CQ delimiters or HTML entity characters.
 * @returns Value safe to embed in a single CQ parameter.
 */
function escapeCqParam(value: string) {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/\[/gu, '&#91;')
    .replace(/\]/gu, '&#93;')
    .replace(/,/gu, '&#44;');
}

/**
 * Builds the canonical public Bilibili video URL used in replies.
 * @param video - Normalized video info containing either a BV id or an av id fallback.
 * @returns Public Bilibili video URL that does not echo short links.
 */
function buildCanonicalBilibiliVideoUrl(video: BilibiliVideoInfo) {
  const videoId = video.bvid || `av${video.aid}`;
  return `https://www.bilibili.com/video/${videoId}`;
}

/**
 * Formats Bilibili stat counters using compact Chinese units.
 * @param value - Raw counter from the Bilibili video API response.
 * @returns Counter text such as `7890` or `12.3万`.
 */
function formatBilibiliStat(value: number) {
  const normalized = Math.max(0, Math.floor(value || 0));
  if (normalized < 10000) return `${normalized}`;
  const wan = normalized / 10000;
  const formatted = wan >= 100 ? `${Math.round(wan)}` : wan.toFixed(1);
  return `${formatted.replace(/\.0$/, '')}万`;
}

/**
 * Formats a duration in seconds as `mm:ss` or `hh:mm:ss`.
 * @param seconds - Duration seconds from the Bilibili video API response.
 * @returns Padded duration suitable for compact message replies.
 */
function formatBilibiliDuration(seconds: number) {
  const normalized = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(normalized / 3600);
  const minutes = Math.floor((normalized % 3600) / 60);
  const restSeconds = normalized % 60;
  if (hours > 0) {
    return [hours, minutes, restSeconds]
      .map((item) => `${item}`.padStart(2, '0'))
      .join(':');
  }
  return [minutes, restSeconds]
    .map((item) => `${item}`.padStart(2, '0'))
    .join(':');
}

/**
 * Converts multi-line descriptions into one compact line and applies the configured limit.
 * @param desc - Raw Bilibili description text from the video API response.
 * @param maxLength - Maximum number of visible characters configured for this plugin.
 * @returns Trimmed description, with an ellipsis when content was shortened.
 */
function truncateBilibiliDescription(desc: string, maxLength: number) {
  const normalized = desc.replace(/\s+/gu, ' ').trim();
  if (!normalized || maxLength <= 0) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}…`;
}

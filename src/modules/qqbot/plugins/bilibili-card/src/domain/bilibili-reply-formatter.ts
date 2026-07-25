import type {
  BilibiliCardRuntimeConfig,
  BilibiliVideoInfo,
} from './bilibili-card.types';

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

function buildBilibiliCoverImageSegment(pic: string) {
  const normalizedPic = `${pic || ''}`.trim();
  if (!normalizedPic) return '';
  return `[CQ:image,file=${escapeCqParam(normalizedPic)}]`;
}

function escapeCqParam(value: string) {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/\[/gu, '&#91;')
    .replace(/\]/gu, '&#93;')
    .replace(/,/gu, '&#44;');
}

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

function truncateBilibiliDescription(desc: string, maxLength: number) {
  const normalized = desc.replace(/\s+/gu, ' ').trim();
  if (!normalized || maxLength <= 0) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}…`;
}

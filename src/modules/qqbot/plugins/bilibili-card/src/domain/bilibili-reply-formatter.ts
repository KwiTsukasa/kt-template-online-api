import type {
  BilibiliCardRuntimeConfig,
  BilibiliVideoInfo,
} from './bilibili-card.types';

/**
 * 将`video`、`config`转换为Bilibili视频回复。
 * @param video - 用于Bilibili视频回复的领域对象，包含 `pic`、`title`、`ownerName`、`duration` 字段。
 * @param config - 限定Bilibili视频回复边界、地址与开关的运行配置，包含 `descMaxLength` 字段。
 * @returns Bilibili视频回复。
 */
export function formatBilibiliVideoReply(
  video: BilibiliVideoInfo,
  config: BilibiliCardRuntimeConfig,
) {
  const coverImageSegment = buildBilibiliCoverImageSegment(video.pic);
  const lines = [
    ...((() => {
      if (coverImageSegment) {
        return [coverImageSegment];
      }
      return [];
    })()),
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
 * 根据`pic`构造Bilibili封面图片分段。
 * @param pic - 决定Bilibili封面图片分段内容、边界或目标的 `pic` 值。
 * @returns 当前状态对应的Bilibili封面图片分段，取值为 `''`。
 */
function buildBilibiliCoverImageSegment(pic: string) {
  const normalizedPic = `${pic || ''}`.trim();
  if (!normalizedPic) return '';
  return `[CQ:image,file=${escapeCqParam(normalizedPic)}]`;
}

/**
 * 将`value`中的CQ 码参数特殊字符转义，使结果可安全嵌入查询或脚本文本。
 * @param value - 待转换为CQ 码参数的原始值。
 * @returns 完成特殊字符转义的CQ 码参数。
 */
function escapeCqParam(value: string) {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/\[/gu, '&#91;')
    .replace(/\]/gu, '&#93;')
    .replace(/,/gu, '&#44;');
}

/**
 * 根据`video`构造规范的Bilibili视频URL。
 * @param video - 用于规范的Bilibili视频URL的领域对象，包含 `bvid`、`aid` 字段。
 * @returns 按参数编码并拼接完成的规范的Bilibili视频URL。
 */
function buildCanonicalBilibiliVideoUrl(video: BilibiliVideoInfo) {
  const videoId = video.bvid || `av${video.aid}`;
  return `https://www.bilibili.com/video/${videoId}`;
}

/**
 * 将非负整数统计值格式化为中文展示文本；不足一万保留整数，更大值按规模保留一位或取整。
 * @param value - 待转换为Bilibili统计的原始值。
 * @returns 按参数编码并拼接完成的Bilibili统计。
 */
function formatBilibiliStat(value: number) {
  const normalized = Math.max(0, Math.floor(value || 0));
  if (normalized < 10000) return `${normalized}`;
  const wan = normalized / 10000;
  const formatted = (() => {
    if (wan >= 100) {
      return `${Math.round(wan)}`;
    }
    return wan.toFixed(1);
  })();
  return `${formatted.replace(/\.0$/, '')}万`;
}

/**
 * 将`seconds`转换为Bilibili时长；当 `hours > 0` 成立时返回 `[hours, minutes, restSeconds] .map((item) =…`。
 * @param seconds - 决定Bilibili时长内容、边界或目标的 `seconds` 值。
 * @returns Bilibili时长。
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
 * 根据`desc`、`maxLength`处理截断Bilibili描述。
 * @param desc - 决定截断Bilibili描述内容、边界或目标的 `desc` 值。
 * @param maxLength - 限制截断Bilibili描述数量、尺寸、等级或重试边界的数值。
 * @returns 当前状态对应的截断Bilibili描述，取值为 `''`。
 */
function truncateBilibiliDescription(desc: string, maxLength: number) {
  const normalized = desc.replace(/\s+/gu, ' ').trim();
  if (!normalized || maxLength <= 0) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}…`;
}

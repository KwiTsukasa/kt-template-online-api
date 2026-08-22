export const BANGDREAM_TIME_FORMAT_SPEC = {
  estimatedOpenSuffix: ' (预计开放时间)',
  japanUtcOffsetHours: 9,
  millisecond: 1000,
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year: 12 * 30 * 24 * 60 * 60 * 1000,
  century: 100 * 12 * 30 * 24 * 60 * 60 * 1000,
  unknown: '?',
} as const;

/**
 * 格式化分钟，保持历史输出只对分钟补零。
 * @param minutes - 用于分钟，保持历史输出只对分钟补零的领域对象，包含 `toString` 字段。
 * @returns 分钟，保持历史输出只对分钟补零。
 */
export function formatBangDreamMinute(minutes: number) {
  if (minutes < 10) {
    return `0${minutes}`;
  }
  return minutes.toString();
}

/**
 * 将时间戳转换为日本时区的年月日时分文本，并按两位数补齐时间字段。
 * @param timeStamp - 决定BanGDream时间内容、边界或目标的 `timeStamp` 值。
 * @returns 按参数编码并拼接完成的BanGDream时间。
 */
export function formatBangDreamTime(timeStamp: number | null) {
  if (timeStamp == null) {
    return BANGDREAM_TIME_FORMAT_SPEC.unknown;
  }
  const date = new Date(
    Math.floor(timeStamp / BANGDREAM_TIME_FORMAT_SPEC.millisecond) *
      BANGDREAM_TIME_FORMAT_SPEC.millisecond,
  );
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${date.getHours()}:${formatBangDreamMinute(date.getMinutes())}`;
}

/**
 * 把输入日期转换到日本时区。
 * @param dateInput - `dateInput` 作为 `Date` 构造参数。
 * @returns 返回由 `Date` 构造的把输入日期转换到日本时区。
 */
export function toBangDreamJapanTime(dateInput: number | string | Date) {
  const date = new Date(dateInput);
  const offset = date.getTimezoneOffset() * BANGDREAM_TIME_FORMAT_SPEC.minute;
  return new Date(
    date.getTime() +
      offset +
      BANGDREAM_TIME_FORMAT_SPEC.japanUtcOffsetHours *
        BANGDREAM_TIME_FORMAT_SPEC.hour,
  );
}

/**
 * 将时间戳转换为日本时区的月日文本。
 * @param timeStamp - 决定将时间戳转换为日本时区的月日文本内容、边界或目标的 `timeStamp` 值。
 * @returns 按参数编码并拼接完成的将时间戳转换为日本时区的月日文本。
 */
export function formatBangDreamMonthDay(timeStamp: number | null) {
  if (timeStamp == null) {
    return BANGDREAM_TIME_FORMAT_SPEC.unknown;
  }
  const date = toBangDreamJapanTime(timeStamp);
  return `${date.getMonth() + 1}月${date.getDate()}日 `;
}

/**
 * 将`period`转换为毫秒时长；当 `period == null` 成立时返回 `BANGDREAM_TIME_FORMAT_SPEC.unknown`。
 * @param period - 决定毫秒时长内容、边界或目标的 `period` 值。
 * @returns 按参数编码并拼接完成的毫秒时长。
 */
export function formatBangDreamPeriod(period: number | null) {
  if (period == null) {
    return BANGDREAM_TIME_FORMAT_SPEC.unknown;
  }

  const century = Math.floor(period / BANGDREAM_TIME_FORMAT_SPEC.century);
  const years = Math.floor(period / BANGDREAM_TIME_FORMAT_SPEC.year);
  const months = Math.floor(period / BANGDREAM_TIME_FORMAT_SPEC.month);
  const days = Math.floor(
    (period % BANGDREAM_TIME_FORMAT_SPEC.month) /
      BANGDREAM_TIME_FORMAT_SPEC.day,
  );
  const hours = Math.floor(
    (period % BANGDREAM_TIME_FORMAT_SPEC.day) / BANGDREAM_TIME_FORMAT_SPEC.hour,
  );
  const minutes = Math.floor(
    (period % BANGDREAM_TIME_FORMAT_SPEC.hour) /
      BANGDREAM_TIME_FORMAT_SPEC.minute,
  );
  const seconds = Math.floor(
    (period % BANGDREAM_TIME_FORMAT_SPEC.minute) /
      BANGDREAM_TIME_FORMAT_SPEC.millisecond,
  );

  let text = '';
  if (century !== 0) {
    text += `${century}世纪`;
  }
  if (years !== 0) {
    text += `${years}年`;
  }
  if (months !== 0) {
    text += `${months}月`;
  }
  if (days !== 0) {
    text += `${days}日`;
  }
  if (hours !== 0) {
    text += `${hours}小时`;
  }
  if (minutes !== 0) {
    text += `${minutes}分钟`;
  }
  return `${text}${seconds}秒`;
}

/**
 * 将`value`转换为秒级时长。
 * @param value - 待转换为秒级时长的原始值。
 * @returns 秒级时长。
 */
export function formatBangDreamSeconds(value: number) {
  let seconds = value;
  let minutes = 0;
  let hours = 0;
  if (seconds > 60) {
    minutes = Math.trunc(seconds / 60);
    seconds = Math.trunc(seconds % 60);
    if (minutes > 60) {
      hours = Math.trunc(minutes / 60);
      minutes = Math.trunc(minutes % 60);
    }
  }

  let result = `${Math.trunc(seconds)}秒`;
  if (minutes > 0) {
    result = `${Math.trunc(minutes)}分${result}`;
  }
  if (hours > 0) {
    result = `${Math.trunc(hours)}小时${result}`;
  }
  return result;
}

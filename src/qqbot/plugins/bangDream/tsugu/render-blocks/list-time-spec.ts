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
 *
 * @param minutes - 分钟数。
 */
export function formatBangDreamMinute(minutes: number) {
  return minutes < 10 ? `0${minutes}` : minutes.toString();
}

/**
 * 格式化完整时间。
 *
 * @param timeStamp - 毫秒时间戳。
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
 *
 * @param dateInput - 日期输入。
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
 * 格式化月日。
 *
 * @param timeStamp - 毫秒时间戳。
 */
export function formatBangDreamMonthDay(timeStamp: number | null) {
  if (timeStamp == null) {
    return BANGDREAM_TIME_FORMAT_SPEC.unknown;
  }
  const date = toBangDreamJapanTime(timeStamp);
  return `${date.getMonth() + 1}月${date.getDate()}日 `;
}

/**
 * 格式化毫秒时长。
 *
 * @param period - 毫秒时长。
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
 * 格式化秒级时长。
 *
 * @param value - 秒数。
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

import {
  BANGDREAM_TIME_FORMAT_SPEC,
  formatBangDreamMinute,
  formatBangDreamMonthDay,
  formatBangDreamPeriod,
  formatBangDreamSeconds,
  formatBangDreamTime,
} from '@/qqbot/plugins/bangDream/event/event-time.layout';

describe('BangDream time format spec', () => {
  it('keeps common labels and offsets stable', () => {
    expect(BANGDREAM_TIME_FORMAT_SPEC.estimatedOpenSuffix).toBe(
      ' (预计开放时间)',
    );
    expect(BANGDREAM_TIME_FORMAT_SPEC.japanUtcOffsetHours).toBe(9);
    expect(BANGDREAM_TIME_FORMAT_SPEC.unknown).toBe('?');
  });

  it('formats minutes and full timestamps like the original renderer', () => {
    expect(formatBangDreamMinute(0)).toBe('00');
    expect(formatBangDreamMinute(9)).toBe('09');
    expect(formatBangDreamMinute(10)).toBe('10');
    expect(formatBangDreamTime(null)).toBe('?');
    expect(
      formatBangDreamTime(new Date(2020, 4, 19, 13, 0, 30).getTime()),
    ).toBe('2020年5月19日 13:00');
  });

  it('formats Japan month day and durations', () => {
    expect(formatBangDreamMonthDay(null)).toBe('?');
    expect(formatBangDreamMonthDay(Date.UTC(2020, 4, 18, 15, 0, 0))).toBe(
      '5月19日 ',
    );
    expect(
      formatBangDreamPeriod(
        BANGDREAM_TIME_FORMAT_SPEC.day +
          BANGDREAM_TIME_FORMAT_SPEC.hour +
          BANGDREAM_TIME_FORMAT_SPEC.minute +
          2 * BANGDREAM_TIME_FORMAT_SPEC.millisecond,
      ),
    ).toBe('1日1小时1分钟2秒');
    expect(formatBangDreamSeconds(3661)).toBe('1小时1分1秒');
  });
});

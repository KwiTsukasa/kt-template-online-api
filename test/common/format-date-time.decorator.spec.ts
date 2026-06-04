import {
  FormatDateTime,
  formatDateTimeFields,
  formatKtDateTime,
  vbenSuccess,
} from '../../src/common';

class DateTimeFormatFixture {
  @FormatDateTime()
  createTime!: Date;

  @FormatDateTime()
  updateTime!: string;
}

describe('FormatDateTime', () => {
  it('formats decorated fields as YYYY-MM-DD HH:mm:ss', () => {
    const data = new DateTimeFormatFixture();
    data.createTime = new Date(2026, 4, 13, 10, 30, 0);
    data.updateTime = '2026-05-13T10:31:00';

    expect(formatDateTimeFields(data)).toEqual({
      createTime: '2026-05-13 10:30:00',
      updateTime: '2026-05-13 10:31:00',
    });
  });

  it('does not recursively format response payloads', () => {
    const createTime = new Date(2026, 4, 13, 10, 30, 0);
    const response = vbenSuccess({
      createTime,
      nested: {
        updateTime: '2026-05-13T10:31:00',
      },
    });

    expect(response.data).toEqual({
      createTime,
      nested: {
        updateTime: '2026-05-13T10:31:00',
      },
    });
  });

  it('exposes the configured formatter', () => {
    expect(formatKtDateTime(new Date(2026, 4, 13, 10, 30, 0))).toBe(
      '2026-05-13 10:30:00',
    );
  });
});

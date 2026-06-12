import { getMetadataArgsStorage, type ValueTransformer } from 'typeorm';
import {
  transformKtDateTimeFields,
  formatKtDateTime,
  KtCreateDateColumn,
  KtDateTime,
  KtDateTimeColumn,
  KtDateTimeField,
  KtUpdateDateColumn,
  vbenSuccess,
} from '../../src/common';

class DateTimeFormatFixture {
  @KtDateTimeField()
  createTime!: KtDateTime;

  @KtDateTimeField('YYYY/HH/DD')
  updateTime!: KtDateTime;
}

class DateTimeColumnFixture {
  @KtDateTimeColumn('YYYY/HH/DD')
  publishTime!: KtDateTime | null;

  @KtCreateDateColumn()
  createTime!: KtDateTime;

  @KtUpdateDateColumn('YYYY-MM-DD')
  updateTime!: KtDateTime;
}

describe('KtDateTime decorators', () => {
  it('wraps DTO fields with field-level format rules', () => {
    const data = new DateTimeFormatFixture();
    data.createTime = new Date(2026, 4, 13, 10, 30, 0);
    (data as any).updateTime = '2026-05-13T10:31:00';

    const formatted = transformKtDateTimeFields(data);

    expect(formatted.createTime).toBeInstanceOf(Date);
    expect(formatted.createTime).toBeInstanceOf(KtDateTime);
    expect(formatted.createTime.getTime()).toBe(data.createTime.getTime());
    expect(String(formatted.createTime)).toBe('2026-05-13 10:30:00');
    expect(String(formatted.updateTime)).toBe('2026/10/13');
    expect(JSON.stringify(formatted)).toBe(
      '{"createTime":"2026-05-13 10:30:00","updateTime":"2026/10/13"}',
    );
    expect(data.createTime).toBeInstanceOf(Date);
    expect(data.createTime).not.toBeInstanceOf(KtDateTime);
    expect(data.updateTime).toBe('2026-05-13T10:31:00');
  });

  it('hydrates TypeORM date columns as KtDateTime with column format rules', () => {
    const metadata = getMetadataArgsStorage().columns.filter(
      (column) => column.target === DateTimeColumnFixture,
    );
    const getTransformer = (propertyName: string) =>
      metadata.find((column) => column.propertyName === propertyName)?.options
        .transformer as ValueTransformer;

    const publishTime = getTransformer('publishTime').from(
      new Date(2026, 4, 13, 10, 30, 0),
    );
    const createTime = getTransformer('createTime').from(
      new Date(2026, 4, 13, 10, 31, 0),
    );
    const updateTime = getTransformer('updateTime').from(
      new Date(2026, 4, 13, 10, 32, 0),
    );

    expect(publishTime).toBeInstanceOf(KtDateTime);
    expect(publishTime?.getTime()).toBe(
      new Date(2026, 4, 13, 10, 30, 0).getTime(),
    );
    expect(String(publishTime)).toBe('2026/10/13');
    expect(String(createTime)).toBe('2026-05-13 10:31:00');
    expect(String(updateTime)).toBe('2026-05-13');
  });

  it('keeps DTO transformer datetime fields usable as Date values', () => {
    const data = new DateTimeFormatFixture();
    data.createTime = new Date(2026, 4, 13, 10, 30, 0);
    (data as any).updateTime = '2026-05-13T10:31:00';

    const formatted = transformKtDateTimeFields(data);

    expect(formatted.createTime).toBeInstanceOf(KtDateTime);
    expect(formatted.createTime.getTime()).toBe(
      new Date(2026, 4, 13, 10, 30, 0).getTime(),
    );
    expect(JSON.stringify(formatted)).toBe(
      '{"createTime":"2026-05-13 10:30:00","updateTime":"2026/10/13"}',
    );
  });

  it('does not recursively serialize plain response datetime values', () => {
    const createTime = new Date(2026, 4, 13, 10, 30, 0);
    const updateTime = new Date(2026, 4, 13, 10, 31, 0);
    const response = vbenSuccess({
      createTime,
      nested: {
        updateTime,
      },
    });

    expect(response.data.createTime).toBe(createTime);
    expect(response.data.nested.updateTime).toBe(updateTime);
  });

  it('exposes the configured formatter', () => {
    expect(formatKtDateTime(new Date(2026, 4, 13, 10, 30, 0))).toBe(
      '2026-05-13 10:30:00',
    );
  });
});

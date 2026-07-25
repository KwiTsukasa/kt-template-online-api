import { HttpException, HttpStatus } from '@nestjs/common';
import type { ExceptionBody, KtSuccessResponse } from '../types';

export const normalizeVbenErrorText = (
  value: unknown,
  fallback = '操作失败',
): string => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((item) => normalizeVbenErrorText(item, '')).join('; ');
  }
  if (value instanceof Error) return value.message || fallback;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const nested = record.msg ?? record.message ?? record.error ?? record.err;

    if (nested !== undefined) return normalizeVbenErrorText(nested, fallback);

    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }

  return String(value);
};

export const vbenSuccess = <T = any>(
  data: T,
  msg = '操作成功',
): KtSuccessResponse<T> => ({
  code: 200,
  data,
  msg,
});

export const vbenPage = <T = any>(items: T[], total: number) =>
  vbenSuccess({
    items,
    total,
  });

export const throwVbenError = (
  message: string,
  status = HttpStatus.BAD_REQUEST,
  err: unknown = message,
): never => {
  throw new HttpException(
    {
      msg: message,
      err: normalizeVbenErrorText(err, message),
    } satisfies ExceptionBody,
    status,
  );
};

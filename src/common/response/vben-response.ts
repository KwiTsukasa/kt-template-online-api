import { HttpException, HttpStatus } from '@nestjs/common';
import type { ExceptionBody, KtSuccessResponse } from '../types';

/**
 * 将未知错误值压缩成 Vben 可展示文案。
 * @param value - 待转文本值；提取 `msg`、`message`、`error`、`err` 等可展示字段。
 * @param fallback - 兜底值；在主值为空或无法序列化时提供默认错误文案。
 * @returns 可写入 Vben `err` 字段的错误文本。
 */
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

/**
 * 组装 Vben 成功响应。
 * @param data - 响应数据；写入统一响应体 `data` 字段。
 * @param msg - 响应提示文案；写入统一响应体 `msg` 字段。
 * @returns 包含 `code`、`data`、`msg` 的 Vben 成功响应。
 */
export const vbenSuccess = <T = any>(
  data: T,
  msg = '操作成功',
): KtSuccessResponse<T> => ({
  code: 200,
  data,
  msg,
});

/**
 * 组装 Vben 分页响应。
 * @param items - 公共基础设施列表；写入分页响应 `items` 字段。
 * @param total - 总记录数；写入分页响应 `total` 字段。
 */
export const vbenPage = <T = any>(items: T[], total: number) =>
  vbenSuccess({
    items,
    total,
  });

/**
 * 抛出符合 Vben 结构的 HTTP 异常。
 * @param message - message 输入；生成统一错误文案。
 * @param status - 公共基础设施列表；影响 throwVbenError 的返回值。
 * @param err - 异常或失败对象；提取状态码、错误体、堆栈或失败原因。
 */
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

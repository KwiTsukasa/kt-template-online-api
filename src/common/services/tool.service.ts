import { Injectable } from '@nestjs/common';
import * as svgCaptcha from 'svg-captcha';
import { normalizeVbenErrorText } from '../response/vben-response';
import type {
  KtDictOption,
  KtPage,
  KtResponse,
  NapcatLoginStatusLike,
  QrcodeLookupOptions,
} from '../types';

@Injectable()
export class ToolsService {
  async captche(size = 4) {
    const captcha = svgCaptcha.create({
      size,
      fontSize: 50,
      width: 100,
      height: 34,
      background: '#ffffff',
    });
    return captcha;
  }

  res(code: number, msg: string, data: any): KtResponse {
    if (code === 200) {
      return {
        code,
        msg,
        data,
      };
    }

    return {
      code,
      msg,
      err: normalizeVbenErrorText(data, msg),
    };
  }

  page<T = any>(list: T[], total: number): KtPage<T> {
    const retn = {
      list,
      total,
    };
    return retn;
  }

  getWhereStr(alias: string, key) {
    return `${alias}.${key.toString()} = :${key.toString()}`;
  }

  getLikeStr(alias: string, key) {
    return `${alias}.${key.toString()} like :${key.toString()}`;
  }

  getLikeWhere<T = object>(
    alias: string,
    wheres: Array<keyof T>,
    likes: Array<keyof T>,
    values: Partial<T>,
    operator: 'AND' | 'OR' = 'AND',
  ): [string, Record<string, unknown>] {
    const hasValue = (value: unknown) =>
      value !== undefined && value !== null && value !== '';

    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    wheres.forEach((key) => {
      const value = values[key];

      if (!hasValue(value)) return;

      const paramKey = key.toString();
      conditions.push(this.getWhereStr(alias, key));
      params[paramKey] = value;
    });

    likes.forEach((key) => {
      const value = values[key];

      if (!hasValue(value)) return;

      const paramKey = key.toString();
      conditions.push(this.getLikeStr(alias, key));
      params[paramKey] = `%${value}%`;
    });

    return [conditions.join(` ${operator} `), params];
  }

  dictFormat<T = object>(
    label: string,
    value: any,
    other: Partial<T>,
  ): KtDictOption<T> {
    const options = {
      label,
      value,
      ...other,
    };

    return options;
  }

  getErrorMessage(err: unknown, fallback = '') {
    const response = (err as any)?.getResponse?.();
    if (typeof response?.msg === 'string') return response.msg;
    if (typeof response?.message === 'string') return response.message;
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    if (err === undefined || err === null) return fallback;
    return `${err}`;
  }

  sleep(ms: number) {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  toTrimmedString(value: unknown) {
    return `${value ?? ''}`.trim();
  }

  normalizeWhitespaceText(value: unknown) {
    return this.toTrimmedString(value).replace(/\s+/g, ' ');
  }

  toStringId(value: number | string | undefined | null) {
    return value === undefined || value === null ? '' : `${value}`;
  }

  normalizeSlugText(value: unknown) {
    const text = this.toTrimmedString(value);
    if (!text) return '';

    try {
      return decodeURIComponent(text).toLowerCase().replace(/\s+/g, '-');
    } catch {
      return text.toLowerCase().replace(/\s+/g, '-');
    }
  }

  toPositiveNumber(
    value: number | string | undefined | null,
    fallback: number,
  ) {
    const nextValue = Number(value);
    return Number.isFinite(nextValue) && nextValue > 0 ? nextValue : fallback;
  }

  getPageParams(
    query: { pageNo?: number | string; pageSize?: number | string } = {},
    defaultPageNo = 1,
    defaultPageSize = 10,
  ) {
    const pageNo = this.toPositiveNumber(query.pageNo, defaultPageNo);
    const pageSize = this.toPositiveNumber(query.pageSize, defaultPageSize);
    return {
      pageNo,
      pageSize,
      skip: (pageNo - 1) * pageSize,
    };
  }

  normalizeBoolean(value: unknown, fallback = false) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    return ['1', 'true', 'yes'].includes(`${value}`.toLowerCase());
  }

  normalizeNullableString(value: unknown) {
    if (value === undefined || value === null) return null;
    const nextValue = this.toTrimmedString(value);
    return nextValue ? nextValue : null;
  }

  pickFirstText(...values: unknown[]) {
    for (const value of values) {
      const text = this.toTrimmedString(value);
      if (text) return text;
    }
    return '';
  }

  includesAny(value: unknown, keywords: string[]) {
    const text = `${value ?? ''}`;
    return keywords.some((keyword) => text.includes(keyword));
  }

  includesText(value: unknown, keyword: unknown) {
    const normalizedKeyword = this.toTrimmedString(keyword);
    if (!normalizedKeyword) return true;

    return this.toTrimmedString(value)
      .toLowerCase()
      .includes(normalizedKeyword.toLowerCase());
  }

  isSameText(left: unknown, right?: unknown) {
    const rightText = this.toTrimmedString(right);
    return !!rightText && this.toTrimmedString(left) === rightText;
  }

  pickDefined<T extends Record<string, unknown>>(payload: T) {
    return Object.entries(payload).reduce<Partial<T>>((acc, [key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        acc[key as keyof T] = value as T[keyof T];
      }
      return acc;
    }, {});
  }

  readHeader(
    request: { headers?: Record<string, any> } | undefined,
    name: string,
  ) {
    const value = request?.headers?.[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  }

  getRequestId(request: { headers?: Record<string, any>; id?: unknown }) {
    return this.pickFirstText(
      request?.id,
      this.readHeader(request, 'x-request-id'),
      this.readHeader(request, 'x-correlation-id'),
    );
  }

  getRequestPath(
    request:
      | {
          originalUrl?: unknown;
          path?: unknown;
          url?: unknown;
        }
      | undefined,
  ) {
    return this.normalizeRequestPathValue(
      this.pickFirstText(request?.path, request?.originalUrl, request?.url),
    );
  }

  normalizeRequestPathValue(value: unknown) {
    const text = this.toTrimmedString(value);
    if (!text) return '';

    try {
      return new URL(text, 'http://localhost').pathname;
    } catch {
      return text.split('?')[0] || text;
    }
  }

  readCookie(
    request: { headers?: Record<string, any> } | undefined,
    cookieName: string,
  ) {
    const cookieHeader = request?.headers?.cookie || '';
    const cookie = `${cookieHeader}`.split(';').find((item) => {
      const [key] = item.trim().split('=');
      return key === cookieName;
    });
    if (!cookie) return undefined;

    const [, ...value] = cookie.trim().split('=');
    const joined = value.join('=');
    try {
      return decodeURIComponent(joined);
    } catch {
      return joined;
    }
  }

  readBearerToken(authHeader?: string) {
    if (!authHeader?.startsWith('Bearer ')) return null;
    return authHeader.split(' ')[1] || null;
  }

  pickQrcode(data?: Record<string, any> | null) {
    if (!data) return '';
    return this.pickFirstText(data.qrcode, data.qrcodeurl, data.url);
  }

  ensureFreshQrcode(qrcode: unknown, options: QrcodeLookupOptions = {}) {
    const normalized = this.toTrimmedString(qrcode);
    if (options.requireFresh && !normalized) {
      throw new Error('NapCat 二维码仍未刷新');
    }
    if (
      normalized &&
      options.requireFresh &&
      this.isSameText(normalized, options.staleQrcode)
    ) {
      throw new Error('NapCat 二维码仍未刷新');
    }
    return normalized;
  }

  pickNapcatSelfId(info: Record<string, any>) {
    return this.pickFirstText(info.uin, info.self_id, info.selfId);
  }

  pickNapcatNickname(info: Record<string, any>) {
    return this.pickFirstText(info.nick, info.nickname, info.name);
  }

  isNapcatAlreadyLoggedInError(err: unknown) {
    return this.getErrorMessage(err).includes('QQ Is Logined');
  }

  isNapcatTemporaryError(err: unknown) {
    return this.includesAny(this.getErrorMessage(err), [
      'ECONNREFUSED',
      'ECONNRESET',
      'ETIMEDOUT',
      'NapCat 请求超时',
      'NapCat 未返回登录二维码',
      'NapCat 二维码仍未刷新',
      'QRCode Get Error',
      'socket hang up',
    ]);
  }

  isNapcatQrcodePendingError(err: unknown) {
    return this.getErrorMessage(err).includes('QRCode Get Error');
  }

  isNapcatOfflineLoginStatus(status: NapcatLoginStatusLike) {
    return (
      !!status.isOffline || this.isNapcatOfflineLoginMessage(status.loginError)
    );
  }

  isNapcatOfflineLoginMessage(message?: string) {
    return this.includesAny(message, [
      'KickedOffLine',
      'Not Login',
      'not login',
      '下线',
      '离线',
      '另一台终端',
      '被踢',
      '登录态失效',
    ]);
  }

  isNapcatExpiredQrcodeStatus(status: NapcatLoginStatusLike) {
    const message = status.loginError || '';
    return (
      message.includes('二维码') &&
      (message.includes('过期') || message.includes('失效'))
    );
  }
}

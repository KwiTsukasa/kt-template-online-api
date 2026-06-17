import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
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
  /**
   * 执行 当前模块流程。
   * @param size - 数量限制；影响 captche 的返回值。
   */
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

  /**
   * 执行 当前模块流程。
   * @param code - 响应状态码；决定 公共基础设施条件分支。
   * @param msg - 响应提示文案；生成统一错误文案。
   * @param data - 响应数据；承载 公共基础设施新增、更新、导入或执行字段。
   * @returns 当前模块产出的 KtResponse。
   */
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

  /**
   * 获取分页数据。
   * @param list - 公共基础设施列表；影响 page 的返回值。
   * @param total - 总记录数；影响 page 的返回值。
   * @returns 当前模块产出的 KtPage<T>。
   */
  page<T = any>(list: T[], total: number): KtPage<T> {
    const retn = {
      list,
      total,
    };
    return retn;
  }

  /**
   * 查询 当前模块数据。
   * @param alias - SQL 表别名；限定 公共基础设施查询范围。
   * @param key - 键名；生成规范化文本。
   */
  getWhereStr(alias: string, key) {
    return `${alias}.${key.toString()} = :${key.toString()}`;
  }

  /**
   * 查询 当前模块数据。
   * @param alias - SQL 表别名；限定 公共基础设施查询范围。
   * @param key - 键名；生成规范化文本。
   */
  getLikeStr(alias: string, key) {
    return `${alias}.${key.toString()} like :${key.toString()}`;
  }

  /**
   * 查询 当前模块数据。
   * @param alias - SQL 表别名；驱动 `conditions.push()` 的 公共基础设施步骤。
   * @param wheres - 精确匹配字段列表；遍历并累积 公共基础设施结果。
   * @param likes - 模糊匹配字段列表；遍历并累积 公共基础设施结果。
   * @param values - 配置值字典；限定 公共基础设施查询范围。
   * @param operator - SQL 条件连接符；限定 公共基础设施查询范围。
   * @returns 当前模块查询结果。
   */
  getLikeWhere<T = object>(
    alias: string,
    wheres: Array<keyof T>,
    likes: Array<keyof T>,
    values: Partial<T>,
    operator: 'AND' | 'OR' = 'AND',
  ): [string, Record<string, unknown>] {
    /**
     * 判断 公共基础设施条件。
     * @param value - 待转换值；计算 公共基础设施判断结果。
     */
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

  /**
   * 执行 当前模块流程。
   * @param label - 字典展示文本；影响 dictFormat 的返回值。
   * @param value - 待转换时间值；影响 dictFormat 的返回值。
   * @param other - 字典附加字段；影响 dictFormat 的返回值。
   * @returns 当前模块产出的 KtDictOption<T>。
   */
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

  /**
   * 查询 当前模块数据。
   * @param err - 异常或失败对象；提取状态码、错误体、堆栈或失败原因。
   * @param fallback - 兜底值；限定 公共基础设施查询范围。
   */
  getErrorMessage(err: unknown, fallback = '') {
    const response = (err as any)?.getResponse?.();
    if (typeof response?.msg === 'string') return response.msg;
    if (typeof response?.message === 'string') return response.message;
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    if (err === undefined || err === null) return fallback;
    return `${err}`;
  }

  /**
   * 执行 当前模块流程。
   * @param ms - 等待毫秒数；驱动 `setTimeout()` 的 公共基础设施步骤。
   */
  sleep(ms: number) {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  /**
   * 执行 当前模块流程。
   * @param value - 待转文本值；影响 toTrimmedString 的返回值。
   */
  toTrimmedString(value: unknown) {
    return `${value ?? ''}`.trim();
  }

  /**
   * 执行 当前模块流程。
   * @param value - 待转文本值；决定 公共基础设施条件分支。
   */
  toSecretText(value: unknown) {
    if (value === undefined || value === null) return '';
    const text = `${value}`;
    return text.trim() ? text : '';
  }

  /**
   * 转换 当前模块输入。
   * @param value - 待转文本值；驱动 `this.toTrimmedString()` 的 公共基础设施步骤。
   */
  normalizeWhitespaceText(value: unknown) {
    return this.toTrimmedString(value).replace(/\s+/g, ' ');
  }

  /**
   * 执行 当前模块流程。
   * @param value - 待转文本值；驱动 `this.toTrimmedString()` 的 公共基础设施步骤。
   * @param maxLength - 最大文本长度；驱动 `text.slice()` 的 公共基础设施步骤。
   */
  toStoredMessageText(value: unknown, maxLength = 4000) {
    const text = this.toTrimmedString(value).replace(
      /\[CQ:image,file=base64:\/\/([A-Za-z0-9+/=]+)\]/g,
      (_match, payload: string) =>
        `[CQ:image,file=base64://<${payload.length} chars>]`,
    );
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength)}...<truncated ${text.length - maxLength} chars>`;
  }

  /**
   * 执行 当前模块流程。
   * @param value - 待转文本值；驱动 `this.toTrimmedString()` 的 公共基础设施步骤。
   * @param maxLength - 最大文本长度；驱动 `text.slice()` 的 公共基础设施步骤。
   */
  toColumnText(value: unknown, maxLength: number) {
    const text = this.toTrimmedString(value);
    if (maxLength <= 0) return '';
    if (text.length <= maxLength) return text;
    if (maxLength <= 3) return text.slice(0, maxLength);
    return `${text.slice(0, maxLength - 3)}...`;
  }

  /**
   * 执行 当前模块流程。
   * @param value - 待转文本值；驱动 `this.toTrimmedString()` 的 公共基础设施步骤。
   * @param maxLength - 最大文本长度；驱动 `text.slice()` 的 公共基础设施步骤。
   */
  toStableColumnText(value: unknown, maxLength: number) {
    const text = this.toTrimmedString(value);
    if (maxLength <= 0) return '';
    if (text.length <= maxLength) return text;

    const suffix = `...#${createHash('sha1').update(text).digest('hex').slice(0, 12)}`;
    if (maxLength <= suffix.length) return text.slice(0, maxLength);
    return `${text.slice(0, maxLength - suffix.length)}${suffix}`;
  }

  /**
   * 执行 当前模块流程。
   * @param value - 待转换值；影响 toStringId 的返回值。
   */
  toStringId(value: number | string | undefined | null) {
    return value === undefined || value === null ? '' : `${value}`;
  }

  /**
   * 转换 当前模块输入。
   * @param value - 待转文本值；驱动 `this.toTrimmedString()` 的 公共基础设施步骤。
   */
  normalizeSlugText(value: unknown) {
    const text = this.toTrimmedString(value);
    if (!text) return '';

    try {
      return decodeURIComponent(text).toLowerCase().replace(/\s+/g, '-');
    } catch {
      return text.toLowerCase().replace(/\s+/g, '-');
    }
  }

  /**
   * 执行 当前模块流程。
   * @param value - 待转换值；驱动 `Number()` 的 公共基础设施步骤。
   * @param fallback - 兜底值；驱动 `Number.isFinite()` 的 公共基础设施步骤。
   */
  toPositiveNumber(
    value: number | string | undefined | null,
    fallback: number,
  ) {
    const nextValue = Number(value);
    return Number.isFinite(nextValue) && nextValue > 0 ? nextValue : fallback;
  }

  /**
   * 查询 当前模块数据。
   * @param query - 查询参数 DTO；限定 公共基础设施分页、搜索或详情查询条件。
   * @param defaultPageNo - defaultPageNo 输入；驱动 `this.toPositiveNumber()` 的 公共基础设施步骤。
   * @param defaultPageSize - defaultPageSize 输入；驱动 `this.toPositiveNumber()` 的 公共基础设施步骤。
   */
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

  /**
   * 转换 当前模块输入。
   * @param value - 待转换值；决定 公共基础设施条件分支。
   * @param fallback - 兜底值；影响 normalizeBoolean 的返回值。
   */
  normalizeBoolean(value: unknown, fallback = false) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    return ['1', 'true', 'yes'].includes(`${value}`.toLowerCase());
  }

  /**
   * 转换 当前模块输入。
   * @param value - 待转换值；驱动 `this.toTrimmedString()` 的 公共基础设施步骤。
   */
  normalizeNullableString(value: unknown) {
    if (value === undefined || value === null) return null;
    const nextValue = this.toTrimmedString(value);
    return nextValue ? nextValue : null;
  }

  /**
   * 执行 当前模块流程。
   * @param value - 待转文本值；驱动 `this.toSecretText()` 的 公共基础设施步骤。
   * @param secret - secret 输入；驱动 `this.deriveSecretKey()` 的 公共基础设施步骤。
   */
  encryptSecretText(value: unknown, secret: unknown) {
    const text = this.toSecretText(value);
    if (!text) return null;

    const key = this.deriveSecretKey(secret);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(text, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
      'ktv1',
      iv.toString('base64url'),
      tag.toString('base64url'),
      encrypted.toString('base64url'),
    ].join(':');
  }

  /**
   * 执行 当前模块流程。
   * @param value - 待转文本值；驱动 `this.toTrimmedString()` 的 公共基础设施步骤。
   * @param secret - secret 输入；驱动 `createDecipheriv()` 的 公共基础设施步骤。
   */
  decryptSecretText(value: unknown, secret: unknown) {
    const text = this.toTrimmedString(value);
    if (!text) return '';

    const [version, ivText, tagText, encryptedText] = text.split(':');
    if (version !== 'ktv1' || !ivText || !tagText || !encryptedText) {
      throw new Error('密文格式不正确');
    }

    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.deriveSecretKey(secret),
      Buffer.from(ivText, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  /**
   * 执行 当前模块流程。
   * @param values - 配置值字典；驱动 `for()` 的 公共基础设施步骤。
   */
  pickFirstText(...values: unknown[]) {
    for (const value of values) {
      const text = this.toTrimmedString(value);
      if (text) return text;
    }
    return '';
  }

  /**
   * 执行 当前模块流程。
   * @param value - 待转换值；影响 includesAny 的返回值。
   * @param keywords - 公共基础设施列表；计算 公共基础设施布尔判断。
   */
  includesAny(value: unknown, keywords: string[]) {
    const text = `${value ?? ''}`;
    return keywords.some((keyword) => text.includes(keyword));
  }

  /**
   * 执行 当前模块流程。
   * @param value - 待转文本值；驱动 `this.toTrimmedString()` 的 公共基础设施步骤。
   * @param keyword - keyword 输入；驱动 `this.toTrimmedString()` 的 公共基础设施步骤。
   */
  includesText(value: unknown, keyword: unknown) {
    const normalizedKeyword = this.toTrimmedString(keyword);
    if (!normalizedKeyword) return true;

    return this.toTrimmedString(value)
      .toLowerCase()
      .includes(normalizedKeyword.toLowerCase());
  }

  /**
   * 判断 当前模块条件。
   * @param left - left 输入；驱动 `this.toTrimmedString()` 的 公共基础设施步骤。
   * @param right - right 输入；驱动 `this.toTrimmedString()` 的 公共基础设施步骤。
   */
  isSameText(left: unknown, right?: unknown) {
    const rightText = this.toTrimmedString(right);
    return !!rightText && this.toTrimmedString(left) === rightText;
  }

  /**
   * 执行 当前模块流程。
   * @param payload - payload 输入；驱动 `Object.entries()` 的 公共基础设施步骤。
   */
  pickDefined<T extends Record<string, unknown>>(payload: T) {
    return Object.entries(payload).reduce<Partial<T>>((acc, [key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        acc[key as keyof T] = value as T[keyof T];
      }
      return acc;
    }, {});
  }

  /**
   * 读取 当前模块资源。
   * @param request - 当前 HTTP 请求；提供路由、用户、请求体或查询参数。
   * @param name - 名称文本；执行 `name.toLowerCase()` 对应的 公共基础设施步骤。
   */
  readHeader(
    request: { headers?: Record<string, any> } | undefined,
    name: string,
  ) {
    const value = request?.headers?.[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  }

  /**
   * 查询 当前模块数据。
   * @param request - 当前 HTTP 请求；提供路由、用户、请求体或查询参数。
   */
  getRequestId(request: { headers?: Record<string, any>; id?: unknown }) {
    return this.pickFirstText(
      request?.id,
      this.readHeader(request, 'x-request-id'),
      this.readHeader(request, 'x-correlation-id'),
    );
  }

  /**
   * 查询 当前模块数据。
   * @param request - 当前 HTTP 请求；提供路由、用户、请求体或查询参数。
   */
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

  /**
   * 转换 当前模块输入。
   * @param value - 待转换值；驱动 `this.toTrimmedString()` 的 公共基础设施步骤。
   */
  normalizeRequestPathValue(value: unknown) {
    const text = this.toTrimmedString(value);
    if (!text) return '';

    try {
      return new URL(text, 'http://localhost').pathname;
    } catch {
      return text.split('?')[0] || text;
    }
  }

  /**
   * 读取 当前模块资源。
   * @param request - 当前 HTTP 请求；提供路由、用户、请求体或查询参数。
   * @param cookieName - cookieName 输入；影响 readCookie 的返回值。
   */
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

  /**
   * 读取 当前模块资源。
   * @param authHeader - authHeader 输入；生成规范化文本。
   */
  readBearerToken(authHeader?: string) {
    if (!authHeader?.startsWith('Bearer ')) return null;
    return authHeader.split(' ')[1] || null;
  }

  /**
   * 执行 当前模块流程。
   * @param data - 业务数据；承载 公共基础设施新增、更新、导入或执行字段。
   */
  pickQrcode(data?: Record<string, any> | null) {
    if (!data) return '';
    return this.pickFirstText(data.qrcode, data.qrcodeurl, data.url);
  }

  /**
   * 确保Fresh Qrcode。
   * @param qrcode - qrcode 输入；驱动 `this.toTrimmedString()` 的 公共基础设施步骤。
   * @param options - 公共基础设施列表；使用 `requireFresh`、`staleQrcode` 字段生成结果。
   */
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

  /**
   * 执行 当前模块流程。
   * @param info - info 输入；使用 `uin`、`self_id`、`selfId` 字段生成结果。
   */
  pickNapcatSelfId(info: Record<string, any>) {
    return this.pickFirstText(info.uin, info.self_id, info.selfId);
  }

  /**
   * 执行 当前模块流程。
   * @param info - info 输入；使用 `nick`、`nickname`、`name` 字段生成结果。
   */
  pickNapcatNickname(info: Record<string, any>) {
    return this.pickFirstText(info.nick, info.nickname, info.name);
  }

  /**
   * 判断 当前模块条件。
   * @param err - 异常或失败对象；提取状态码、错误体、堆栈或失败原因。
   */
  isNapcatAlreadyLoggedInError(err: unknown) {
    return this.getErrorMessage(err).includes('QQ Is Logined');
  }

  /**
   * 判断 当前模块条件。
   * @param err - 异常或失败对象；提取状态码、错误体、堆栈或失败原因。
   */
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

  /**
   * 判断 当前模块条件。
   * @param err - 异常或失败对象；提取状态码、错误体、堆栈或失败原因。
   */
  isNapcatQrcodePendingError(err: unknown) {
    return this.getErrorMessage(err).includes('QRCode Get Error');
  }

  /**
   * 判断 当前模块条件。
   * @param status - 公共基础设施列表；使用 `isOffline`、`loginError` 字段计算判断结果。
   */
  isNapcatOfflineLoginStatus(status: NapcatLoginStatusLike) {
    return (
      !!status.isOffline || this.isNapcatOfflineLoginMessage(status.loginError)
    );
  }

  /**
   * 判断 当前模块条件。
   * @param message - message 输入；驱动 `this.includesAny()` 的 公共基础设施步骤。
   */
  isNapcatOfflineLoginMessage(message?: string) {
    if (this.isNapcatOfflineFlagMessage(message)) return true;

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

  /**
   * 判断 当前模块条件。
   * @param message - message 输入；驱动 `this.includesAny()` 的 公共基础设施步骤。
   */
  isNapcatOnlineLoginMessage(message?: string) {
    if (this.isNapcatOfflineFlagMessage(message)) return false;
    if (this.isNapcatOnlineFlagMessage(message)) return true;

    return this.includesAny(message, [
      '账号状态变更为在线',
      '扫码登录成功',
      '登录成功',
      'Login Success',
    ]);
  }

  /**
   * 判断 当前模块条件。
   * @param message - message 输入；驱动 `this.matchesNapcatOnlineFlag()` 的 公共基础设施步骤。
   */
  isNapcatOfflineFlagMessage(message?: string) {
    return this.matchesNapcatOnlineFlag(message, false);
  }

  /**
   * 判断 当前模块条件。
   * @param message - message 输入；驱动 `this.matchesNapcatOnlineFlag()` 的 公共基础设施步骤。
   */
  isNapcatOnlineFlagMessage(message?: string) {
    return this.matchesNapcatOnlineFlag(message, true);
  }

  /**
   * 执行 当前模块流程。
   * @param message - message 输入；驱动 `this.toTrimmedString()` 的 公共基础设施步骤。
   */
  extractNapcatCaptchaUrl(message?: string) {
    const text = this.toTrimmedString(message);
    if (!text) return '';

    const proofWaterUrl = text.match(
      /["']?proofWaterUrl["']?\s*[:：]\s*["']?(https?:\/\/[^"'\s,，}]+)/i,
    )?.[1];
    const fallbackUrl = text.includes('验证码')
      ? text.match(/https?:\/\/[^"'\s,，)\]}>。；;、]+/i)?.[0]
      : '';

    return this.normalizeExtractedUrl(proofWaterUrl || fallbackUrl || '');
  }

  /**
   * 判断 当前模块条件。
   * @param message - message 输入；驱动 `this.toTrimmedString()` 的 公共基础设施步骤。
   */
  isNapcatCaptchaRequiredMessage(message?: string) {
    const text = this.toTrimmedString(message);
    return (
      !!this.extractNapcatCaptchaUrl(text) ||
      this.includesAny(text, ['proofWaterUrl', '需要验证码', '验证码'])
    );
  }

  /**
   * 执行 当前模块流程。
   * @param message - message 输入；驱动 `this.toTrimmedString()` 的 公共基础设施步骤。
   * @param expected - expected 输入；影响 matchesNapcatOnlineFlag 的返回值。
   */
  private matchesNapcatOnlineFlag(message: unknown, expected: boolean) {
    const text = this.toTrimmedString(message);
    if (!text) return false;
    return new RegExp(
      `["']?isOnline["']?\\s*[:=]\\s*${expected ? 'true' : 'false'}\\b`,
      'i',
    ).test(text);
  }

  /**
   * 转换 当前模块输入。
   * @param value - 待转换值；驱动 `this.toTrimmedString()` 的 公共基础设施步骤。
   */
  private normalizeExtractedUrl(value: string) {
    return this.toTrimmedString(value).replace(/[)"'\]}>，。；;、,]+$/g, '');
  }

  /**
   * 执行 当前模块流程。
   * @param secret - secret 输入；驱动 `this.toTrimmedString()` 的 公共基础设施步骤。
   */
  private deriveSecretKey(secret: unknown) {
    const normalizedSecret = this.toTrimmedString(secret);
    if (!normalizedSecret) {
      throw new Error('密钥不能为空');
    }
    return createHash('sha256').update(normalizedSecret).digest();
  }

  /**
   * 判断 当前模块条件。
   * @param status - 公共基础设施列表；使用 `loginError` 字段计算判断结果。
   */
  isNapcatExpiredQrcodeStatus(status: NapcatLoginStatusLike) {
    const message = status.loginError || '';
    return (
      message.includes('二维码') &&
      (message.includes('过期') || message.includes('失效'))
    );
  }
}

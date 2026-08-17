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
   * 按指定字符数生成固定尺寸与白底样式的 SVG 验证码，并返回文本与图形数据。
   * @param size - 验证码包含的字符数量；省略时生成 4 个字符；省略时默认采用 `4`。
   * @returns 包含验证码明文与 SVG 图形数据的对象。
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
   * 根据 HTTP 状态码构造统一响应；成功时保留 `data`，失败时把输入规范为 `err` 字段。
   * @param code - 决定res内容、边界或目标的 `code` 值。
   * @param msg - 决定res内容、边界或目标的 `msg` 值。
   * @param data - 决定res内容、边界或目标的 `data` 值。
   * @returns 包含 `code`、`msg`、`err` 字段的res。
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
   * 将列表及记录总数封装为管理端统一分页对象。
   * @param list - 决定将列表及记录总数封装为管理端统一分页对象内容、边界或目标的 `list` 值。
   * @param total - 决定将列表及记录总数封装为管理端统一分页对象内容、边界或目标的 `total` 值。
   * @returns 将列表及记录总数封装为管理端统一分页对象。
   */
  page<T = any>(list: T[], total: number): KtPage<T> {
    const retn = {
      list,
      total,
    };
    return retn;
  }

  /**
   * 将表别名和字段键拼成参数化等值查询片段，并复用字段键作为占位符名。
   * @param alias - 决定WhereStr内容、边界或目标的 `alias` 值。
   * @param key - 用于读取或更新WhereStr的稳定键。
   * @returns 按参数编码并拼接完成的WhereStr。
   */
  getWhereStr(alias: string, key) {
    return `${alias}.${key.toString()} = :${key.toString()}`;
  }

  /**
   * 将表别名和字段键拼成参数化 `LIKE` 查询片段，并复用字段键作为占位符名。
   * @param alias - 决定模糊匹配Str内容、边界或目标的 `alias` 值。
   * @param key - 用于读取或更新模糊匹配Str的稳定键。
   * @returns 按参数编码并拼接完成的模糊匹配Str。
   */
  getLikeStr(alias: string, key) {
    return `${alias}.${key.toString()} like :${key.toString()}`;
  }

  /**
   * 将等值字段、模糊字段与非空查询值组合为参数化 SQL 条件，并按调用方选择的 AND 或 OR 连接条件。
   * @param alias - 限定查询字段所属表的 SQL 别名。
   * @param wheres - 使用参数化等值比较的字段键集合。
   * @param likes - 使用参数化 `LIKE` 比较的字段键集合。
   * @param values - 为等值与模糊字段提供候选值的查询对象；空值字段会被忽略。
   * @param operator - 连接各 SQL 条件的逻辑运算符；省略时使用 `AND`；省略时默认采用 `'AND'`。
   * @returns 由 SQL 条件文本和占位符参数对象组成的二元组；没有有效值时条件为空字符串且参数为空对象。
   */
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

  /**
   * 将展示文本与业务值组合为字典选项；兼容参数 `other` 保留在签名中但不会合并到结果。
   * @param label - 字典选项向用户展示的文本。
   * @param value - 参与字典比较、格式化或输出的候选值。
   * @param other - 为兼容旧调用保留的扩展字段；当前实现不会读取该参数。
   * @returns 只包含 `label` 与 `value` 的字典选项。
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
   * 按`err`、`fallback`读取错误消息；从 `getResponse` 读取错误消息。
   * @param err - 待转换为稳定业务错误或日志文本的未知异常。
   * @param fallback - 主值缺失、为空或不合法时采用的兜底结果；省略时默认采用 `''`。
   * @returns 按参数编码并拼接完成的错误消息。
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
   * 校验等待时长为非负有限数后创建定时 Promise，并把实际等待钳制在宿主允许上限内。
   * @param ms - 决定sleep内容、边界或目标的 `ms` 值。
   * @returns 返回在钳制后的等待时长结束时兑现的 Promise。
   */
  sleep(ms: number) {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  /**
   * 将空值折叠为空字符串，并去除其余输入的首尾空白。
   * @param value - 待转换为Trimmed字符串的原始值。
   * @returns Trimmed字符串。
   */
  toTrimmedString(value: unknown) {
    return `${value ?? ''}`.trim();
  }

  /**
   * 保留含非空白字符的原始密钥文本；空值或纯空白输入返回空字符串。
   * @param value - 待转换为保留含非空白字符的原始密钥文本的原始值。
   * @returns 当前状态对应的保留含非空白字符的原始密钥文本，取值为 `''`。
   */
  toSecretText(value: unknown) {
    if (value === undefined || value === null) return '';
    const text = `${value}`;
    if (text.trim()) {
      return text;
    }
    return '';
  }

  /**
   * 将`value`规范为Whitespace文本，使等价输入得到一致表示。
   * @param value - 待转换为Whitespace文本的原始值。
   * @returns Whitespace文本。
   */
  normalizeWhitespaceText(value: unknown) {
    return this.toTrimmedString(value).replace(/\s+/g, ' ');
  }

  /**
   * 将消息规范为可持久化文本，先隐藏 CQ 图片的 Base64 正文，再按长度上限截断并记录省略字符数。
   * @param value - 待转换为持久化消息文本的原始值。
   * @param maxLength - 结果允许占用的最大字符数；非正数会得到空字符串；省略时默认采用 `4000`。
   * @returns 已隐藏 Base64 图片正文且不超过长度上限的消息文本。
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
   * 将输入规范为去除首尾空白的数据库列文本；超过长度上限时截断并在空间允许时追加省略号。
   * @param value - 待转换为数据库列文本的原始值。
   * @param maxLength - 结果允许占用的最大字符数；非正数会得到空字符串。
   * @returns 不超过上限的列文本；超长时截断并在上限大于 3 时以省略号结尾。
   */
  toColumnText(value: unknown, maxLength: number) {
    const text = this.toTrimmedString(value);
    if (maxLength <= 0) return '';
    if (text.length <= maxLength) return text;
    if (maxLength <= 3) return text.slice(0, maxLength);
    return `${text.slice(0, maxLength - 3)}...`;
  }

  /**
   * 将输入规范为有长度上限的数据库列文本；超长时追加内容摘要，使不同原文仍可稳定区分。
   * @param value - 待转换为稳定数据库列文本的原始值。
   * @param maxLength - 结果允许占用的最大字符数；非正数会得到空字符串。
   * @returns 不超过上限的列文本；超长且空间足够时以原文 SHA-1 短摘要作为稳定后缀。
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
   * 按 ``${value}`` 计算并返回结果。
   * @param value - 待转换为字符串标识的原始值。
   * @returns 当前状态对应的字符串标识，取值为 `''`。
   */
  toStringId(value: number | string | undefined | null) {
    if (value === undefined || value === null) {
      return '';
    }
    return `${value}`;
  }

  /**
   * 将`value`规范为Slug文本，使等价输入得到一致表示。
   * @param value - 待转换为Slug文本的原始值。
   * @returns 当前状态对应的Slug文本，取值为 `''`。
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
   * 将`value`、`fallback`转换为Positive数值；当 `Number.isFinite(nextValue) && nextValue > 0` 成立时返回 `nextValue`。
   * @param value - 待转换为Positive数值的原始值。
   * @param fallback - 主值缺失、为空或不合法时采用的兜底结果。
   * @returns Positive数值。
   */
  toPositiveNumber(
    value: number | string | undefined | null,
    fallback: number,
  ) {
    const nextValue = Number(value);
    if (Number.isFinite(nextValue) && nextValue > 0) {
      return nextValue;
    }
    return fallback;
  }

  /**
   * 将页码与页大小收敛为正数并计算数据库偏移量，缺失或非法值使用调用方默认值。
   * @param query - 限定将页码与页大小收敛为正数并计算数据库偏移量，缺失或非法值使用调用方默认值筛选、排序与分页范围的查询条件，包含 `pageNo`、`pageSize` 字段；省略时默认采用 `{}`。
   * @param defaultPageNo - 决定将页码与页大小收敛为正数并计算数据库偏移量，缺失或非法值使用调用方默认值内容、边界或目标的 `defaultPageNo` 值；省略时默认采用 `1`。
   * @param defaultPageSize - 限制将页码与页大小收敛为正数并计算数据库偏移量，缺失或非法值使用调用方默认值数量、尺寸、等级或重试边界的数值；省略时默认采用 `10`。
   * @returns 包含 `pageNo`、`pageSize`、`skip` 字段的将页码与页大小收敛为正数并计算数据库偏移量，缺失或非法值使用调用方默认值。
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
   * 将`value`、`fallback`规范为布尔值，使等价输入得到一致表示。
   * @param value - 待转换为布尔值的原始值。
   * @param fallback - 主值缺失、为空或不合法时采用的兜底结果；省略时默认采用 `false`。
   * @returns 满足布尔值约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  normalizeBoolean(value: unknown, fallback = false) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    return ['1', 'true', 'yes'].includes(`${value}`.toLowerCase());
  }

  /**
   * 将非空值转换为去除首尾空白的文本；空值或规范化后为空时返回 `null`。
   * @param value - 待转换为将非空值转换为去除首尾空白的文本的原始值。
   * @returns 将非空值转换为去除首尾空白的文本；无法解析或未命中时为 `null`。
   */
  normalizeNullableString(value: unknown) {
    if (value === undefined || value === null) return null;
    const nextValue = this.toTrimmedString(value);
    if (nextValue) {
      return nextValue;
    }
    return null;
  }

  /**
   * 根据`value`、`secret`处理encrypt密钥文本；从 `cipher.getAuthTag` 读取encrypt密钥文本。
   * @param value - 参与encrypt密钥文本比较、格式化或输出的候选值。
   * @param secret - 决定encrypt密钥文本内容、边界或目标的 `secret` 值。
   * @returns encrypt密钥文本；无法解析或未命中时为 `null`。
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
   * 根据`value`、`secret`处理decrypt密钥文本。
   * @param value - 参与decrypt密钥文本比较、格式化或输出的候选值。
   * @param secret - 决定decrypt密钥文本内容、边界或目标的 `secret` 值。
   * @returns 当前状态对应的decrypt密钥文本，取值为 `''`。
   * @throws 当 `version !== 'ktv1' || !ivText || !tagText || !encryptedText` 成立时拒绝当前输入并抛出 `Error`。
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
   * 按实参顺序返回首个规范化后非空的文本；全部为空时返回空字符串。
   * @param values - 按原有顺序参与按实参顺序返回首个规范化后非空的文本筛选、合并或汇总的集合；按调用方给定的顺序传递全部剩余实参。
   * @returns 当前状态对应的按实参顺序返回首个规范化后非空的文本，取值为 `''`。
   */
  pickFirstText(...values: unknown[]) {
    for (const value of values) {
      const text = this.toTrimmedString(value);
      if (text) return text;
    }
    return '';
  }

  /**
   * 将未知值转成文本，并判断是否包含任一候选关键字；空关键字列表返回 `false`。
   * @param value - 参与Any比较、格式化或输出的候选值。
   * @param keywords - 决定Any内容、边界或目标的 `keywords` 值。
   * @returns 满足Any约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  includesAny(value: unknown, keywords: string[]) {
    const text = `${value ?? ''}`;
    return keywords.some((keyword) => text.includes(keyword));
  }

  /**
   * 去除关键字两端空白并忽略大小写检查文本包含关系；关键字为空时不限制匹配并返回 `true`。
   * @param value - 参与文本比较、格式化或输出的候选值。
   * @param keyword - 要查找的关键字；空值表示不限制并直接匹配。
   * @returns 关键字为空或规范化后的文本包含该关键字时为 `true`，否则为 `false`。
   */
  includesText(value: unknown, keyword: unknown) {
    const normalizedKeyword = this.toTrimmedString(keyword);
    if (!normalizedKeyword) return true;

    return this.toTrimmedString(value)
      .toLowerCase()
      .includes(normalizedKeyword.toLowerCase());
  }

  /**
   * 去除两侧文本首尾空白后比较；右侧为空时固定返回 `false`。
   * @param left - 决定去除两侧文本首尾空白后比较内容、边界或目标的 `left` 值。
   * @param right - 决定去除两侧文本首尾空白后比较内容、边界或目标的 `right` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 满足去除两侧文本首尾空白后比较约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  isSameText(left: unknown, right?: unknown) {
    const rightText = this.toTrimmedString(right);
    return !!rightText && this.toTrimmedString(left) === rightText;
  }

  /**
   * 从`payload`筛选已提供字段，并保持保留项的原有顺序与键名。
   * @param payload - 待剔除 `null`、`undefined` 与空字符串字段的输入对象。
   * @returns 仅保留非空字段的浅拷贝对象；输入没有可保留字段时为空对象。
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
   * 按请求头名读取首个字符串值；数组仅取第一项，缺失或非字符串输入保留空值。
   * @param request - 用于按请求头名读取首个字符串值的当前 HTTP 请求，包含 `headers` 字段。
   * @param name - 决定按请求头名读取首个字符串值内容、边界或目标的 `name` 值。
   * @returns 按请求头名读取首个字符串值。
   */
  readHeader(
    request: { headers?: Record<string, any> } | undefined,
    name: string,
  ) {
    const value = request?.headers?.[name.toLowerCase()];
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  }

  /**
   * 按`request`读取标识；从 `readHeader` 读取标识。
   * @param request - 用于标识的当前 HTTP 请求，包含 `id` 字段。
   * @returns 标识。
   */
  getRequestId(request: { headers?: Record<string, any>; id?: unknown }) {
    return this.pickFirstText(
      request?.id,
      this.readHeader(request, 'x-request-id'),
      this.readHeader(request, 'x-correlation-id'),
    );
  }

  /**
   * 按 `path`、`originalUrl`、`url` 的优先级读取请求地址，并规范为不含查询串的路径名。
   * @param request - 用于路径的当前 HTTP 请求，包含 `path`、`originalUrl`、`url` 字段。
   * @returns 去除查询串后的请求路径；请求或候选地址为空时为空字符串。
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
   * 将`value`规范为路径值，使等价输入得到一致表示。
   * @param value - 待转换为路径值的原始值。
   * @returns 规范化后的路径值；主值为空时采用 `text` 兜底。
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
   * 从 HTTP Cookie 请求头中查找指定名称并解码其值；同名项仅取首个，百分号编码无效时保留原始值。
   * @param request - 可能包含 Cookie 请求头的 HTTP 请求；未提供或无 Cookie 时视为空请求头。
   * @param cookieName - 要精确匹配的 Cookie 名称；名称比较区分大小写。
   * @returns 首个同名 Cookie 解码后的值；请求头或目标 Cookie 缺失时为 `undefined`，解码失败时返回未解码文本。
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
   * 通过 `authHeader.startsWith` 判断输入是否满足函数约束。
   * @param authHeader - 决定Bearer令牌内容、边界或目标的 `authHeader` 值；为空时采用 `null` 作为兜底。
   * @returns 规范化后的Bearer令牌；主值为空时采用 `null` 兜底；无法解析或未命中时为 `null`。
   */
  readBearerToken(authHeader?: string) {
    if (!authHeader?.startsWith('Bearer ')) return null;
    return authHeader.split(' ')[1] || null;
  }

  /**
   * 从`data`筛选二维码，并保持保留项的原有顺序与键名。
   * @param data - 用于二维码的领域对象，包含 `qrcode`、`qrcodeurl`、`url` 字段；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 当前状态对应的二维码，取值为 `''`。
   */
  pickQrcode(data?: Record<string, any> | null) {
    if (!data) return '';
    return this.pickFirstText(data.qrcode, data.qrcodeurl, data.url);
  }

  /**
   * 确保有效二维码存在且保持一致；缺失时根据`qrcode`、`options`补齐对应状态。
   * @param qrcode - 决定有效二维码内容、边界或目标的 `qrcode` 值。
   * @param options - 控制有效二维码筛选、缓存或输出方式的可选项，包含 `requireFresh`、`staleQrcode` 字段；省略时默认采用 `{}`。
   * @returns 有效二维码。
   * @throws 当 `options.requireFresh && !normalized` 成立时拒绝当前输入并抛出 `Error`；当 `normalized && options.requireFresh && this.isSameText(normalized, optio…` 成立时拒绝当前输入并抛出 `Error`。
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
   * 从`info`筛选NapCatQQ 账号标识，并保持保留项的原有顺序与键名。
   * @param info - 用于NapCatQQ 账号标识的领域对象，包含 `uin`、`self_id`、`selfId` 字段。
   * @returns NapCatQQ 账号标识。
   */
  pickNapcatSelfId(info: Record<string, any>) {
    return this.pickFirstText(info.uin, info.self_id, info.selfId);
  }

  /**
   * 从`info`筛选NapCat账号昵称，并保持保留项的原有顺序与键名。
   * @param info - 用于NapCat账号昵称的领域对象，包含 `nick`、`nickname`、`name` 字段。
   * @returns NapCat账号昵称。
   */
  pickNapcatNickname(info: Record<string, any>) {
    return this.pickFirstText(info.nick, info.nickname, info.name);
  }

  /**
   * 根据`err`与当前约束判定NapCatAlreadyLogged错误；从 `getErrorMessage` 读取NapCatAlreadyLogged错误。
   * @param err - 待转换为稳定业务错误或日志文本的未知异常。
   * @returns 满足NapCatAlreadyLogged错误约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  isNapcatAlreadyLoggedInError(err: unknown) {
    const message = this.getErrorMessage(err);
    return (
      message.includes('QQ Is Logined') ||
      (message.includes('当前账号') &&
        message.includes('已登录') &&
        message.includes('无法重复登录'))
    );
  }

  /**
   * 根据`err`与当前约束判定NapCatTemporary错误；从 `getErrorMessage` 读取NapCatTemporary错误。
   * @param err - 待转换为稳定业务错误或日志文本的未知异常。
   * @returns 满足NapCatTemporary错误约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  isNapcatTemporaryError(err: unknown) {
    return this.includesAny(this.getErrorMessage(err), [
      'ECONNREFUSED',
      'ECONNRESET',
      'ETIMEDOUT',
      'NapCat 请求超时',
      'NapCat 未返回登录二维码',
      'NapCat 二维码仍未刷新',
      'NapCat WebUI 登录态仍阻止生成新二维码',
      'QRCode Get Error',
      'QR refresh request was rejected by login service',
      'socket hang up',
    ]);
  }

  /**
   * 根据`err`与当前约束判定NapCat二维码等待状态错误；从 `getErrorMessage` 读取NapCat二维码等待状态错误。
   * @param err - 待转换为稳定业务错误或日志文本的未知异常。
   * @returns 满足NapCat二维码等待状态错误约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  isNapcatQrcodePendingError(err: unknown) {
    return this.getErrorMessage(err).includes('QRCode Get Error');
  }

  /**
   * 通过 `isNapcatOfflineLoginMessage` 判断输入是否满足函数约束。
   * @param status - 用于NapCatOfflineLogin状态的领域对象，包含 `isOffline`、`loginError` 字段。
   * @returns 满足NapCatOfflineLogin状态约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  isNapcatOfflineLoginStatus(status: NapcatLoginStatusLike) {
    return (
      !!status.isOffline || this.isNapcatOfflineLoginMessage(status.loginError)
    );
  }

  /**
   * 通过 `isNapcatOfflineFlagMessage` 判断输入是否满足函数约束。
   * @param message - 包含正文、发送目标与账号身份的待处理消息；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 满足NapCatOfflineLogin消息约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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
   * 通过 `isNapcatOfflineFlagMessage` 判断输入是否满足函数约束。
   * @param message - 包含正文、发送目标与账号身份的待处理消息；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 满足NapCatOnlineLogin消息约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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
   * 通过 `matchesNapcatOnlineFlag` 判断输入是否满足函数约束。
   * @param message - 包含正文、发送目标与账号身份的待处理消息；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 满足NapCatOfflineFlag消息约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  isNapcatOfflineFlagMessage(message?: string) {
    return this.matchesNapcatOnlineFlag(message, false);
  }

  /**
   * 通过 `matchesNapcatOnlineFlag` 判断输入是否满足函数约束。
   * @param message - 包含正文、发送目标与账号身份的待处理消息；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 满足NapCatOnlineFlag消息约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  isNapcatOnlineFlagMessage(message?: string) {
    return this.matchesNapcatOnlineFlag(message, true);
  }

  /**
   * 从`message`解析NapCat验证码URL 地址。
   * @param message - 包含正文、发送目标与账号身份的待处理消息；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 当前状态对应的NapCat验证码URL 地址，取值为 `''`。
   */
  extractNapcatCaptchaUrl(message?: string) {
    const text = this.toTrimmedString(message);
    if (!text) return '';

    const proofWaterUrl = text.match(
      /["']?proofWaterUrl["']?\s*[:：]\s*["']?(https?:\/\/[^"'\s,，}]+)/i,
    )?.[1];
    const fallbackUrl = (() => {
      if (text.includes('验证码')) {
        return text.match(/https?:\/\/[^"'\s,，)\]}>。；;、]+/i)?.[0];
      }
      return '';
    })();

    return this.normalizeExtractedUrl(proofWaterUrl || fallbackUrl || '');
  }

  /**
   * 根据`message`与当前约束判定NapCat验证码Required消息。
   * @param message - 包含正文、发送目标与账号身份的待处理消息；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 满足NapCat验证码Required消息约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  isNapcatCaptchaRequiredMessage(message?: string) {
    const text = this.toTrimmedString(message);
    return (
      !!this.extractNapcatCaptchaUrl(text) ||
      this.includesAny(text, ['proofWaterUrl', '需要验证码', '验证码'])
    );
  }

  /**
   * 根据`message`、`expected`与当前约束判定matchesNapCatOnlineFlag。
   * @param message - 包含正文、发送目标与账号身份的待处理消息。
   * @param expected - 决定matchesNapCatOnlineFlag内容、边界或目标的 `expected` 值。
   * @returns 满足matchesNapCatOnlineFlag约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private matchesNapcatOnlineFlag(message: unknown, expected: boolean) {
    const text = this.toTrimmedString(message);
    if (!text) return false;
    return new RegExp(
      `["']?isOnline["']?\\s*[:=]\\s*${(() => {
        if (expected) {
          return 'true';
        }
        return 'false';
      })()}\\b`,
      'i',
    ).test(text);
  }

  /**
   * 将`value`规范为提取结果URL 地址，使等价输入得到一致表示。
   * @param value - 待转换为提取结果URL 地址的原始值。
   * @returns 提取结果URL 地址。
   */
  private normalizeExtractedUrl(value: string) {
    return this.toTrimmedString(value).replace(/[)"'\]}>，。；;、,]+$/g, '');
  }

  /**
   * 根据`secret`拼接稳定的derive密钥键，用于隔离对应资源或存储记录。
   * @param secret - 决定derive密钥键内容、边界或目标的 `secret` 值。
   * @returns derive密钥键。
   * @throws 当 `!normalizedSecret` 成立时拒绝当前输入并抛出 `Error`。
   */
  private deriveSecretKey(secret: unknown) {
    const normalizedSecret = this.toTrimmedString(secret);
    if (!normalizedSecret) {
      throw new Error('密钥不能为空');
    }
    return createHash('sha256').update(normalizedSecret).digest();
  }

  /**
   * 仅当登录错误同时提到二维码及过期或失效时，才识别为二维码失效状态。
   * @param status - 用于仅当登录错误同时提到二维码及过期或失效时，才识别为二维码失效状态的领域对象，包含 `loginError` 字段。
   * @returns 满足仅当登录错误同时提到二维码及过期或失效时，才识别为二维码失效状态约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  isNapcatExpiredQrcodeStatus(status: NapcatLoginStatusLike) {
    const message = status.loginError || '';
    return (
      message.includes('二维码') &&
      (message.includes('过期') || message.includes('失效'))
    );
  }
}

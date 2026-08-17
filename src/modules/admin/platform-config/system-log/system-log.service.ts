import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as http from 'node:http';
import * as https from 'node:https';
import { URL } from 'node:url';
import {
  getAppName,
  getLokiEnvironment,
  transformKtDateTimeFields,
  throwVbenError,
  ToolsService,
} from '@/common';
import { SystemLogDto } from './system-log.dto';
import type {
  SystemLogQueryDto,
  SystemLogStatusDto,
  SystemLogSummaryDto,
} from './system-log.dto';

type LokiStreamResult = {
  stream?: Record<string, string>;
  values?: Array<[string, string, Record<string, string>?]>;
};

type LokiQueryRangeResponse = {
  data?: {
    result?: LokiStreamResult[];
    resultType?: string;
  };
  status?: string;
};

type LokiMetricResult = {
  metric?: Record<string, string>;
  value?: [number | string, string];
};

type LokiQueryResponse = {
  data?: {
    result?: LokiMetricResult[];
    resultType?: string;
  };
  status?: string;
};

const DEFAULT_LEVELS = ['debug', 'info', 'warning', 'error', 'critical'];
const PINO_LEVEL_MAP: Record<string, string> = {
  '10': 'debug',
  '20': 'debug',
  '30': 'info',
  '40': 'warning',
  '50': 'error',
  '60': 'critical',
};

@Injectable()
export class SystemLogService {
  private readonly appName: string;
  private readonly environment: string;
  private readonly host: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly toolsService: ToolsService,
  ) {
    this.appName = getAppName(configService);
    this.environment = getLokiEnvironment(configService);
    this.host = this.normalizeUrl(
      this.getConfig('LOKI_QUERY_HOST') ||
        this.getConfig('LOKI_HOST') ||
        this.getConfig('LOKI_URL'),
    );
  }

  /**
   * 根据当前运行态处理状态；从 `getBaseSelector` 读取状态。
   * @returns 包含 `app`、`configured`、`env`、`host`、`selector` 字段的状态。
   */
  status(): SystemLogStatusDto {
    return {
      app: this.appName,
      configured: !!this.host,
      env: this.environment,
      host: this.maskHost(this.host),
      selector: this.getBaseSelector(),
    };
  }

  /**
   * 根据当前运行态处理levels。
   * @returns 由默认日志级别生成的 `{ label, value }` 选项列表，顺序与默认级别定义一致。
   */
  levels() {
    return DEFAULT_LEVELS.map((level) => ({
      label: level,
      value: level,
    }));
  }

  /**
   * 按查询条件从 Loki 获取、过滤并分页系统日志；日志服务未配置时返回空页。
   * @param query - 限定按查询条件从 Loki 获取、过滤并分页系统日志筛选、排序与分页范围的查询条件，包含 `limit` 字段；省略时默认采用 `{}`。
   * @returns 包含 `items`、`total` 字段的按查询条件从 Loki 获取、过滤并分页系统日志。
   */
  async page(query: SystemLogQueryDto = {}) {
    if (!this.host) {
      return {
        items: [],
        total: 0,
      };
    }

    const { pageNo, pageSize } = this.toolsService.getPageParams(query, 1, 20);
    const skip = (pageNo - 1) * pageSize;
    const requestLimit = Math.min(
      this.toolsService.toPositiveNumber(query.limit, skip + pageSize),
      this.getNumberConfig('LOKI_QUERY_MAX_LIMIT', 1000),
    );
    const [logs, total] = await Promise.all([
      this.queryLogs(query, Math.max(requestLimit, pageSize)),
      this.queryLogCount(query),
    ]);
    const filteredLogs = logs.filter((item) => this.matchesQuery(item, query));

    return {
      items: filteredLogs.slice(skip, skip + pageSize),
      total,
    };
  }

  /**
   * 根据`query`处理摘要；当 `!this.host` 成立时返回 `DEFAULT_LEVELS.map((level) => ({ count: 0,…`。
   * @param query - 限定摘要筛选、排序与分页范围的查询条件；省略时默认采用 `{}`。
   * @returns 按输入顺序得到的摘要列表；没有匹配项时为空数组。
   */
  async summary(query: SystemLogQueryDto = {}): Promise<SystemLogSummaryDto[]> {
    if (!this.host) {
      return DEFAULT_LEVELS.map((level) => ({ count: 0, level }));
    }

    const countMap = new Map(DEFAULT_LEVELS.map((level) => [level, 0]));
    const counts = await this.queryLogSummary(query);
    counts.forEach(({ count, level }) => {
      countMap.set(level, count);
    });

    return DEFAULT_LEVELS.map((level) => ({
      count: countMap.get(level) || 0,
      level,
    }));
  }

  /**
   * 按`query`、`limit`读取query日志集合；从 `getConfig` 读取query日志集合。
   * @param query - 限定query日志集合筛选、排序与分页范围的查询条件。
   * @param limit - 允许返回或处理的query日志集合最大数量。
   * @returns query日志集合。
   */
  private async queryLogs(query: SystemLogQueryDto, limit: number) {
    const url = new URL(
      this.getConfig('LOKI_QUERY_ENDPOINT', '/loki/api/v1/query_range'),
      this.host,
    );
    const { start, end } = this.getTimeRange(query);
    url.searchParams.set('query', this.buildLogQL(query));
    url.searchParams.set('start', this.toNanoseconds(start));
    url.searchParams.set('end', this.toNanoseconds(end));
    url.searchParams.set('limit', `${limit}`);
    url.searchParams.set('direction', 'backward');

    let response: LokiQueryRangeResponse;
    try {
      response = await this.requestJson<LokiQueryRangeResponse>(url);
    } catch (error) {
      throwVbenError(
        this.toolsService.getErrorMessage(error, 'Loki 查询失败'),
        HttpStatus.BAD_GATEWAY,
      );
    }
    if (response.status && response.status !== 'success') {
      throwVbenError('Loki 查询失败', HttpStatus.BAD_GATEWAY, response.status);
    }

    return this.flattenLogs(response.data?.result || []);
  }

  /**
   * 按`query`读取query日志数量；从 `queryInstant` 读取query日志数量。
   * @param query - 限定query日志数量筛选、排序与分页范围的查询条件。
   * @returns 规范化后的query日志数量；主值为空时采用 `0` 兜底。
   */
  private async queryLogCount(query: SystemLogQueryDto) {
    const response = await this.queryInstant(
      this.buildCountLogQL(query),
      query,
    );
    const value = response.data?.result?.[0]?.value?.[1];
    return this.toOptionalNumber(value) || 0;
  }

  /**
   * 按`query`读取query日志摘要；从 `queryInstant` 读取query日志摘要。
   * @param query - 限定query日志摘要筛选、排序与分页范围的查询条件。
   * @returns query日志摘要。
   */
  private async queryLogSummary(query: SystemLogQueryDto) {
    const response = await this.queryInstant(
      this.buildSummaryLogQL(query),
      query,
    );

    return (response.data?.result || [])
      .map((item) => ({
        count: this.toOptionalNumber(item.value?.[1]) || 0,
        level: this.normalizeLevel(item.metric?.level) || 'info',
      }))
      .filter((item) => DEFAULT_LEVELS.includes(item.level));
  }

  /**
   * 向 Loki 即时查询端点提交 LogQL 与结束时间；传输失败或响应状态非成功时转换为网关错误。
   * @param logql - 决定queryInstant内容、边界或目标的 `logql` 值。
   * @param query - 限定queryInstant筛选、排序与分页范围的查询条件。
   * @returns Loki 即时查询响应；传输失败或 Loki 状态非成功时不返回而是抛出网关错误。
   */
  private async queryInstant(logql: string, query: SystemLogQueryDto) {
    const url = new URL(this.getInstantQueryEndpoint(), this.host);
    const { end } = this.getTimeRange(query);
    url.searchParams.set('query', logql);
    url.searchParams.set('time', `${Math.floor(end.getTime() / 1000)}`);

    let response: LokiQueryResponse;
    try {
      response = await this.requestJson<LokiQueryResponse>(url);
    } catch (error) {
      throwVbenError(
        this.toolsService.getErrorMessage(error, 'Loki 查询失败'),
        HttpStatus.BAD_GATEWAY,
      );
    }
    if (response.status && response.status !== 'success') {
      throwVbenError('Loki 查询失败', HttpStatus.BAD_GATEWAY, response.status);
    }

    return response;
  }

  /**
   * 根据`query`构造日志QL；从 `getBaseSelector` 读取日志QL。
   * @param query - 限定日志QL筛选、排序与分页范围的查询条件，包含 `level`、`keyword`、`context`、`path` 字段。
   * @returns 日志QL。
   */
  private buildLogQL(query: SystemLogQueryDto) {
    const selector = this.withLevelSelector(
      this.getBaseSelector(),
      this.normalizeLevel(query.level),
    );
    const lineFilters = [
      query.keyword,
      query.context,
      query.path,
      query.requestId,
    ]
      .map((value) => this.toolsService.toTrimmedString(value))
      .filter(Boolean)
      .map((value) => `|= "${this.escapeLogqlString(value)}"`);

    return [selector, ...lineFilters].join(' ');
  }

  /**
   * 根据`query`构造数量日志QL；从 `getLogqlRange` 读取数量日志QL。
   * @param query - 限定数量日志QL筛选、排序与分页范围的查询条件。
   * @returns 按参数编码并拼接完成的数量日志QL。
   */
  private buildCountLogQL(query: SystemLogQueryDto) {
    return `sum(count_over_time(${this.buildLogQL(query)}[${this.getLogqlRange(query)}]))`;
  }

  /**
   * 根据`query`构造摘要日志QL；从 `getLogqlRange` 读取摘要日志QL。
   * @param query - 限定摘要日志QL筛选、排序与分页范围的查询条件。
   * @returns 按参数编码并拼接完成的摘要日志QL。
   */
  private buildSummaryLogQL(query: SystemLogQueryDto) {
    return `sum by (level)(count_over_time(${this.buildLogQL(query)}[${this.getLogqlRange(query)}]))`;
  }

  /**
   * 仅在选择器尚未限定级别时追加转义后的 `level` 标签；级别为空或已有标签时保持选择器不变。
   * @param selector - 决定LevelSelector内容、边界或目标的 `selector` 值。
   * @param level - 决定LevelSelector内容、边界或目标的 `level` 值；为空时采用 `selector.includes('level=')` 作为兜底。
   * @returns 包含转义级别标签的 LogQL 选择器；无需追加时原样返回输入选择器。
   */
  private withLevelSelector(selector: string, level?: string) {
    if (!level || selector.includes('level=')) return selector;
    return selector.replace(
      /}\s*$/,
      `,level="${this.escapeLabelValue(level)}"}`,
    );
  }

  /**
   * 按当前运行态读取BaseSelector；从 `getConfig` 读取BaseSelector。
   * @returns 按参数编码并拼接完成的BaseSelector。
   */
  private getBaseSelector() {
    const selector = this.getConfig('LOKI_QUERY_SELECTOR');
    if (selector) return selector;

    return `{app="${this.escapeLabelValue(
      this.appName,
    )}",env="${this.escapeLabelValue(this.environment)}"}`;
  }

  /**
   * 根据`streams`处理flatten日志集合。
   * @param streams - 决定flatten日志集合内容、边界或目标的 `streams` 值。
   * @returns 按输入顺序得到的flatten日志集合列表；没有匹配项时为空数组。
   */
  private flattenLogs(streams: LokiStreamResult[]): SystemLogDto[] {
    return streams
      .flatMap((stream, streamIndex) =>
        (stream.values || []).map(([timestampNs, line, metadata], rowIndex) =>
          this.serializeLog({
            line,
            metadata,
            rowIndex,
            stream: stream.stream || {},
            streamIndex,
            timestampNs,
          }),
        ),
      )
      .sort((prev, next) =>
        this.compareTimestamp(next.timestampNs, prev.timestampNs),
      );
  }

  /**
   * 将 Loki 流标签、元数据与 JSON 日志行合并为系统日志 DTO，并补齐级别、原文及时间字段。
   * @param params - Loki 日志行及其流标签、元数据和行位置；行位置用于生成稳定的结果标识。
   * @returns 返回标准化的系统日志 DTO；级别缺失时为 `info`，消息缺失时保留原始日志行。
   */
  private serializeLog(params: {
    line: string;
    metadata?: Record<string, string>;
    rowIndex: number;
    stream: Record<string, string>;
    streamIndex: number;
    timestampNs: string;
  }): SystemLogDto {
    const parsed = this.parseLogLine(params.line);
    const req = this.asRecord(parsed.req);
    const res = this.asRecord(parsed.res);
    const meta = this.asRecord(parsed.meta);
    const level =
      this.normalizeLevel(params.stream.level) ||
      this.normalizeLevel(parsed.level) ||
      'info';
    const requestId =
      this.pickText(
        params.metadata?.requestId,
        parsed.requestId,
        meta.requestId,
        req.id,
      ) || undefined;
    const path =
      this.toolsService.normalizeRequestPathValue(
        this.pickText(
          parsed.path,
          parsed.url,
          parsed.originalUrl,
          req.path,
          req.url,
          req.originalUrl,
        ),
      ) || undefined;
    const method =
      this.pickText(parsed.method, req.method)?.toUpperCase() || undefined;

    return transformKtDateTimeFields(
      Object.assign(new SystemLogDto(), {
        context:
          this.pickText(parsed.context, params.stream.context) || undefined,
        durationMs: this.toOptionalNumber(
          parsed.durationMs,
          parsed.responseTime,
        ),
        hostname: params.stream.hostname,
        id: `${params.timestampNs}-${params.streamIndex}-${params.rowIndex}`,
        level,
        message:
          this.pickText(parsed.msg, parsed.message, parsed.err?.message) ||
          params.line,
        method,
        path,
        raw: params.line,
        requestId,
        statusCode: this.toOptionalNumber(parsed.statusCode, res.statusCode),
        timestamp: this.timestampNsToDate(params.timestampNs),
        timestampNs: params.timestampNs,
      }),
    );
  }

  /**
   * 根据`item`、`query`与当前约束判定matchesQuery；当 `!this.includes(item.raw, query.keyword) && !this.includes(ite…` 成立时返回 `false`。
   * @param item - 用于matchesQuery的领域对象，包含 `level`、`raw`、`message`、`context` 字段。
   * @param query - 限定matchesQuery筛选、排序与分页范围的查询条件，包含 `level`、`keyword`、`context`、`path` 字段。
   * @returns 满足matchesQuery约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private matchesQuery(item: SystemLogDto, query: SystemLogQueryDto) {
    const level = this.normalizeLevel(query.level);
    if (level && item.level !== level) return false;
    if (
      !this.includes(item.raw, query.keyword) &&
      !this.includes(item.message, query.keyword)
    ) {
      return false;
    }
    if (!this.includes(item.context, query.context)) return false;
    if (!this.includes(item.path, query.path)) return false;
    if (!this.includes(item.requestId, query.requestId)) return false;
    return true;
  }

  /**
   * 根据`value`、`keyword`处理`includes` 对应结果。
   * @param value - 参与`includes` 对应结果比较、格式化或输出的候选值。
   * @param keyword - 决定`includes` 对应结果内容、边界或目标的 `keyword` 值。
   * @returns 满足`includes` 对应约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private includes(value: unknown, keyword: unknown) {
    const normalizedKeyword = this.toolsService.toTrimmedString(keyword);
    if (!normalizedKeyword) return true;
    return this.toolsService.includesText(value, normalizedKeyword);
  }

  /**
   * 通过 `toDate` 收敛领域表示。
   * @param query - 限定时间Range筛选、排序与分页范围的查询条件，包含 `endTime`、`startTime`、`rangeMinutes` 字段。
   * @returns 包含 `end`、`start` 字段的时间Range。
   */
  private getTimeRange(query: SystemLogQueryDto) {
    const end = this.toDate(query.endTime) || new Date();
    const start =
      this.toDate(query.startTime) ||
      new Date(
        end.getTime() -
          this.toolsService.toPositiveNumber(query.rangeMinutes, 60) *
            60 *
            1000,
      );
    return { end, start };
  }

  /**
   * 根据查询起止时间计算至少一秒的向上取整区间，并格式化为 LogQL 秒单位窗口。
   * @param query - 限定LogQLRange筛选、排序与分页范围的查询条件。
   * @returns 按参数编码并拼接完成的LogQLRange。
   */
  private getLogqlRange(query: SystemLogQueryDto) {
    const { end, start } = this.getTimeRange(query);
    const seconds = Math.max(
      1,
      Math.ceil((end.getTime() - start.getTime()) / 1000),
    );

    return `${seconds}s`;
  }

  /**
   * 按当前运行态读取InstantQuery端点；从 `getConfig` 读取InstantQuery端点。
   * @returns InstantQuery端点。
   */
  private getInstantQueryEndpoint() {
    const endpoint = this.getConfig('LOKI_QUERY_INSTANT_ENDPOINT');
    if (endpoint) return endpoint;

    return this.getConfig(
      'LOKI_QUERY_ENDPOINT',
      '/loki/api/v1/query_range',
    ).replace(/query_range$/, 'query');
  }

  /**
   * 使用 HTTP 或 HTTPS 按受控请求头与超时读取 Loki JSON；网络、状态码或解析失败时拒绝 Promise。
   * @param url - 待规范化、请求或同源校验的URL 地址 URL。
   * @returns 完成初始化并携带当前边界配置的JSON 数据。
   */
  private requestJson<T>(url: URL) {
    return new Promise<T>((resolve, reject) => {
      const client = (() => {
        if (url.protocol === 'http:') {
          return http;
        }
        return https;
      })();
      const request = client.request(
        url,
        {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'kt-template-online-api/admin-system-log',
            ...this.getHeaders(),
          },
          method: 'GET',
          timeout: this.getNumberConfig('LOKI_QUERY_TIMEOUT_MS', 10000),
        },
        (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => {
            body += chunk;
          });
          response.on('end', () => {
            if ((response.statusCode || 500) >= 400) {
              reject(new Error(`Loki 查询失败：${response.statusCode}`));
              return;
            }
            try {
              resolve(JSON.parse(body) as T);
            } catch {
              reject(new Error('Loki 返回不是合法 JSON'));
            }
          });
        },
      );

      request.on('timeout', () => {
        request.destroy(new Error('Loki 查询超时'));
      });
      request.on('error', reject);
      request.end();
    });
  }

  /**
   * 按当前运行态读取请求头集合；从 `getConfig` 读取请求头集合。
   * @returns 请求头集合。
   */
  private getHeaders() {
    const headers: Record<string, string> = {};
    const tenantId = this.getConfig('LOKI_TENANT_ID');
    const username = this.getConfig('LOKI_USERNAME');
    const password = this.getConfig('LOKI_PASSWORD');

    if (tenantId) headers['X-Scope-OrgID'] = tenantId;
    if (username && password) {
      headers.Authorization = `Basic ${Buffer.from(
        `${username}:${password}`,
      ).toString('base64')}`;
    }

    return headers;
  }

  /**
   * 将 JSON 日志行解析为普通对象；非对象 JSON 或解析失败时返回空对象。
   * @param line - 决定将 JSON 日志行解析为普通对象内容、边界或目标的 `line` 值。
   * @returns 将 JSON 日志行解析为普通对象。
   */
  private parseLogLine(line: string): Record<string, any> {
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
      return {};
    } catch {
      return {};
    }
  }

  /**
   * 根据`value`处理记录；当 `value && typeof value === 'object'` 成立时返回 `(value as Record<string, any>)`。
   * @param value - 参与记录比较、格式化或输出的候选值。
   * @returns 记录。
   */
  private asRecord(value: unknown): Record<string, any> {
    if (value && typeof value === 'object') {
      return (value as Record<string, any>);
    }
    return {};
  }

  /**
   * 从`values`筛选文本，并保持保留项的原有顺序与键名。
   * @param values - 按原有顺序参与文本筛选、合并或汇总的集合；按调用方给定的顺序传递全部剩余实参。
   * @returns 文本。
   */
  private pickText(...values: unknown[]) {
    return this.toolsService.pickFirstText(...values);
  }

  /**
   * 将`value`规范为Level，使等价输入得到一致表示；当 `DEFAULT_LEVELS.includes(text)` 成立时返回 `text`。
   * @param value - 待转换为Level的原始值。
   * @returns 当前状态对应的Level，取值为 `''`、`'warning'`。
   */
  private normalizeLevel(value: unknown) {
    const text = this.toolsService.toTrimmedString(value).toLowerCase();
    if (!text) return '';
    if (PINO_LEVEL_MAP[text]) return PINO_LEVEL_MAP[text];
    if (text === 'warn') return 'warning';
    if (DEFAULT_LEVELS.includes(text)) {
      return text;
    }
    return '';
  }

  /**
   * 将`value`转换为日期；当 `Number.isNaN(date.getTime())` 成立时返回 `null`。
   * @param value - 待转换为日期的原始值。
   * @returns 日期；无法解析或未命中时为 `null`。
   */
  private toDate(value: unknown) {
    const text = this.toolsService.toTrimmedString(value);
    if (!text) return null;
    const timestamp = (() => {
      if (/^\d+$/.test(text)) {
        return this.normalizeTimestamp(text);
      }
      return Date.parse(text);
    })();
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date;
  }

  /**
   * 通过 `BigInt` 收敛数值表示。
   * @param date - 用于Nanoseconds的领域对象，包含 `getTime` 字段。
   * @returns 按参数编码并拼接完成的Nanoseconds。
   */
  private toNanoseconds(date: Date) {
    return `${BigInt(date.getTime()) * 1000000n}`;
  }

  /**
   * 将纳秒时间戳截断为毫秒后构造日期；转换失败时回退为当前时间。
   * @param value - 参与将纳秒时间戳截断为毫秒后构造日期比较、格式化或输出的候选值。
   * @returns 完成初始化并携带当前边界配置的将纳秒时间戳截断为毫秒后构造日期。
   */
  private timestampNsToDate(value: string) {
    try {
      return new Date(Number(BigInt(value) / 1000000n));
    } catch {
      return new Date();
    }
  }

  /**
   * 通过 `BigInt` 收敛数值表示。
   * @param left - 用于compareTimestamp的领域对象，包含 `localeCompare` 字段。
   * @param right - 决定compareTimestamp内容、边界或目标的 `right` 值。
   * @returns 当前状态对应的compareTimestamp，取值为 `1`、`0`。
   */
  private compareTimestamp(left: string, right: string) {
    try {
      const diff = BigInt(left) - BigInt(right);
      if (diff > 0n) {
        return 1;
      }
      if (diff < 0n) {
        return -1;
      }
      return 0;
    } catch {
      return left.localeCompare(right);
    }
  }

  /**
   * 将`values`转换为可选值数值。
   * @param values - 按原有顺序参与可选值数值筛选、合并或汇总的集合；按调用方给定的顺序传递全部剩余实参。
   * @returns 可选值数值；没有可用结果或提前结束时为 `undefined`。
   */
  private toOptionalNumber(...values: unknown[]) {
    for (const value of values) {
      const nextValue = Number(value);
      if (Number.isFinite(nextValue)) return nextValue;
    }
    return undefined;
  }

  /**
   * 将`value`中的LogQL字符串特殊字符转义，使结果可安全嵌入查询或脚本文本。
   * @param value - 待转换为LogQL字符串的原始值。
   * @returns 完成特殊字符转义的LogQL字符串。
   */
  private escapeLogqlString(value: string) {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  /**
   * 将`value`中的Label值特殊字符转义，使结果可安全嵌入查询或脚本文本。
   * @param value - 待转换为Label值的原始值。
   * @returns 完成特殊字符转义的Label值。
   */
  private escapeLabelValue(value: string) {
    return this.escapeLogqlString(value);
  }

  /**
   * 按`key`、`fallback`读取配置；从 `configService.get` 读取配置。
   * @param key - 用于读取或更新配置的稳定键。
   * @param fallback - 主值缺失、为空或不合法时采用的兜底结果；省略时默认采用 `''`。
   * @returns 配置。
   */
  private getConfig(key: string, fallback = '') {
    const value = this.configService.get<string>(key);
    return this.toolsService.toTrimmedString(value || fallback);
  }

  /**
   * 按`key`、`fallback`读取数值配置；当 `Number.isFinite(value) && value > 0` 成立时返回 `value`。
   * @param key - 用于读取或更新数值配置的稳定键。
   * @param fallback - 主值缺失、为空或不合法时采用的兜底结果。
   * @returns 数值配置。
   */
  private getNumberConfig(key: string, fallback: number) {
    const value = Number(this.configService.get<string>(key));
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
    return fallback;
  }

  /**
   * 将`value`规范为URL 地址，使等价输入得到一致表示。
   * @param value - 待转换为URL 地址的原始值。
   * @returns URL 地址。
   */
  private normalizeUrl(value: string) {
    return value.replace(/\/+$/g, '');
  }

  /**
   * 将`host`中的宿主认证信息替换为掩码；无法解析时保留原值。
   * @param host - 可能包含认证信息或端口的外部服务地址。
   * @returns 认证信息已替换为掩码的宿主；输入为空时为 `undefined`，解析失败时保留原文本。
   */
  private maskHost(host: string) {
    if (!host) return undefined;
    try {
      const url = new URL(host);
      if (url.username || url.password) {
        url.username = '***';
        url.password = '***';
      }
      return url.toString().replace(/\/+$/g, '');
    } catch {
      return host;
    }
  }

  /**
   * 通过 `Math.floor` 收敛数值表示。
   * @param value - 待转换为Timestamp的原始值。
   * @returns 按输入位数从秒、微秒或纳秒折算出的毫秒时间戳；其他长度直接转为数值。
   */
  private normalizeTimestamp(value: string) {
    if (value.length === 10) return Number(value) * 1000;
    if (value.length === 16) return Math.floor(Number(value) / 1000);
    if (value.length >= 19) return Number(BigInt(value) / 1000000n);
    return Number(value);
  }
}
